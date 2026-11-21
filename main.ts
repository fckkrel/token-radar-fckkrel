// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardStats, boardStatsLines, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

/** A one-line census of the board's risk tiers, for the run log and for a
 *  human checking the output without opening the dashboard. The census is
 *  computed from the finished board, never from a draft, and it counts the
 *  same tiers the dashboard's summary strip shows, so the log and the page
 *  can never disagree about the board they describe. */
function tierCensusLine(board: { risk_tier?: string }[], snapshot: { protocols: { slug: string; change_7d: number | null; chains: string[] }[] }): string {
  const counts = { steady: 0, balanced: 0, hot: 0, fragile: 0 };
  for (const row of board) {
    const tier = (row as { risk_tier?: string }).risk_tier;
    if (tier === 'steady' || tier === 'balanced' || tier === 'hot' || tier === 'fragile') counts[tier] += 1;
  }
  return `risk tiers: steady ${counts.steady}, balanced ${counts.balanced}, hot ${counts.hot}, fragile ${counts.fragile}`;
}

/** The board's top ten, as one log line, so a run's headline is checkable
 *  without opening board.json. Only slugs and implied values are printed:
 *  names are in the board itself, and the log stays short enough to read. */
function topTenLine(board: { slug: string; implied_value_usd: number }[]): string {
  return board.slice(0, 10).map((r, i) => `${i + 1}. ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`).join(' | ');
}

/** The five biggest categories, as log lines, so a run's market shape is
 *  checkable without opening the dashboard. The sentences are the same ones
 *  the dashboard shows, copied from the radar data, so the log and the page
 *  can never disagree about which category leads the board. */
function categoryLines(radar: { category_top?: string[] }): string {
  const lines = radar.category_top ?? [];
  if (lines.length === 0) return 'token radar: categories: not listed';
  return `token radar: categories:\n${lines.map((s) => `token radar:   ${s}`).join('\n')}`;
}

/** The board's headline statistics, as log lines, from the model's own
 *  boardStats function. The log prints them after the top ten, so a run's
 *  output tells a reader the board's size, its median row and its total
 *  implied value without them opening a single file. */
function statsLines(board: { slug: string; implied_value_usd: number; category: string | null; chains: string[] }[], snapshot: { watchlist: string[] }): string {
  const stats = boardStats(board as never, snapshot as never);
  return boardStatsLines(stats).map((s) => `token radar: ${s}`).join('\n');
}

/** A second, independent check that every dashboard row carries the risk
 *  fields radar-2.1 promises. The gate checks the board; this checks the
 *  dashboard's own data, so a missing tier is caught here, at build time,
 *  instead of silently showing a blank badge in the page. The check also
 *  requires an explanation of at least twenty characters, because a badge
 *  without its sentence would leave the reader guessing what the tier means. */
function dashboardRowsIssue(radar: { rows: { slug: string; risk_tier?: string; explanation?: string }[] }): string | null {
  for (const r of radar.rows) {
    if (!r.risk_tier) return `${r.slug} has no risk_tier in data.js`;
    if (!r.explanation || r.explanation.length < 20) return `${r.slug} has no explanation in data.js`;
  }
  return null;
}

const dashboardIssue = dashboardRowsIssue(radar);
if (dashboardIssue !== null) {
  process.stderr.write(`token radar: the dashboard data is incomplete: ${dashboardIssue}\n`);
  process.exit(1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n` +
    `token radar: top ten: ${topTenLine(board)}\n` +
    `token radar: ${tierCensusLine(radar.rows as never, snapshot as never)}\n` +
    `${categoryLines(radar)}\n` +
    `${statsLines(board, snapshot)}\n`,
);
