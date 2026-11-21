// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   category   = category_multiple[category] or 0.25 (vault/curator 0.38, lending 0.32,
//                dex/yield/derivatives 0.30, RWA/basis 0.24, chain/payments 0.20, bridge/staking 0.18)
//   base       = tvl_usd x category_multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4, x0.85 if age < 90d, x0.95 if age > 1500d
//   chainMult  = 1 + min(max(chains-1, 0), 5) x 0.03
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Per-category token-launch multiple: vault/curator-style protocols launch points/tokens
      more often than infra; the map is by category string, never by protocol name. */
  category_multiple: Record<string, number>;
  default_multiple: number;
  /** +3% implied value per extra chain, capped at 5 extra chains (max 1.15). */
  chain_step: number;
  chain_cap: number;
  /** Protocols listed <90 days get 0.85 (too early to judge); >1500 days get 0.95. */
  young_days: number;
  young_penalty: number;
  old_days: number;
  old_decay: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_multiple: {
    'Risk Curators': 0.38,
    'Onchain Capital Allocator': 0.36,
    'Lending': 0.32,
    'CDP': 0.32,
    'Dexs': 0.3,
    'Yield': 0.3,
    'Derivatives': 0.3,
    'Perpetuals': 0.3,
    'RWA': 0.24,
    'Basis Trading': 0.24,
    'Stablecoin': 0.22,
    'Stablecoin Wrapper': 0.22,
    'Insurance': 0.22,
    'Chain': 0.2,
    'Payments': 0.2,
    'Bridge': 0.18,
    'Liquid Staking': 0.18,
    'Restaking': 0.18,
    'Staking Pool': 0.18,
  },
  default_multiple: 0.25,
  chain_step: 0.03,
  chain_cap: 5,
  young_days: 90,
  young_penalty: 0.85,
  old_days: 1500,
  old_decay: 0.95,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2.1';

/** A risk tier for one row, read off the snapshot figures alone, never off a name.
 *  The tier is a plain-language summary of how much of the implied value rests on
 *  growth that has already happened, on a young protocol, or on a single chain.
 *  It never changes the ranking: the board is still ordered by implied value only.
 *  A tier is useful because a farmer's risk is not the same as a protocol's size:
 *  a huge, flat, single-chain protocol and a smaller, fast-growing, multi-chain one
 *  can share a rank and still need very different farm plans and hold times. */
export type RiskTier = 'steady' | 'balanced' | 'hot' | 'fragile';

/** The bands the tier, the dashboard badge and the detail drawer all read from.
 *  Growth is the 7-day change, clamped the same way the model clamps it, so the
 *  band and the multiplier can never disagree about the same protocol. */
export function growthBand(change7d: number | null): 'falling' | 'flat' | 'rising' | 'surging' {
  const g = change7d ?? 0;
  if (g < -5) return 'falling';
  if (g < 2) return 'flat';
  if (g < 15) return 'rising';
  return 'surging';
}

/** The age band, in the model's own words: young is under 90 days, seasoned is
 *  over a year, and the middle band is everything in between. Unknown age is
 *  treated as seasoned-middle, the same 365 days the model itself assumes. */
export function ageBand(ageDays: number | null): 'young' | 'growing' | 'seasoned' {
  const age = ageDays ?? 365;
  if (age < 90) return 'young';
  if (age < 365) return 'growing';
  return 'seasoned';
}

/** How spread out a protocol is across chains: one chain is a single point of
 *  failure, two or three is a normal multi-chain deployment, four or more is
 *  genuinely diversified. The count is the snapshot's own chains array. */
export function chainSpread(chains: string[]): 'single-chain' | 'multi-chain' | 'widely-spread' {
  const n = chains.length;
  if (n <= 1) return 'single-chain';
  if (n <= 3) return 'multi-chain';
  return 'widely-spread';
}

/** The risk tier, from the three bands above, in priority order.
 *  Fragile first: a falling protocol that is also young is fragile whatever its
 *  size, because both its price direction and its track record point the same way.
 *  Hot next: a surging protocol is hot even when it is seasoned, because the
 *  implied value leans on a move that may not repeat next week.
 *  Steady last: a flat or rising, seasoned, multi-chain protocol is steady, and
 *  everything else lands in the middle as balanced. */
export function riskTierFor(p: SnapshotProtocol, age: number | null): RiskTier {
  const growth = growthBand(p.change_7d);
  const ageB = ageBand(age);
  const spread = chainSpread(p.chains);
  if (growth === 'falling' && ageB === 'young') return 'fragile';
  if (growth === 'falling' && spread === 'single-chain') return 'fragile';
  if (growth === 'surging') return 'hot';
  if (growth === 'rising' && ageB === 'young') return 'hot';
  if ((growth === 'flat' || growth === 'rising') && ageB === 'seasoned' && spread !== 'single-chain') return 'steady';
  return 'balanced';
}

/** One row's score breakdown, in the same numbers the board and the detail
 *  drawer already show, plus the three bands above. The breakdown exists so a
 *  reader can see, without re-running the model, which input moved a row up or
 *  down: a high category multiple, a growth multiplier above one, a maturity
 *  multiplier below one, or a chain multiplier at its cap. */
export interface ScoreBreakdown {
  rank: number;
  slug: string;
  name: string;
  tvl_usd: number;
  implied_value_usd: number;
  category_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  growth_band: 'falling' | 'flat' | 'rising' | 'surging';
  age_band: 'young' | 'growing' | 'seasoned';
  chain_spread: 'single-chain' | 'multi-chain' | 'widely-spread';
  risk_tier: RiskTier;
  /** The single biggest driver of this row's implied value, named in words. */
  driver: string;
  /** A one-sentence, figure-backed explanation of the row, for the detail drawer. */
  explanation: string;
}

/** The biggest driver, chosen by which multiplier is furthest from one.
 *  Category is the base, so it only wins when it is the top multiple; growth
 *  wins on a big positive week; maturity wins on a very young or very old age;
 *  chain wins only at the cap, where five extra chains are doing real work. */
export function driverFor(categoryMult: number, growthMult: number, maturityMult: number, chainMult: number): string {
  const moves: Array<[string, number]> = [
    ['category', Math.abs(categoryMult - 0.25)],
    ['growth', Math.abs(growthMult - 1)],
    ['maturity', Math.abs(maturityMult - 1)],
    ['chain breadth', Math.abs(chainMult - 1)],
  ];
  moves.sort((a, b) => b[1] - a[1]);
  const top = moves[0]![0];
  if (top === 'category') return 'category multiple';
  if (top === 'growth') return 'seven-day growth';
  if (top === 'maturity') return 'age and maturity';
  return 'chain breadth';
}

/** Build one row's breakdown from the figures impliedValue already computed.
 *  The explanation is deliberately boring: it restates the numbers, names the
 *  driver, and names the tier, so a reader can check it against the board
 *  without trusting any adjective. */
export function breakdownFor(row: BoardRow, p: SnapshotProtocol): ScoreBreakdown {
  const growth = growthBand(p.change_7d);
  const ageB = ageBand(row.age_days);
  const spread = chainSpread(p.chains);
  const tier = riskTierFor(p, row.age_days);
  const driver = driverFor(row.model.category_multiplier, row.model.growth_multiplier, row.model.maturity_multiplier, row.model.chain_multiplier);
  const explanation =
    `${row.name} is ranked ${row.rank} of the board with an implied value of $${row.implied_value_usd.toLocaleString('en-US')} ` +
    `on $${row.tvl_usd.toLocaleString('en-US')} of TVL. Its biggest driver is ${driver}, its seven-day growth is ${growth}, ` +
    `its age band is ${ageB}, and it is ${spread}. Risk tier: ${tier}.`;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    tvl_usd: row.tvl_usd,
    implied_value_usd: row.implied_value_usd,
    category_multiplier: row.model.category_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    growth_band: growth,
    age_band: ageB,
    chain_spread: spread,
    risk_tier: tier,
    driver,
    explanation,
  };
}

/** The board's tier census: how many rows fall in each risk tier, and which
 *  tier the top ten belong to. The dashboard's summary strip reads this, so a
 *  reader sees at a glance whether the top of the board is steady or hot. */
export interface TierCensus {
  steady: number;
  balanced: number;
  hot: number;
  fragile: number;
  top_ten_tiers: RiskTier[];
}

/** The board's category census: the five biggest categories by row count,
 *  with their total implied value, so a reader can see at a glance whether
 *  the board is dominated by curators, by RWA, or by something else entirely.
 *  The census is a summary, never a ranking: it counts rows the board already
 *  ranked, and it never moves a row. */
export interface CategoryCensusRow {
  category: string;
  rows: number;
  total_implied_value_usd: number;
  top_slug: string;
}

/** Count the board by category, strongest total implied value first.
 *  A category with one huge row and a category with many small rows can
 *  share a total, so the census lists both the count and the total, and
 *  names the top row in each category, so neither fact hides the other. */
export function categoryCensus(board: BoardRow[]): CategoryCensusRow[] {
  const byCategory = new Map<string, { rows: number; total: number; top: BoardRow }>();
  for (const row of board) {
    const key = row.category ?? 'Other';
    const entry = byCategory.get(key);
    if (!entry) {
      byCategory.set(key, { rows: 1, total: row.implied_value_usd, top: row });
    } else {
      entry.rows += 1;
      entry.total += row.implied_value_usd;
      if (row.implied_value_usd > entry.top.implied_value_usd) entry.top = row;
    }
  }
  return [...byCategory.entries()]
    .map(([category, entry]) => ({
      category,
      rows: entry.rows,
      total_implied_value_usd: entry.total,
      top_slug: entry.top.slug,
    }))
    .sort((a, b) => b.total_implied_value_usd - a.total_implied_value_usd || (a.category < b.category ? -1 : 1))
    .slice(0, 5);
}

/** One sentence per top category, for the dashboard's category strip.
 *  The sentence names the category, its row count, its total implied value
 *  and its top protocol, in that order, so a reader can compare categories
 *  without opening the table. */
export function categorySentences(board: BoardRow[]): string[] {
  return categoryCensus(board).map(
    (c) => `${c.category}: ${c.rows} rows, $${c.total_implied_value_usd.toLocaleString('en-US')} implied in total, led by ${c.top_slug}.`,
  );
}

/** The board's headline statistics, in one object, for the run log and for
 *  any reader who wants the board's shape without counting rows by hand.
 *  Every figure is a count or a sum over the finished, ranked board, so the
 *  statistics can never disagree with the board they describe. */
export interface BoardStats {
  rows: number;
  watchlist_rows: number;
  early_rows: number;
  total_implied_value_usd: number;
  median_implied_value_usd: number;
  top_implied_value_usd: number;
  bottom_implied_value_usd: number;
  categories: number;
  chains: number;
}

/** Compute the headline statistics from a finished board. The median is the
 *  middle row's implied value, or the mean of the two middle rows when the
 *  board has an even number of rows, so it is the board's own middle, not an
 *  average pulled up by the top row's size. */
export function boardStats(board: BoardRow[], snapshot: Snapshot): BoardStats {
  const values = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid]! : Math.round(((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2);
  const categories = new Set(board.map((r) => r.category ?? 'Other')).size;
  const chains = new Set(board.flatMap((r) => r.chains)).size;
  return {
    rows: board.length,
    watchlist_rows: board.filter((r) => snapshot.watchlist.includes(r.slug)).length,
    early_rows: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    total_implied_value_usd: values.reduce((a, b) => a + b, 0),
    median_implied_value_usd: median,
    top_implied_value_usd: values[values.length - 1] ?? 0,
    bottom_implied_value_usd: values[0] ?? 0,
    categories,
    chains,
  };
}

/** The headline statistics as log lines, so a run's shape is checkable
 *  without opening board.json or the dashboard. The lines are the same
 *  figures the dashboard's lede shows, so the log and the page agree. */
export function boardStatsLines(stats: BoardStats): string[] {
  return [
    `${stats.rows} rows (${stats.watchlist_rows} watchlist, ${stats.early_rows} early) across ${stats.categories} categories and ${stats.chains} chains`,
    `total implied value $${stats.total_implied_value_usd.toLocaleString('en-US')}, median $${stats.median_implied_value_usd.toLocaleString('en-US')}, top $${stats.top_implied_value_usd.toLocaleString('en-US')}, bottom $${stats.bottom_implied_value_usd.toLocaleString('en-US')}`,
  ];
}

/** Count the tiers across a finished board. The board must already be ranked;
 *  the census never reorders anything, it only counts what is there. */
export function tierCensus(board: BoardRow[], snapshot: Snapshot): TierCensus {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const census: TierCensus = { steady: 0, balanced: 0, hot: 0, fragile: 0, top_ten_tiers: [] };
  board.forEach((row, i) => {
    const p = index.get(row.slug);
    if (!p) return;
    const tier = riskTierFor(p, row.age_days);
    census[tier] += 1;
    if (i < 10) census.top_ten_tiers.push(tier);
  });
  return census;
}

/** A short, honest warning for a tier, shown beside the badge in the detail
 *  drawer. Steady is not safe, it is only steadier; fragile is not doomed, it
 *  only needs a smaller position and a shorter hold than the farm plan assumes.
 *  The warning is deliberately the same wording the dashboard shows, so the
 *  model's own text and the page's text can never drift apart in a later edit. */
export function tierWarning(tier: RiskTier): string {
  if (tier === 'steady') return 'Steady means the figures behind this row have moved slowly. It is not a promise the token, if it launches, will be worth the implied value.';
  if (tier === 'balanced') return 'Balanced means no single input dominates this row. Check the farm plan against the protocol\'s own points page before committing capital.';
  if (tier === 'hot') return 'Hot means the implied value leans on a recent surge. A surge can reverse in a week, so hold the position only as long as the farm plan says and log every step.';
  return 'Fragile means the protocol is falling, young, or on one chain. Use the smallest capital the farm plan allows and do not extend the hold beyond the plan.';
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page.
 *  The risk fields are new in radar-2.1: they are derived from the same snapshot
 *  figures as the implied value, they never change the ranking, and the dashboard
 *  shows them as a badge, a band and a one-sentence explanation in the detail drawer. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiplier: number;
  chain_multiplier: number;
  risk_tier: RiskTier;
  chain_count: number;
  growth_band: 'falling' | 'flat' | 'rising' | 'surging';
  age_band: 'young' | 'growing' | 'seasoned';
  explanation: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs.
 *  The tier census is new in radar-2.1: a count of risk tiers across the board,
 *  so the dashboard can summarise the top of the board without re-scoring it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  tier_census: TierCensus;
  /** The five biggest categories, as one sentence each, for the dashboard. */
  category_top: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function categoryMultiple(protocol: SnapshotProtocol, model: ModelConstants): number {
  return model.category_multiple[protocol.category ?? ''] ?? model.default_multiple;
}
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; categoryMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  if (age !== null && age < model.young_days) maturityMult *= model.young_penalty;
  if (age !== null && age > model.old_days) maturityMult *= model.old_decay;
  const categoryMult = categoryMultiple(protocol, model);
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap) * model.chain_step;
  const base = protocol.tvl_usd * categoryMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, categoryMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: round4(s.categoryMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiplier: round4(s.categoryMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana') || c.includes('base') || c.includes('arbitrum') || c.includes('optimism')) return 'about $1 of gas';
  if (c.includes('ethereum')) return 'about $8 of gas';
  return 'about $3 of gas';
}
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'Make one qualifying action each week: a deposit, a borrow, or a repayment.';
  if (c.includes('dex') || c.includes('yield')) return 'Make one qualifying action each week: a swap or a liquidity deposit in the main pool.';
  if (c.includes('curator') || c.includes('allocator')) return 'Make one qualifying action each week: a vault deposit or a reallocation vote.';
  if (c.includes('rwa')) return 'Make one qualifying action each week: a mint, a deposit, or a claim on the yield asset.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Make one qualifying action each week: one small trade or a margin top-up.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: `${gasFor(chain)} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page on ${chain} and check whether your wallet earned points; claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page.
 *  The risk fields are computed here, in the model, not in the page: the page
 *  only displays what the model already decided, so the badge and the board can
 *  never disagree about the same row. The explanation is the breakdown's own
 *  sentence, copied whole, so the detail drawer and the model say the same thing. */
export function radarRow(row: BoardRow, snapshot: Snapshot): RadarRow {
  const p = snapshot.protocols.find((x) => x.slug === row.slug);
  const breakdown = p ? breakdownFor(row, p) : null;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiplier: row.model.category_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    risk_tier: breakdown ? breakdown.risk_tier : 'balanced',
    chain_count: row.chains.length,
    growth_band: breakdown ? breakdown.growth_band : growthBand(row.change_7d),
    age_band: breakdown ? breakdown.age_band : ageBand(row.age_days),
    explanation: breakdown ? breakdown.explanation : `${row.name} is ranked ${row.rank} with an implied value of $${row.implied_value_usd.toLocaleString('en-US')}.`,
  };
}

/** Everything the dashboard renders, from the snapshot.
 *  The census is computed from the finished, ranked board, so it counts the
 *  board the reader actually sees, not a draft of it. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot)),
    live,
    tier_census: tierCensus(board, snapshot),
    category_top: categorySentences(board),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
