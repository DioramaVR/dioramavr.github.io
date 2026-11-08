// The one place the site reads its data. Everything is read at build time.
//
// The data folder (DVR_DATA_DIR, else `data/` if it exists, else `sample-data/`):
//   registry.json (+ .sig)            the registry the app reads (from registry/ in this repo)
//   games/<id>/index.json (+ .sig)    a game's index, served byte for byte
//   games/<id>/<id>-data.zip          the game's data zip (dvr-package SPEC section 11): its line, text,
//                                     known issues, credits and media; checked against the index's data
//                                     sha256 and size, read in memory, never unpacked to disk
//   games/<id>/game.json + media/*    older data from before the data zip (only when the index has no data)
//   credits.json                      the project's credits (from the installer repo; optional)
// In CI, scripts/fetch-data.mjs fills `data/` from the public repos before the build.
// Formats are owned by the installer repo; this file only reads them, never rewrites them.
import fs from 'node:fs';
import path from 'node:path';
import dvrPackage from 'dvr-package';   // the formats' JSON Schemas (github.com/DioramaVR/dvr-package)
import { verifyDataDir, siteTrustedKeys } from './verify.mjs';

// ---- Formats (only the fields the site uses; unknown fields are ignored) ----

export type Status = 'stable' | 'open-beta' | 'coming';
export type Maturity = 'stable' | 'open-beta';
export type Severity = 'minor' | 'annoying' | 'blocking';
// Words used before the maturity rename (2026-11-07), still accepted during the switch-over.
const LEGACY_STATUS: Record<string, Status> = { released: 'stable', beta: 'open-beta' };
const LEGACY_CHANNEL: Record<string, Maturity> = { stable: 'stable', beta: 'open-beta' };

export interface AppRelease { version: string; date: string; url: string; size: number; sha256: string }
export interface Announcement {
  id: string; from: string; until: string; title: string; text: string;
  link?: string; appVersions?: string;
}
export interface SetInfo { id: string; name: string; status: Status }
export interface RegistryGame {
  id: string; name: string; game: string; appid: number; status: Status;
  set?: string; index?: string;
  wave?: string;          // the new name for set (2026-11-07)
  closedBeta?: boolean;   // there's a closed beta on Patreon (never in an index)
}
export interface Registry {
  format: number;
  app?: { latest: string; url: string; message?: string; releases?: AppRelease[] };   // absent until the first installer release
  announcements?: Announcement[];
  movedTo?: string | null;
  sets?: SetInfo[];
  waves?: SetInfo[];      // the new name for sets (2026-11-07); either is read
  games: RegistryGame[];
}

export interface Release {
  version: string; maturity: Maturity; date: string; coreVersion?: string; minAppVersion?: string;
  testedBuildIds?: string[]; url: string; sha256: string; size: number; notes?: string;
  channel?: string;   // the old name for maturity
}
export interface KnownIssue { id: string; title: string; text: string; severity?: Severity; since?: string; fixedIn?: string | null }
export interface GameIndex {
  format: number; id: string; name: string; game: string; appid: number; description?: string;
  releases: Release[]; knownIssues?: KnownIssue[];
  data?: { url: string; sha256: string; size: number; date: string };   // the game's data zip
}
/** data.json in a game's data zip. */
interface GameData {
  format: number; id: string; line: string; firstLaunch?: string; needToKnow?: string[];
  knownIssues?: KnownIssue[]; owners?: { developer: string; publisher: string }; credits?: Credit[]; media?: Media[];
}

export interface Control { input: string; action: string; primary?: boolean }
export interface Media { file: string; kind: 'image' | 'video'; alt: string; poster?: string; role?: string; sources?: string[] }
export interface GameInfo {
  id: string; name?: string; game?: string; tagline?: string; description?: string;
  requirements?: string[]; controls?: Control[]; media?: Media[];
  firstLaunch?: string; needToKnow?: string[];   // MOD-DOWNLOADS section 5
  credits?: (Credit | string)[];                 // game-specific parts only, e.g. UEVR
  owners?: { developer?: string; publisher?: string };
}

/** credits.json (installer repo root; the installer's About screen shows the same file). */
export interface CreditsDoc { format?: number; title?: string; intro?: string; credits: Credit[]; notices?: string; disclaimer?: string }

/** A credit: in credits.json (site-wide) and in game.json (game-specific). */
export interface Credit {
  name: string; for?: string; license?: string; url?: string;
  support?: { label: string; url: string }[]; highlight?: boolean;
  notice?: string;   // where its licence notice is inside a download (not shown on the site)
}

/** Everything a page needs about one game. */
export interface Game extends RegistryGame {
  set?: string;
  setInfo?: SetInfo;
  index?: GameIndex;   // released and beta games only
  info?: GameInfo;     // from the data zip (or an older game.json)
  tagline?: string;
  latestStable?: Release;
  latestBeta?: Release;  // the newest open beta, only when it's newer than the latest stable
  openIssues: KnownIssue[];   // most severe first
  credits: Credit[];
  disclaimer: string;
  steamUrl: string;
}

// ---- Reading ----

const root = process.cwd();
export const dataDir = (() => {
  if (process.env.DVR_DATA_DIR) return path.resolve(root, process.env.DVR_DATA_DIR);
  const real = path.join(root, 'data');
  return fs.existsSync(path.join(real, 'registry.json')) ? real : path.join(root, 'sample-data');
})();
export const usingSample = path.basename(dataDir) === 'sample-data';
// Never publish sample data by accident: in CI the real data must be there.
if (usingSample && process.env.CI && !process.env.DVR_ALLOW_SAMPLE) {
  throw new Error('site data: no data/registry.json in CI (did scripts/fetch-data.mjs run?). Set DVR_ALLOW_SAMPLE=1 to build from sample-data/.');
}

const file = (...p: string[]) => path.join(dataDir, ...p);
const readJson = <T>(p: string): T => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`site data: can't read ${path.relative(root, p)}: ${(e as Error).message}`); }
};
const fail = (msg: string): never => { throw new Error(`site data: ${msg}`); };

/** Reads a data file and checks it against its dvr-package schema; the build stops listing every problem. */
function readChecked<T>(p: string, schema: 'registry' | 'index' | 'game' | 'known-issues'): T {
  const doc = readJson<T>(p);
  const problems: { path: string; message: string }[] = dvrPackage.schemas.validate(doc, schema);
  if (problems.length) {
    const list = problems.map((e) => `${e.path || '/'} ${e.message}`).join('\n  ');
    fail(`${path.relative(root, p)} doesn't match dvr-package's ${schema} schema:\n  ${list}`);
  }
  return doc;
}

/** The exact bytes of a JSON file the app reads (never re-serialised: indexes get signed). */
export const rawRegistry = () => fs.readFileSync(file('registry.json'));
export const rawIndex = (id: string) => fs.readFileSync(file('games', id, 'index.json'));
/** A signature file's exact bytes, or undefined when there is none (sample data is unsigned). */
export const rawSig = (...rel: string[]) => { const f = file(...rel); return fs.existsSync(f) ? fs.readFileSync(f) : undefined; };

/** Each game's data zip files (name -> bytes), once read and checked. */
const zipFiles = new Map<string, Map<string, Buffer>>();
/** A media file a game's data names ("media/<file>"), as bytes: from its data zip, or (older data) from disk. */
export function mediaBytes(id: string, rel: string): Buffer {
  load();
  const files = zipFiles.get(id);
  if (files) return files.get(rel) ?? fail(`${id}'s data zip has no ${rel}`);
  return fs.readFileSync(file('games', id, rel));
}

const KNOWN_FORMAT = 1;
const ID = /^[a-z0-9-]+$/;
const SET_ID = /^[0-9a-z.-]+$/;

let cache: { registry: Registry; games: Game[]; sets: SetInfo[]; credits: Credit[]; creditsPage: CreditsDoc } | undefined;

const status = (s: string, where: string): Status =>
  (['stable', 'open-beta', 'coming'] as string[]).includes(s) ? s as Status : LEGACY_STATUS[s] ?? fail(`${where}: unknown status "${s}"`);
const maturity = (r: Release, where: string): Maturity => {
  const m = r.maturity ?? LEGACY_CHANNEL[r.channel ?? ''];
  if (m !== 'stable' && m !== 'open-beta') fail(`${where} ${r.version}: maturity "${r.maturity ?? r.channel}" can't be in a public index`);
  return m;
};
const SEVERITY_ORDER: Record<string, number> = { blocking: 0, annoying: 1, minor: 2 };
const credit = (c: Credit | string): Credit => typeof c === 'string' ? { name: c } : c;

export function load() {
  if (cache) return cache;
  const registry = readChecked<Registry>(file('registry.json'), 'registry');
  if (registry.format > KNOWN_FORMAT) fail(`registry.json is format ${registry.format}; the site knows ${KNOWN_FORMAT}`);
  const sets = (registry.waves ?? registry.sets ?? []).map((s) => ({ ...s, status: status(s.status, `set ${s.id}`) }));
  for (const s of sets) if (!SET_ID.test(s.id)) fail(`set id "${s.id}" has characters outside [0-9a-z.-]`);
  // credits.json: { format, title, intro, credits: [...], disclaimer } (installer repo), or a bare list.
  const creditsDoc = fs.existsSync(file('credits.json')) ? readJson<CreditsDoc | Credit[]>(file('credits.json')) : undefined;
  const creditsPage: CreditsDoc = Array.isArray(creditsDoc) ? { credits: creditsDoc } : creditsDoc ?? { credits: [] };
  const credits = creditsPage.credits.map(credit);

  const games = registry.games.map((raw): Game => {
    if (!ID.test(raw.id)) fail(`game id "${raw.id}" has characters outside [a-z0-9-]`);
    const g = { ...raw, set: raw.wave ?? raw.set, status: status(raw.status, raw.id) };
    const dir = file('games', g.id);
    const hasIndex = g.status !== 'coming';
    const index = hasIndex ? readChecked<GameIndex>(path.join(dir, 'index.json'), 'index') : undefined;
    if (index && index.format > KNOWN_FORMAT) fail(`${g.id}/index.json is format ${index.format}`);
    if (index && index.id !== g.id) fail(`${g.id}/index.json says its id is "${index.id}"`);
    let info: GameInfo | undefined;
    let knownIssues = index?.knownIssues;
    if (index?.data) {
      // The data zip: dvr-package checks its size and SHA-256 against the index (whose signature
      // is checked below), then its names, data.json and every file, in plain Node.
      const zip = path.join(dir, `${g.id}-data.zip`);
      if (!fs.existsSync(zip)) fail(`${g.id}'s index names a data zip, but ${path.relative(root, zip)} isn't there (did fetch-data run?)`);
      let read: { data: GameData; files: Map<string, Buffer> };
      try { read = dvrPackage.dataZip.read(zip, { sha256: index.data.sha256, size: index.data.size, id: g.id }); }
      catch (e) { return fail(`${g.id}'s data zip: ${(e as Error).message}`); }
      zipFiles.set(g.id, read.files);
      const d = read.data;
      info = { id: g.id, tagline: d.line, firstLaunch: d.firstLaunch, needToKnow: d.needToKnow, credits: d.credits, owners: d.owners, media: d.media };
      if (d.knownIssues) knownIssues = d.knownIssues;
    } else if (fs.existsSync(path.join(dir, 'game.json'))) {
      info = readChecked<GameInfo>(path.join(dir, 'game.json'), 'game');
      if (fs.existsSync(path.join(dir, 'known-issues.json'))) readChecked(path.join(dir, 'known-issues.json'), 'known-issues');
      for (const m of info.media ?? []) {
        if (m.file.includes('..') || path.isAbsolute(m.file)) fail(`${g.id}/game.json media path "${m.file}"`);
        if (!fs.existsSync(path.join(dir, m.file))) fail(`${g.id}/game.json names ${m.file}, which isn't there`);
      }
    }

    const releases = (index?.releases ?? []).map((r) => ({ ...r, maturity: maturity(r, g.id) })).sort(byNewest);
    const latestStable = releases.find((r) => r.maturity === 'stable');
    const beta = releases.find((r) => r.maturity === 'open-beta');
    const latestBeta = beta && (!latestStable || newer(beta, latestStable)) ? beta : undefined;
    const openIssues = (knownIssues ?? []).filter((i) => !i.fixedIn)
      .sort((a, b) => (SEVERITY_ORDER[a.severity ?? 'minor'] ?? 2) - (SEVERITY_ORDER[b.severity ?? 'minor'] ?? 2));
    const owners = [info?.owners?.developer, info?.owners?.publisher].filter((o, i, all): o is string => !!o && all.indexOf(o) === i);

    return {
      ...g,
      setInfo: sets.find((s) => s.id === g.set),
      index: index && { ...index, releases },
      info,
      tagline: info?.tagline ?? index?.description,
      latestStable, latestBeta, openIssues,
      credits: (info?.credits ?? []).map(credit),
      disclaimer: `${g.game} is a trademark of its owners. DioramaVR is an unofficial fan mod, not affiliated with or endorsed by ${owners.length ? owners.join(' or ') : 'them'}.`,
      steamUrl: `https://store.steampowered.com/app/${g.appid}/`,
    };
  });

  // Every signed file must check out against the trusted keys, or the build stops and the
  // last good version stays live. Only the made-up sample data is unsigned.
  const signed = games.filter((g) => g.status !== 'coming').map((g) => g.id);
  if (usingSample) console.log('site data: sample data, signatures not checked');
  else {
    const problems = verifyDataDir(dataDir, signed, siteTrustedKeys(root));
    if (problems.length) fail(`signature check failed:\n  ${problems.join('\n  ')}`);
  }

  cache = { registry, games, sets, credits, creditsPage: { ...creditsPage, credits } };
  return cache;
}

// ---- Derived data for the pages ----

/** Sets in registry order, each with its games; games with no (known) set come after, on their own. */
export function gamesBySet() {
  const { games, sets } = load();
  const grouped = sets.map((set) => ({ set, games: games.filter((g) => g.set === set.id) })).filter((s) => s.games.length);
  const alone = games.filter((g) => !g.setInfo);
  return { grouped, alone };
}

export function installer() {
  const { app } = load().registry;
  if (!app) return { latestVersion: undefined, latest: undefined, releases: [] as AppRelease[], pageUrl: undefined };
  const releases = [...(app.releases ?? [])].sort((a, b) => cmpVersion(b.version, a.version));
  const latest = releases.find((r) => r.version === app.latest);
  return { latestVersion: app.latest, latest, releases, pageUrl: app.url };
}

/** The announcements showing today (UTC, both ends inclusive). Ones aimed at certain app versions are for the app only. */
export function currentAnnouncements(today = new Date().toISOString().slice(0, 10)) {
  return (load().registry.announcements ?? []).filter((a) => !a.appVersions && a.from <= today && today <= a.until);
}

/** A link from the data, made relative when it points at this site, so the site works on any host. */
export function siteLink(url: string) {
  const m = /^https:\/\/(?:dioramavr\.app|dioramavr\.github\.io)(\/.*)?$/.exec(url);
  return m ? (m[1] || '/') : url;
}

/** A game's media by role (MOD-DOWNLOADS section 5: hero | turntable | gallery | hover; no role = gallery).
 *  game.json files from before roles existed have none at all: then the first image is the hero and the first video the turntable. */
export function pickMedia(info?: GameInfo) {
  const media = info?.media ?? [];
  const hasRoles = media.some((m) => m.role);
  const role = (m: Media) => m.role ?? (hasRoles ? 'gallery' : undefined);
  const shown = media.filter((m) => role(m) !== 'hover');
  const hero = shown.find((m) => role(m) === 'hero') ?? (hasRoles ? undefined : shown.find((m) => m.kind === 'image'));
  const turntable = shown.find((m) => role(m) === 'turntable') ?? (hasRoles ? undefined : shown.find((m) => m.kind === 'video'));
  const gallery = shown.filter((m) => m !== hero && m !== turntable && m.kind === 'image');
  // The turntable's other encodings (data zip media[].sources, type from the extension: an MP4 for
  // Safari). The browser plays the first it can, so MP4 goes first (Safari claims WebM but shows it differently).
  const videoType = (f: string) => (/\.mp4$/i.test(f) ? 'video/mp4' : 'video/webm');
  const turntableSources = !turntable ? [] : [turntable.file, ...(turntable.sources ?? [])]
    .map((file) => ({ file, type: videoType(file) }))
    .sort((a, b) => Number(b.type === 'video/mp4') - Number(a.type === 'video/mp4'));
  return { hero, turntable, turntableSources, gallery };
}

/** URL of a game's media file on this site. */
export const mediaUrl = (id: string, rel: string) => `/${id}/${rel}`;

// ---- Small helpers ----

function newer(a: Release, b: Release) { return byNewest(a, b) < 0; }
function byNewest(a: Release, b: Release) { return b.date.localeCompare(a.date) || cmpVersion(b.version, a.version); }

/** Compares dotted versions numerically ("1.10.0" > "1.9.0"); a pre-release suffix sorts before the plain version. */
export function cmpVersion(a: string, b: string) {
  const [ma, pa = ''] = a.split('-', 2), [mb, pb = ''] = b.split('-', 2);
  const xa = ma.split('.').map(Number), xb = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const d = (xa[i] ?? 0) - (xb[i] ?? 0);
    if (d) return d;
  }
  if (pa === pb) return 0;
  return !pa ? 1 : !pb ? -1 : pa.localeCompare(pb);
}

export const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtSize = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MB';
// Waves (MOD-DOWNLOADS section 3, 2026-11-07): ids are stable slugs, names are display text shown alone.
export const setLabel = (s: SetInfo) => s.name;
export const statusLabel: Record<Status, string> = { stable: 'Out now', 'open-beta': 'Open beta', coming: 'In testing' };
export const maturityLabel: Record<Maturity, string> = { stable: 'Stable', 'open-beta': 'Open beta' };
export const severityLabel: Record<Severity, string> = { blocking: 'Blocking', annoying: 'Annoying', minor: 'Minor' };
