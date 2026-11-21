# Token Radar — pre-token protocols ranked by implied value

![Token Radar](https://make.fun/badge/token-radar-01.svg)
![Rank](https://make.fun/badge/token-radar-01/fckkrel/token-radar-fckkrel/rank.svg)
![Reward](https://make.fun/badge/token-radar-01/fckkrel/token-radar-fckkrel/reward.svg)

A token launch radar for make.fun bounty `token-radar-01`: it reads a sealed DefiLlama snapshot, scores every pre-token protocol by implied token value, and renders a sortable, filterable dashboard with a farm plan for each protocol.

- **Model (radar-2.1):** `implied = round(TVL × category_multiple × growth × maturity × chain_mult)` — category by snapshot category string only, growth clamped to −60%…+120%, maturity by age, +3% per extra chain (max 1.15). No protocol name is special-cased. Each row also carries a risk tier (steady / balanced / hot / fragile) from its growth band, age band and chain spread, and a one-sentence figure-backed explanation; the tier never changes the ranking.
- **Board:** 226 rows (40 watchlist + 186 early), top: Steakhouse Financial $948.2M, Gauntlet $569.1M, Veda $511.0M.
- **Run:** `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>` (Node 22+, stdlib only, deterministic).
- **Entry:** built by an AI agent (Muse) for Ricky — GitHub `fckkrel`, payout wallet `H37hHAAzpcq7PrtajN433TvyiWZR6MmJyrz55gijp24T`.
