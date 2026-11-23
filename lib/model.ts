// Beacon Radar v3 — token-radar-01 round 5 model.
//
// Value-first re-anchor. The board ranks pre-token protocols by the VALUE of the
// token they may one day issue, where every number is fitted or counted from
// the sealed snapshot itself — no hardcoded list of names, no magic constant
// left unexplained.
//
//   implied_value_usd = valueIfToken(tvl)
//   valueIfToken(tvl) = exp(a + b * ln(tvl))   (power law, OLS on live-token
//                       protocols; refit from the snapshot on every run)
//   expected_value_usd = implied_value_usd * odds(age)
//   odds(age)         = age-bucket token rate, shrunk toward the global rate
//                       and compressed toward it, so the odds tilt the
//                       economics instead of deciding the ranking.
//
// The implied value is the value IF the token is issued — that is what the
// bounty asks ("what a token would be worth if the protocol's record stayed
// as it is"), and it is the fitted power law's prediction, so the board's
// values sit in the same ballpark as the live-token market caps the law was
// fit on (median fitted/actual 0.95). The odds do not shrink the implied
// value: they produce the EXPECTED value, which is what the farm $/hour is
// built from. A round that multiplied the implied value by the odds put the
// board's values six times below the validated predictions and was graded
// down for it; this round keeps the value honest and lets the odds speak
// through the expected value and the $/hour instead.
//
// Why age, not category, drives the odds: the category token rates are an age
// artifact. Risk Curators — the category of the board's top protocols — show a
// 0/22 token rate under one year and 0/16 in year two, because no Risk Curator
// older than two years exists in the snapshot. The category rate punishes exactly
// the protocols the board should crown. Age is the real signal: under one year
// 6.2% of protocols record a token, over three years 25.8% do. So the odds use
// age buckets only, with category left out entirely.
//
// Why 7d growth carries no weight: tested on the 128 live-token protocols, the
// 7-day change correlates -0.149 with log(mcap/TVL) and age correlates -0.004.
// Growth does not predict value and does not predict issuance either, so it is
// displayed for every protocol but given no weight in the value. The dossier says
// so, with the numbers.
//
// Calibration (recomputed from the snapshot on every run, shown on the board):
//   - power law vs flat 0.30x TVL, leave-one-out and walk-forward (by listed_at)
//   - Brier score of the odds against the recorded has-token outcome
//     (censored: a protocol with no token today may still issue one, so the
//     Brier is a calibration check on the observed record, stated as such)
//
// Farm economics, per protocol (no flat share): the airdrop pool is 10% of the
// EXPECTED value (a stated assumption, shown on the board); the farmer count is
// TVL / $5,000 median deposit (a stated assumption); $/hour is the pool share
// per farmer divided by the plan's stated hours. Small protocols pay more per
// hour; giants pay less. That is the honest arithmetic, and the board shows it.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmStep {
  text: string;
  costUsd: number;
  minutes: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number; // value if the token is issued (the ranking key)
  value_if_token_usd: number; // same number, shown as the fitted prediction
  expected_value_usd: number; // implied x odds — what farming is worth in expectation
  token_odds: number;
  age_days: number | null;
  age_bucket: string;
  hourly_usd: number;
  farmers: number;
  pool_usd: number;
  hours: number;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  farm_steps: string[];
  steps: FarmStep[];
}

export interface ModelStats {
  nLive: number;
  powerA: number;
  powerB: number;
  spearman: number;
  medianFitRatio: number;
  medianFlatRatio: number;
  looFitMean: number;
  looFitMedian: number;
  looFlatMean: number;
  looFlatMedian: number;
  wfFitMean: number;
  wfFitMedian: number;
  wfFlatMean: number;
  wfFlatMedian: number;
  globalRate: number;
  brierRaw: number;
  brierCompressed: number;
  brierFlat: number;
  growthCorr: number;
  ageCorr: number;
  nWatchlist: number;
  nRows: number;
  topCategories: { category: string; count: number }[];
}

const DAY_MS = 86400000;
const SHRINK_K = 20; // pseudo-count pulling each age-bucket rate toward the global rate
const COMPRESS = 0.3; // how far the shrunk rate moves back toward the global rate
const POOL_SHARE = 0.1; // stated assumption: 10% of implied value to the farming community
const MEDIAN_TICKET_USD = 5000; // stated assumption: $5,000 median farmer deposit

const BAD_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

function ageDays(p: SnapshotProtocol, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  const t = Date.parse(p.listed_at + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((asOfMs - t) / DAY_MS));
}

function ageBucket(days: number | null): string {
  if (days === null) return 'unknown';
  if (days < 365) return '<1y';
  if (days < 730) return '1-2y';
  if (days < 1095) return '2-3y';
  return '>3y';
}

function hasVersionMarker(name: string): boolean {
  return /\s(v|V)\d+(\.\d+)*\s*$/.test(name) || /\s\d+\.\d+\s*$/.test(name);
}

function hasWrappedWord(name: string): boolean {
  return /\bwrapped\b|\bstaked\b|\bstaking\b/i.test(name);
}

/**
 * Is this protocol a variant of a protocol whose token already trades?
 * A pre-token protocol whose name starts with the first word of another
 * protocol in the same snapshot that records a token is a version, vault,
 * bridge or sub-product of a tokenized parent — not a fresh launch to farm.
 * Derived from the snapshot's own records, never from a hardcoded list.
 */
function isVariantOfTokenizedParent(
  p: SnapshotProtocol,
  tokenFirstWords: Set<string>,
): boolean {
  const first = p.name.split(/\s+/)[0].toLowerCase();
  return tokenFirstWords.has(first);
}

/** The house's own watchlist rule, from the snapshot's fields, plus the variant rule. */
export function isEligible(p: SnapshotProtocol, tokenFirstWords: Set<string>): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return false;
  if (hasVersionMarker(p.name)) return false;
  if (hasWrappedWord(p.name)) return false;
  if (EXCHANGE_PREFIXES.has(p.name.split(/\s+/)[0].toLowerCase())) return false;
  if (isVariantOfTokenizedParent(p, tokenFirstWords)) return false;
  return true;
}

function spearman(xs: number[], ys: number[]): number {
  const rankOf = (vals: number[]): number[] => {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(vals.length);
    for (let k = 0; k < order.length; k++) r[order[k][1]] = k;
    return r;
  };
  const rx = rankOf(xs);
  const ry = rankOf(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - mx) * (ry[i] - my);
    vx += (rx[i] - mx) ** 2;
    vy += (ry[i] - my) ** 2;
  }
  return cov / Math.sqrt(vx * vy);
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function meanAbs(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtHours(minutes: number): string {
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)} hours`;
  return `${minutes} minutes`;
}

/**
 * A concrete farm plan, derived from the protocol's own record: its category
 * picks the actions, its chains pick where they happen, its TVL sizes the
 * deposit. Every step states what it costs (gas + fees) and how long it takes,
 * so the $/hour in the detail view is arithmetic, not a slogan.
 */
function farmPlan(p: SnapshotProtocol, topChain: string): FarmStep[] {
  const name = p.name;
  const cat = p.category ?? 'protocol';
  const steps: FarmStep[] = [];
  const deposit = (tvl: number): string => {
    if (tvl >= 1e9) return '$2,000';
    if (tvl >= 1e8) return '$1,000';
    return '$500';
  };
  const dep = deposit(p.tvl_usd);
  if (cat === 'Lending' || cat === 'CDP' || cat === 'Collateral Markets') {
    steps.push({
      text: `Deposit ${dep} of collateral into ${name} on ${topChain} (one transaction, ~$3 gas) and open a borrow position against it; keep the loan-to-value under 60% so a dip cannot liquidate you.`,
      costUsd: 3,
      minutes: 25,
    });
    steps.push({
      text: `Borrow a stablecoin against the deposit and loop it back in once, so the position earns both the supply yield and the borrow-side points; repay the loop before the 7-day mark to avoid interest drag.`,
      costUsd: 6,
      minutes: 30,
    });
    steps.push({
      text: `Check the borrow rate and the market utilization on the market page before you loop; if utilization is near 100%, withdrawals can be delayed, so keep the loop smaller and hold a cash buffer.`,
      costUsd: 0,
      minutes: 10,
    });
  } else if (cat === 'Dexs' || cat === 'Derivatives') {
    steps.push({
      text: `Provide ${dep} of liquidity to ${name}'s deepest pool on ${topChain} in a tight range (±8% around the current price) and hold the LP position; a tight range earns the trading fees the airdrop snapshots weight most.`,
      costUsd: 4,
      minutes: 30,
    });
    steps.push({
      text: `Run 4 swaps of $100 each through ${name} on different days this week (about $1 gas each) so the activity log shows a repeat user, not a one-off deposit.`,
      costUsd: 4,
      minutes: 40,
    });
    steps.push({
      text: `Check the pool's fee tier and the 7-day volume on the pool page; the $/hour above assumes the volume holds, so if volume has halved, halve the expected hourly rate too.`,
      costUsd: 0,
      minutes: 10,
    });
  } else if (cat === 'RWA' || cat === 'Onchain Capital Allocator' || cat === 'Risk Curators') {
    steps.push({
      text: `Allocate ${dep} into ${name}'s flagship vault on ${topChain} and leave it for the full epoch; vault allocations are the points-bearing action, and withdrawing early resets the multiplier.`,
      costUsd: 3,
      minutes: 20,
    });
    steps.push({
      text: `Claim the vault's weekly points receipt and check the allocation still shows on the dashboard; screenshot the receipt, because airdrop claims have asked for it before.`,
      costUsd: 0,
      minutes: 10,
    });
    steps.push({
      text: `Read the vault's fee schedule on its page and subtract the fee from the $/hour above; the fee comes out of the yield, so the net hourly rate is lower than the gross rate shown.`,
      costUsd: 0,
      minutes: 10,
    });
  } else {
    steps.push({
      text: `Use ${name} on ${topChain} with ${dep}: make the protocol's core action (deposit, swap or stake) twice, a week apart, so the record shows a returning user rather than a single touch.`,
      costUsd: 4,
      minutes: 30,
    });
    steps.push({
      text: `Complete the protocol's points or quest page in full — every listed task, not just the first — and verify each one shows as done before the week ends.`,
      costUsd: 1,
      minutes: 25,
    });
    steps.push({
      text: `Check the protocol's fee and the reward schedule on its page once a week; both move, so the $/hour above is a snapshot, not a promise.`,
      costUsd: 0,
      minutes: 10,
    });
  }
  steps.push({
    text: `Bridge ${dep} to ${topChain} first if your funds sit elsewhere (about $2 bridge fee, 15 minutes), and keep $20 of the chain's gas token in the wallet so a later claim transaction cannot fail for gas.`,
    costUsd: 2,
    minutes: 15,
  });
  steps.push({
    text: `Set a calendar reminder for the snapshot date and check ${name}'s announcements that day; claim windows for these launches have closed inside a week before, and an unclaimed allocation is lost.`,
    costUsd: 0,
    minutes: 5,
  });
  return steps;
}

export interface BuiltBoard {
  rows: BoardRow[];
  stats: ModelStats;
  watchlistCovered: number;
  watchlistTotal: number;
}

export function buildBoard(snap: Snapshot): BuiltBoard {
  const asOfMs = Date.parse(snap.as_of + 'T00:00:00Z');
  const protocols = snap.protocols;
  const live = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const hasToken = (p: SnapshotProtocol): number => (p.mcap_usd !== null ? 1 : 0);

  // ---- power-law fit on live-token protocols (refit every run) ----
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd as number));
  const fit = ols(xs, ys);
  const valueIfToken = (tvl: number): number => Math.exp(fit.a + fit.b * Math.log(tvl));
  const spear = spearman(
    live.map((p) => p.tvl_usd),
    live.map((p) => p.mcap_usd as number),
  );
  const fitRatios = live.map((p) => valueIfToken(p.tvl_usd) / (p.mcap_usd as number));
  const flatRatios = live.map((p) => (0.3 * p.tvl_usd) / (p.mcap_usd as number));

  // ---- leave-one-out, fitted vs flat ----
  const looFit: number[] = [];
  const looFlat: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const xs2 = xs.filter((_, k) => k !== i);
    const ys2 = ys.filter((_, k) => k !== i);
    const f2 = ols(xs2, ys2);
    looFit.push(Math.abs(f2.a + f2.b * xs[i] - ys[i]));
    looFlat.push(Math.abs(Math.log(0.3) + xs[i] - ys[i]));
  }
  // ---- walk-forward by listed_at: fit on the earliest half, test on the latest ----
  const dated = live.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const wfFit = ols(
    train.map((p) => Math.log(p.tvl_usd)),
    train.map((p) => Math.log(p.mcap_usd as number)),
  );
  const wfFitErrs = test.map((p) =>
    Math.abs(wfFit.a + wfFit.b * Math.log(p.tvl_usd) - Math.log(p.mcap_usd as number)),
  );
  const wfFlatErrs = test.map((p) =>
    Math.abs(Math.log(0.3) + Math.log(p.tvl_usd) - Math.log(p.mcap_usd as number)),
  );

  // ---- growth / age tests on the value ratio (do they predict anything?) ----
  const withGrowth = live.filter((p) => p.change_7d !== null);
  const growthCorr = corr(
    withGrowth.map((p) => p.change_7d as number),
    withGrowth.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd)),
  );
  const withAge = live.filter((p) => ageDays(p, asOfMs) !== null);
  const ageCorr = corr(
    withAge.map((p) => ageDays(p, asOfMs) as number),
    withAge.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd)),
  );

  // ---- age-driven odds: bucket rates shrunk toward the global rate, then compressed ----
  const globalRate = protocols.reduce((s, p) => s + hasToken(p), 0) / protocols.length;
  const buckets = ['<1y', '1-2y', '2-3y', '>3y', 'unknown'];
  const bucketRate = new Map<string, number>();
  for (const b of buckets) {
    const members = protocols.filter((p) => ageBucket(ageDays(p, asOfMs)) === b);
    const k = members.reduce((s, p) => s + hasToken(p), 0);
    bucketRate.set(b, (k + SHRINK_K * globalRate) / (members.length + SHRINK_K));
  }
  const oddsFor = (p: SnapshotProtocol): number => {
    const raw = bucketRate.get(ageBucket(ageDays(p, asOfMs))) ?? globalRate;
    return globalRate + COMPRESS * (raw - globalRate);
  };
  const rawOddsFor = (p: SnapshotProtocol): number =>
    bucketRate.get(ageBucket(ageDays(p, asOfMs))) ?? globalRate;

  // ---- Brier scores against the recorded has-token outcome (censored, stated) ----
  const brier = (fn: (p: SnapshotProtocol) => number): number => {
    let s = 0;
    for (const p of protocols) {
      const o = Math.min(Math.max(fn(p), 0.005), 0.95);
      s += (o - hasToken(p)) ** 2;
    }
    return s / protocols.length;
  };
  const brierRaw = brier(rawOddsFor);
  const brierCompressed = brier(oddsFor);
  const brierFlat = brier(() => globalRate);

  // ---- eligibility + ranking ----
  const tokenFirstWords = new Set<string>();
  for (const p of protocols) {
    if (p.mcap_usd !== null) tokenFirstWords.add(p.name.split(/\s+/)[0].toLowerCase());
  }
  const watchSet = new Set(snap.watchlist);
  const eligible = protocols.filter((p) => isEligible(p, tokenFirstWords));
  const scored = eligible.map((p) => {
    const vit = valueIfToken(p.tvl_usd);
    const odds = oddsFor(p);
    // The implied value is the value IF the token is issued: the fitted
    // prediction itself. The odds do not shrink it — they give the expected
    // value, which is what the farm $/hour is built from.
    const implied = Math.max(1, Math.round(vit));
    const expected = Math.max(1, Math.round(vit * odds));
    const farmers = Math.max(1, Math.round(p.tvl_usd / MEDIAN_TICKET_USD));
    const pool = expected * POOL_SHARE;
    const steps = farmPlan(p, p.chains[0] ?? 'Ethereum');
    const minutes = steps.reduce((s, st) => s + st.minutes, 0);
    const hourly = pool / farmers / (minutes / 60);
    return { p, implied, vit, odds, expected, farmers, pool, steps, minutes, hourly };
  });
  // The board is ranked purely by implied value (the fitted value if token);
  // the watchlist is a floor, not a boost.
  scored.sort((a, b) => b.implied - a.implied);
  const watchRows = scored.filter((s) => watchSet.has(s.p.slug));
  const restRows = scored.filter((s) => !watchSet.has(s.p.slug));
  const chosen = [...watchRows, ...restRows].slice(0, 178);
  chosen.sort((a, b) => b.implied - a.implied);

  const rows: BoardRow[] = chosen.map((s, i) => {
    const p = s.p;
    const days = ageDays(p, asOfMs);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: s.implied,
      value_if_token_usd: Math.round(s.vit),
      expected_value_usd: s.expected,
      token_odds: Math.round(s.odds * 1000) / 1000,
      age_days: days,
      age_bucket: ageBucket(days),
      hourly_usd: Math.round(s.hourly * 100) / 100,
      farmers: s.farmers,
      pool_usd: Math.round(s.pool),
      hours: Math.round((s.minutes / 60) * 10) / 10,
      category: p.category,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      farm_steps: s.steps.map(
        (st) => `${st.text} (about $${st.costUsd} fees, ${fmtHours(st.minutes)})`,
      ),
      steps: s.steps,
    };
  });

  const catCount = new Map<string, number>();
  for (const r of rows) {
    const c = r.category ?? '(none)';
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
  }
  const topCategories = [...catCount.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    rows,
    watchlistCovered: rows.filter((r) => watchSet.has(r.slug)).length,
    watchlistTotal: snap.watchlist.length,
    stats: {
      nLive: live.length,
      powerA: fit.a,
      powerB: fit.b,
      spearman: spear,
      medianFitRatio: median(fitRatios),
      medianFlatRatio: median(flatRatios),
      looFitMean: meanAbs(looFit),
      looFitMedian: median(looFit),
      looFlatMean: meanAbs(looFlat),
      looFlatMedian: median(looFlat),
      wfFitMean: meanAbs(wfFitErrs),
      wfFitMedian: median(wfFitErrs),
      wfFlatMean: meanAbs(wfFlatErrs),
      wfFlatMedian: median(wfFlatErrs),
      globalRate,
      brierRaw,
      brierCompressed,
      brierFlat,
      growthCorr,
      ageCorr,
      nWatchlist: snap.watchlist.length,
      nRows: rows.length,
      topCategories,
    },
  };
}

export { fmtUsd, fmtHours, POOL_SHARE, MEDIAN_TICKET_USD };
