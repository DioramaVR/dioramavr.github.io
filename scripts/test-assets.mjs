// Tests the build's check of a game's assets list (index.json: assets, dvr-package SPEC section 12):
// every file must be there with the size and SHA-256 its index lists, or the build stops.
// Each case loads a changed copy of sample-data/ through src/data/load.ts.   node scripts/test-assets.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const game = 'tpm-vr';

/** Loads a copy of sample-data/ (changed by edit) in a fresh Node; returns '' or the error. */
function loadWith(edit) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-site-assets-'));
  const dir = path.join(tmp, 'sample-data');   // named so: sample data is unsigned (signatures have their own tests)
  try {
    fs.cpSync(path.join(root, 'sample-data'), dir, { recursive: true });
    const indexFile = path.join(dir, 'games', game, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    edit({ dir, index, media: path.join(dir, 'games', game, 'media') });
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
    const code = `const m = await import(${JSON.stringify(new URL('../src/data/load.ts', import.meta.url).href)});
      const g = m.load().games.find((g) => g.id === ${JSON.stringify(game)});
      for (const x of g.info.media) m.mediaBytes(g.id, x.file);`;
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code],
      { cwd: root, env: { ...process.env, DVR_DATA_DIR: dir, CI: '' }, encoding: 'utf8' });
    return r.status === 0 ? '' : (r.stderr.match(/Error: (site data: [^\n]*)/)?.[1] ?? r.stderr.trim());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

let failed = 0;
function expect(name, edit, want) {
  const err = loadWith(edit);
  const ok = want === null ? err === '' : err.includes(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${err ? `: ${err}` : ''}`);
}

expect('the sample assets list checks out', () => {}, null);
expect('a file with other bytes (same size)', ({ media }) => {
  const f = path.join(media, 'hero.jpg'); const b = fs.readFileSync(f); b[b.length - 1] ^= 1; fs.writeFileSync(f, b);
}, 'has SHA-256');
expect('a file of another size', ({ media }) => fs.appendFileSync(path.join(media, 'hero.jpg'), 'x'), 'bytes, not the');
expect('a missing file', ({ media }) => fs.rmSync(path.join(media, 'headset-view.jpg')), "isn't there");
expect('a name the media list uses but files lacks', ({ index }) => { delete index.assets.files['turntable-poster.jpg']; }, 'has no url, sha256 and size');
expect('a file no media entry uses', ({ index }) => { index.assets.files['extra.jpg'] = index.assets.files['hero.jpg']; }, 'which no media entry uses');
expect('a file name with a path in it', ({ index }) => {
  index.assets.files['../hero.jpg'] = index.assets.files['hero.jpg']; index.assets.media[0].file = '../hero.jpg'; delete index.assets.files['hero.jpg'];
}, 'outside [a-z0-9._-]');
expect('an upper-case sha256 is fine', ({ index }) => { for (const f of Object.values(index.assets.files)) f.sha256 = f.sha256.toUpperCase(); }, null);
expect('the assets list wins over game.json media', ({ index, media }) => {
  fs.copyFileSync(path.join(media, 'hero.jpg'), path.join(media, 'new-hero.jpg'));
  index.assets.files['new-hero.jpg'] = { ...index.assets.files['hero.jpg'] };
  delete index.assets.files['hero.jpg'];
  index.assets.media[0].file = 'new-hero.jpg';
  fs.rmSync(path.join(media, 'hero.jpg'));   // game.json still names media/hero.jpg
}, null);

console.log(failed ? `${failed} assets test(s) failed` : 'all assets tests passed');
process.exit(failed ? 1 : 0);
