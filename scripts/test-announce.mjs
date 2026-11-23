// Tests the Discord announcements (scripts/announce.mjs): which releases are posted, the messages,
// and that nothing can ping anyone or show the webhook. No network: posts go to a fake fetch.
//   node scripts/test-announce.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as a from './announce.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `: ${detail}` : ''}`);
}

const today = new Date('2026-11-23T12:00:00Z');
function dataDir({ releases, app, status = 'open-beta' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-announce-'));
  const registry = { format: 1, games: [
    { id: 'tpm-vr', name: 'Two Point Museum VR', status, index: 'x' },
    { id: 'timberborn-vr', name: 'Timberborn VR', status: 'coming' },
  ] };
  if (app) registry.app = { latest: app.at(-1), releases: app.map((v) => ({ version: v, date: '2026-11-23' })) };
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(registry));
  fs.mkdirSync(path.join(dir, 'games', 'tpm-vr'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'games', 'tpm-vr', 'index.json'), JSON.stringify({ id: 'tpm-vr', name: 'Two Point Museum VR', releases }));
  return dir;
}
const rel = (version, maturity, date = '2026-11-23', notes) => ({ version, maturity, date, notes });

// ---- Which releases ----
{
  const dir = dataDir({ releases: [rel('0.1.3', 'open-beta', '2026-11-23', 'Steam Frame support.'), rel('0.1.4', 'closed-beta'), rel('0.1.0', 'open-beta', '2026-11-07')], app: ['0.4.3'] });
  const all = a.publicReleases(dir);
  check('closed-beta releases are never candidates', !all.some((r) => r.version === '0.1.4'));
  check('open-beta game releases and installer releases are', all.some((r) => r.key === 'game:tpm-vr:0.1.3:open-beta') && all.some((r) => r.key === 'app:0.4.3'));
  check('coming games have nothing', !all.some((r) => r.key.includes('timberborn')));

  const boot = a.plan(all, null, today);
  check('no state yet: everything is recorded, nothing posted', boot.bootstrap && boot.post.length === 0 && boot.record.length === all.length);

  const state = { format: 1, announced: { 'game:tpm-vr:0.1.0:open-beta': {} } };
  const p = a.plan(all, state, today);
  check('new releases are posted', p.post.map((r) => r.key).join() === 'game:tpm-vr:0.1.3:open-beta,app:0.4.3', p.post.map((r) => r.key).join());
  check('already announced ones are not', !p.post.some((r) => r.key === 'game:tpm-vr:0.1.0:open-beta'));

  const p2 = a.plan(all, { format: 1, announced: {} }, today);
  check('older than 14 days: recorded, not posted', p2.record.some((r) => r.key === 'game:tpm-vr:0.1.0:open-beta') && !p2.post.some((r) => r.key === 'game:tpm-vr:0.1.0:open-beta'));

  const done = { format: 1, announced: Object.fromEntries(all.map((r) => [r.key, {}])) };
  check('everything announced: nothing to post', a.plan(all, done, today).post.length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = dataDir({ releases: [rel('0.2.0', 'open-beta'), rel('0.2.0', 'stable')] });
  const keys = a.plan(a.publicReleases(dir), { format: 1, announced: { 'game:tpm-vr:0.2.0:open-beta': {} } }, today).post.map((r) => r.key);
  check('a promotion to stable is announced once more, as stable', keys.join() === 'game:tpm-vr:0.2.0:stable', keys.join());
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- Messages ----
const game = { kind: 'game', name: 'Two Point Museum VR', version: '0.1.3', maturity: 'open-beta', notes: 'Steam Frame support.' };
check('game release message', a.releaseMessage(game) === '**Two Point Museum VR 0.1.3 is out** (open beta)\nSteam Frame support.\nGet it with the installer: https://dioramavr.app', a.releaseMessage(game));
check('stable says stable', a.releaseMessage({ ...game, maturity: 'stable' }).startsWith('**Two Point Museum VR 0.1.3 is out** (stable)'));
check('no notes: no notes line', a.releaseMessage({ ...game, notes: undefined }).split('\n').length === 2);
check('installer release message', a.releaseMessage({ kind: 'app', name: 'DioramaVR', version: '0.4.3', notes: 'Fixes.' }) === '**DioramaVR 0.4.3 is out**\nFixes.\nGet it with the installer: https://dioramavr.app');
check('long messages fit Discord (2000)', a.releaseMessage({ ...game, notes: 'x'.repeat(3000) }).length === 2000);
check('installer notes from its release body',
  a.notesFromReleaseBody('DioramaVR 0.4.3, 2026-11-23.\n\nSteam Frame support.\n\nBuilt from installer 3314cfe.\n\nSHA-256: see SHA256SUMS.txt.\n') === 'Steam Frame support.');
check('a release body with no notes has none', a.notesFromReleaseBody('DioramaVR 0.4.0, 2026-11-10.\n\nBuilt from installer 024cffa.\n') === undefined);
check('manual message', a.manualMessage({ title: 'Hello', message: 'Line one\\nLine two', link: 'https://dioramavr.app/tpm-vr/' }) === '**Hello**\nLine one\nLine two\nhttps://dioramavr.app/tpm-vr/');
check('manual message without a link', a.manualMessage({ title: 'Hello', message: 'Hi' }) === '**Hello**\nHi');
let threw = false; try { a.manualMessage({ title: ' ', message: 'x' }); } catch { threw = true; }
check('manual message needs a title', threw);
threw = false; try { a.manualMessage({ title: 'x', link: 'javascript:alert(1)' }); } catch { threw = true; }
check('manual link must be https', threw);

// ---- Posting ----
check('no mentions can ping', JSON.stringify(a.payload('@everyone hi').allowed_mentions) === '{"parse":[]}');
{
  const calls = [];
  await a.post('https://discord.com/api/webhooks/1/secret', 'hi', { fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; } });
  check('posts JSON content to the webhook, waiting for the result', calls.length === 1 && calls[0].url.endsWith('?wait=true') && calls[0].body.content === 'hi');
  let msg = '';
  try { await a.post('https://discord.com/api/webhooks/1/secret', 'hi', { fetchImpl: async () => ({ ok: false, status: 404 }) }); } catch (e) { msg = e.message; }
  check('a failed post says the status, never the URL', msg === 'Discord said HTTP 404' && !msg.includes('secret'), msg);
}

// ---- The command, end to end (preview: no webhook, so nothing is posted) ----
{
  const dir = dataDir({ releases: [rel('0.1.3', 'open-beta', new Date().toISOString().slice(0, 10), 'Steam Frame support.')] });
  const stateFile = path.join(dir, 'state', 'announced.json');
  const out = path.join(dir, 'messages.json');
  const run = (...args) => spawnSync(process.execPath, [path.join(import.meta.dirname, 'announce.mjs'), ...args],
    { env: { ...process.env, DISCORD_WEBHOOK_URL: '' }, encoding: 'utf8' });

  let r = run('releases', '--data', dir, '--state', stateFile, '--out', out);
  check('first run (no state): records, posts nothing', r.status === 0 && JSON.parse(fs.readFileSync(out, 'utf8')).length === 0
    && JSON.parse(fs.readFileSync(stateFile, 'utf8')).announced['game:tpm-vr:0.1.3:open-beta']?.how === 'already out', r.stdout + r.stderr);

  fs.writeFileSync(stateFile, JSON.stringify({ format: 1, announced: {} }));
  r = run('releases', '--data', dir, '--state', stateFile, '--out', out);
  const msgs = JSON.parse(fs.readFileSync(out, 'utf8'));
  check('a new release: one message, recorded before it is sent', r.status === 0 && msgs.length === 1 && msgs[0].content.startsWith('**Two Point Museum VR 0.1.3 is out** (open beta)')
    && JSON.parse(fs.readFileSync(stateFile, 'utf8')).announced['game:tpm-vr:0.1.3:open-beta']?.how === 'posted', r.stdout + r.stderr);
  r = run('releases', '--data', dir, '--state', stateFile, '--out', out);
  check('run again: nothing to send', JSON.parse(fs.readFileSync(out, 'utf8')).length === 0);

  fs.writeFileSync(out, JSON.stringify(msgs));
  r = run('send', '--messages', out);
  check('send without a webhook only previews', r.status === 0 && r.stdout.includes('would post game:tpm-vr:0.1.3:open-beta'), r.stdout + r.stderr);
  const bad = spawnSync(process.execPath, [path.join(import.meta.dirname, 'announce.mjs'), 'manual', '--title', 'x'],
    { env: { ...process.env, DISCORD_WEBHOOK_URL: 'https://example.com/hook/secretpart' }, encoding: 'utf8' });
  check('a webhook that isn\'t Discord\'s is refused without showing it', bad.status !== 0 && !(bad.stdout + bad.stderr).includes('secretpart'), bad.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
