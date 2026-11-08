// Fills data/ before a build (see site-config/sources.json):
//   data/registry.json (+ .sig)            from registry/ in this repo
//   data/credits.json                      (optional until the installer repo publishes it)
//   for each open-beta or stable game, from the index URL the registry gives it:
//   data/games/<id>/index.json (+ .sig)    byte for byte: they're signed, never touch them
//   data/games/<id>/<id>-data.zip          the data zip the index names (data.url), as it is;
//                                          the build checks it against the index's sha256 and size
// Coming games have no index: their pages are built from the registry alone.
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

if (!sources.registry) throw new Error('fetch-data: site-config/sources.json has no registry source yet');
const registryBytes = await read(sources.registry);
const registry = JSON.parse(registryBytes.toString('utf8'));
save('registry.json', registryBytes);
// The signatures are required; the build's signature check says so if one is missing.
const registrySig = await read(sources.registry + '.sig', { optional: true });
if (registrySig) save('registry.json.sig', registrySig);

const creditsBytes = sources.credits && await read(sources.credits, { optional: true });
if (creditsBytes) save('credits.json', creditsBytes);

for (const g of registry.games) {
  if (g.status === 'coming') continue;
  if (!g.index) throw new Error(`fetch-data: ${g.id} is ${g.status} but the registry gives it no index`);
  const dir = `games/${g.id}`;
  const indexBytes = await read(g.index);
  save(`${dir}/index.json`, indexBytes);
  const sig = await read(g.index + '.sig', { optional: true });
  if (sig) save(`${dir}/index.json.sig`, sig);
  const data = JSON.parse(indexBytes.toString('utf8')).data;
  if (!data) { console.log(`fetch-data: ${g.id}: its index has no data zip yet`); continue; }
  const zip = await get(data.url);
  save(`${dir}/${g.id}-data.zip`, zip);
  console.log(`fetch-data: ${g.id}: data zip of ${data.date}, ${(zip.length / 1048576).toFixed(1)} MB`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.renameSync(tmp, out);
console.log('fetch-data: done');
