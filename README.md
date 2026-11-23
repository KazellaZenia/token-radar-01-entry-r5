[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/KazellaZenia/token-radar-01-entry-r5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/KazellaZenia/token-radar-01-entry-r5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Beacon Radar v3 — the token launch radar

Built for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01) ($1,325 in USDC).

A radar that ranks pre-token protocols by the **expected value** of the token they may one day issue — every number fitted or counted from the sealed snapshot, no hardcoded list of names.

## The value model (all of it, in the open)

- **Implied value:** the value *if* the token is issued — `log(mcap) = a + b·log(TVL)`, a power law fit on the 128 live-token protocols in the snapshot (refit on every run). Leave-one-out error 1.60 vs 1.78 for a flat 0.30×TVL; walk-forward 1.56 vs 1.83; Spearman 0.44; median fitted/actual 0.95 vs flat 1.46. The board's implied values *are* the fitted predictions, so they sit in the same ballpark as the market caps the law was fit on.
- **Token odds:** age-driven only. Category token rates are an age artifact — no Risk Curator older than 2 years exists in the snapshot, so its 0/22 rate would punish the board's top protocols. Brier-tested (compressed 0.150 vs flat 0.154; raw age rates 0.145), compressed ×0.3 toward the 17.0% global rate. The odds give the **expected value** (implied × odds) and the farm $/hour — they do not shrink the implied value.
- **7d growth:** tested, no weight. It correlates −0.15 with the value ratio and does not predict issuance, so it is displayed for every protocol but given no weight in the value.
- **$/hour:** pool = 10% of the expected value (stated assumption) ÷ farmers (TVL ÷ $5,000 median deposit, stated assumption) ÷ plan hours. Per protocol, shown with the arithmetic.

## The board

178 rows: the 40-protocol watchlist (all covered) plus the 138 highest expected-value pre-token protocols. Protocols whose token already trades — CEXs, bridges, wrapped/staked products, versioned variants, and variants of a tokenized parent — are excluded by a rule derived from the snapshot's own fields, and the board says so.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. The program writes `board.json`, `data.js`, the dashboard, the screenshots and `dossier.json` into the output directory, deterministically.
