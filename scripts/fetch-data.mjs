// Fills data/ from the public repos before a build (see site-config/sources.json):
//   data/registry.json (+ .sig)  from registry/ in this repo
//   data/games/<id>/index.json (+ .sig)  byte for byte: they're signed, never touch them
//   data/games/<id>/game.json    (optional) and the media files it names
//   data/credits.json            (optional until the installer repo publishes it)
// Runs in CI only unless --force is given; locally the site builds from sample-data/.
// Any failure stops the build, so a broken fetch never publishes a half-empty site.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (!process.env.CI && !process.argv.includes('--force')) {
  console.log('fetch-data: not in CI, skipping (the site builds from sample-data/; use --force to fetch)');
  process.exit(0);
}

const sources = JSON.parse(fs.readFileSync(path.join(root, 'site-config', 'sources.json'), 'utf8'));
const out = path.join(root, 'data');
const tmp = path.join(root, 'data.tmp');
fs.rmSync(tmp, { recursive: true, force: true });

async function get(url, { optional = false } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dioramavr-site-build' } });
  if (res.status === 404 && optional) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
// A local path (relative to the repo) or a URL.
async function read(src, { optional = false } = {}) {
  if (/^https?:/.test(src)) return get(src, { optional });
  const f = path.join(root, src);
  if (!fs.existsSync(f)) {
    if (optional) return null;
    throw new Error(`fetch-data: ${src} doesn't exist`);
  }
  return fs.readFileSync(f);
}
const save = (rel, bytes) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); };
const safe = (rel) => { if (rel.includes('..') || path.isAbsolute(rel) || rel.includes('\\')) throw new Error(`unsafe path ${rel}`); return rel; };

if (!sources.registry) throw new Error('fetch-data: site-config/sources.json has no registry source yet');
const registryBytes = await read(sources.registry);
const registry = JSON.parse(registryBytes.toString('utf8'));
save('registry.json', registryBytes);
// The signature is required; the build's signature check says so if it's missing.
const registrySig = await read(sources.registry + '.sig', { optional: true });
if (registrySig) save('registry.json.sig', registrySig);

const creditsBytes = sources.credits && await read(sources.credits, { optional: true });
if (creditsBytes) save('credits.json', creditsBytes);

for (const g of registry.games) {
  const base = sources.games[g.id];
  if (!base) {
    if (g.status !== 'coming') throw new Error(`fetch-data: ${g.id} is ${g.status} but has no source in sources.json`);
    continue; // a coming game with no public repo yet: the page is built from the registry alone
  }
  const dir = `games/${g.id}`;
  if (g.status !== 'coming') {
    save(`${dir}/index.json`, await read(base + 'index.json'));
    const sig = await read(base + 'index.json.sig', { optional: true });
    if (sig) save(`${dir}/index.json.sig`, sig);
  }
  const info = await read(base + 'game.json', { optional: true });
  if (!info) continue;
  save(`${dir}/game.json`, info);
  const files = new Set(JSON.parse(info.toString('utf8')).media?.flatMap((m) => [m.file, m.poster]).filter(Boolean));
  for (const f of files) save(`${dir}/${safe(f)}`, await read(base + f));
  console.log(`fetch-data: ${g.id}: ${files.size} media file(s)`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.renameSync(tmp, out);
console.log('fetch-data: done');
