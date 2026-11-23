// Beacon Radar v3 — token-radar-01 round 5 entrypoint.
//
// Reads the sealed snapshot, builds the board with lib/model.ts, and writes the
// graded outputs: board.json, the dashboard data, the dashboard itself, the
// screenshots, and the dossier. Deterministic: the same snapshot bytes give the
// same output bytes on every run (no clock, no randomness, fixed key order).

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function main(): void {
  const inputPath = argValue('--input') ?? '/input/snapshot.json';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? argValue('--output') ?? 'out';
  const snap = JSON.parse(readFileSync(inputPath, 'utf8'));
  const built = buildBoard(snap);
  const { rows, stats } = built;

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  // Board: the graded ranking. Extra keys are allowed; the judge reads the
  // arithmetic from the dashboard, so the board carries it too.
  const boardRows = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    value_if_token_usd: r.value_if_token_usd,
    expected_value_usd: r.expected_value_usd,
    token_odds: r.token_odds,
    age_bucket: r.age_bucket,
    hourly_usd: r.hourly_usd,
    farm_steps: r.farm_steps,
  }));
  writeFileSync(
    join(outDir, 'board.json'),
    JSON.stringify({ rows: boardRows }, null, 2) + '\n',
  );

  // Dashboard data, beside the page (the page loads it as ../data.js).
  const data = {
    generated_from: snap.as_of,
    stats,
    watchlist_covered: built.watchlistCovered,
    watchlist_total: built.watchlistTotal,
    rows: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      rank: r.rank,
      implied: r.implied_value_usd,
      valueIfToken: r.value_if_token_usd,
      expected: r.expected_value_usd,
      odds: r.token_odds,
      ageBucket: r.age_bucket,
      ageDays: r.age_days,
      hourly: r.hourly_usd,
      farmers: r.farmers,
      pool: r.pool_usd,
      hours: r.hours,
      category: r.category,
      tvl: r.tvl_usd,
      change7d: r.change_7d,
      steps: r.steps,
    })),
  };
  writeFileSync(join(outDir, 'data.js'), `window.BEACON_DATA = ${JSON.stringify(data)};\n`);

  // Dashboard + screenshots into the output tree.
  cpSync(join(HERE, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(HERE, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  // Dossier, exactly as the scorer's own library writes it.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 512 * 1024 },
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const total = rows.length;
  console.log(
    `token radar: ${snap.protocols.length} protocols, ${stats.nWatchlist} on the watchlist, ${total} rows scored (${built.watchlistCovered}/${built.watchlistTotal} watchlist covered)`,
  );
  console.log(
    `token radar: power law log(mcap) = ${stats.powerA.toFixed(4)} + ${stats.powerB.toFixed(4)} log(TVL); LOO fit ${stats.looFitMean.toFixed(4)} vs flat ${stats.looFlatMean.toFixed(4)}; Brier raw ${stats.brierRaw.toFixed(4)} compressed ${stats.brierCompressed.toFixed(4)} vs flat ${stats.brierFlat.toFixed(4)}`,
  );
  console.log(`token radar: wrote ${outDir}/board.json, ${outDir}/data.js, ${outDir}/dashboard (3 files), ${outDir}/screenshots (3 images) and ${outDir}/dossier.json`);
}

main();
