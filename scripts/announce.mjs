// Posts DioramaVR news to Discord through a channel webhook (DISCORD_WEBHOOK_URL, a secret:
// it's never printed, logged or written anywhere; errors show the HTTP status only).
//
// After a deploy (deploy.yml's announce job), in two steps:
//   node scripts/announce.mjs releases --data data --state <dir>/announced.json --out messages.json
//     One message for each public release the site now shows that hasn't been announced yet.
//     "Public" means a game's open-beta or stable release in its signed index.json (closed betas
//     never appear there) or an installer release in the registry (app.releases). Data-only
//     publishes, dry runs and failed runs add no release, so they never announce. Each one is
//     recorded in the state file (game:<id>:<version>:<maturity>, app:<version>) before it's
//     posted, so nothing is posted twice; a promotion to stable is a new message.
//     No state file yet: every release out now is recorded and nothing is posted.
//     Releases older than 14 days are recorded without a post (a backlog after an outage).
//   node scripts/announce.mjs send --messages messages.json [--preview]
//     Posts them, once the workflow has saved the state. A failed post is not retried by
//     itself (it's already recorded); the warning says to post it by hand.
//
// By hand (announce.yml):
//   node scripts/announce.mjs manual --title "..." [--message "..."] [--link URL] [--preview]
//     ("\n" in the message is a new line, for the one-line GitHub form).
//
// --preview, or no DISCORD_WEBHOOK_URL, prints the exact messages and posts nothing.
// No message can ping anyone (allowed_mentions: none).
import fs from 'node:fs';
import path from 'node:path';

export const SITE = 'https://dioramavr.app';
export const MAX_AGE_DAYS = 14;
const LIMIT = 2000;   // Discord's limit for a message's content
const MATURITY_WORDS = { 'open-beta': 'open beta', stable: 'stable' };

/** Where an installer release's notes live: its GitHub release (publish-installer writes them there). */
export const installerReleaseApi = (version) =>
  `https://api.github.com/repos/DioramaVR/dvr-installer-public/releases/tags/v${version}`;

/** Every public release the site's data shows, oldest first. */
export function publicReleases(dataDir) {
  const registry = JSON.parse(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8'));
  const out = [];
  for (const g of registry.games ?? []) {
    if (g.status === 'coming') continue;
    const file = path.join(dataDir, 'games', g.id, 'index.json');
    if (!fs.existsSync(file)) continue;
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of index.releases ?? []) {
      const maturity = r.maturity ?? { beta: 'open-beta', stable: 'stable' }[r.channel];
      if (!MATURITY_WORDS[maturity]) continue;   // closed-beta, or anything unknown: never
      out.push({ key: `game:${g.id}:${r.version}:${maturity}`, kind: 'game', name: index.name ?? g.name,
        version: r.version, maturity, date: r.date, notes: r.notes });
    }
  }
  for (const r of registry.app?.releases ?? []) {
    out.push({ key: `app:${r.version}`, kind: 'app', name: 'DioramaVR', version: r.version, date: r.date });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Splits releases into those to post and those to record silently. state: null when there's none yet. */
export function plan(releases, state, now = new Date()) {
  if (!state) return { post: [], record: releases, bootstrap: true };
  const fresh = releases.filter((r) => !state.announced[r.key]);
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86400000;
  const old = (r) => !r.date || Date.parse(r.date) < cutoff;
  return { post: fresh.filter((r) => !old(r)), record: fresh.filter(old), bootstrap: false };
}

const clip = (s) => (s.length > LIMIT ? s.slice(0, LIMIT - 1) + '…' : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The message for a release. */
export function releaseMessage(r) {
  const head = r.kind === 'app'
    ? `**${r.name} ${r.version} is out**`
    : `**${r.name} ${r.version} is out** (${MATURITY_WORDS[r.maturity]})`;
  const lines = [head];
  if (oneLine(r.notes)) lines.push(oneLine(r.notes));
  lines.push(`Get it with the installer: ${SITE}`);
  return clip(lines.join('\n'));
}

/** The message for a hand announcement. */
export function manualMessage({ title, message, link }) {
  if (!oneLine(title)) throw new Error('announce: a title is needed');
  const body = String(message ?? '').replace(/\\n/g, '\n').trim();
  const lines = [`**${oneLine(title)}**`];
  if (body) lines.push(body);
  if (oneLine(link)) {
    if (!/^https:\/\/\S+$/.test(oneLine(link))) throw new Error('announce: the link must be an https:// URL');
    lines.push(oneLine(link));
  }
  return clip(lines.join('\n'));
}

/** An installer release's one-line notes: the paragraph(s) between its first line and "Built from". */
export function notesFromReleaseBody(body) {
  const paras = String(body ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const middle = paras.slice(1).filter((p) => !/^Built from /.test(p) && !/^SHA-256:/.test(p));
  return middle.length ? oneLine(middle.join(' ')) : undefined;
}

/** The webhook's JSON body: plain content, and no mentions of any kind. */
export const payload = (content) => ({ content, allowed_mentions: { parse: [] } });

/** Posts one message; throws with the status only, never the URL. */
export async function post(webhook, content, { fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${webhook}${webhook.includes('?') ? '&' : '?'}wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'dioramavr-site-announce' },
      body: JSON.stringify(payload(content)),
    });
    if (res.ok) return;
    if (res.status === 429) {   // rate limited: wait as long as Discord says, then try again
      const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
      continue;
    }
    throw new Error(`Discord said HTTP ${res.status}`);
  }
  throw new Error('Discord kept rate limiting');
}

export function webhookFromEnv() {
  const url = (process.env.DISCORD_WEBHOOK_URL ?? '').trim();
  if (!url) return undefined;
  if (!/^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\S+$/.test(url)) {
    throw new Error("announce: DISCORD_WEBHOOK_URL isn't a Discord webhook URL (https://discord.com/api/webhooks/...)");
  }
  return url;
}

async function fillInstallerNotes(r) {
  try {
    const headers = { 'User-Agent': 'dioramavr-site-announce', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(installerReleaseApi(r.version), { headers });
    if (res.ok) r.notes = notesFromReleaseBody((await res.json()).body);
    else console.log(`announce: no notes for installer ${r.version} (its release: HTTP ${res.status})`);
  } catch (e) {
    console.log(`announce: no notes for installer ${r.version} (${e.message})`);
  }
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preview') o.preview = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];

  if (cmd === 'manual') {
    const webhook = webhookFromEnv();
    const preview = o.preview || !webhook;
    if (!o.preview && !webhook) console.log("announce: DISCORD_WEBHOOK_URL isn't set, so this is a preview: nothing is posted");
    const content = manualMessage({ title: o.title, message: o.message, link: o.link });
    console.log(`---- ${preview ? 'would post' : 'posting'} ----\n${content}\n----`);
    if (!preview) { await post(webhook, content); console.log('announce: posted'); }
    return;
  }

  if (cmd === 'releases' && o.data && o.state && o.out) {
    // Step 1: decide, and record everything to be posted in the state file before anything is
    // posted. The workflow saves the state, then runs step 2; if saving fails, nothing is posted.
    const state = fs.existsSync(o.state) ? JSON.parse(fs.readFileSync(o.state, 'utf8')) : null;
    const next = state ? structuredClone(state) : { format: 1, announced: {} };
    const p = plan(publicReleases(o.data), state);
    const today = new Date().toISOString().slice(0, 10);
    const stamp = (r, how) => { next.announced[r.key] = { date: today, how }; };
    if (p.bootstrap) console.log(`announce: no state yet, so the ${p.record.length} releases out now are recorded and none is posted`);
    else if (p.record.length) console.log(`announce: older than ${MAX_AGE_DAYS} days, recorded without a post: ${p.record.map((r) => r.key).join(', ')}`);
    for (const r of p.record) stamp(r, p.bootstrap ? 'already out' : 'too old');
    const messages = [];
    for (const r of p.post) {
      if (r.kind === 'app') await fillInstallerNotes(r);
      const content = releaseMessage(r);
      console.log(`---- ${r.key} ----\n${content}\n----`);
      messages.push({ key: r.key, content });
      stamp(r, 'posted');
    }
    if (!messages.length) console.log('announce: nothing new to announce');
    fs.mkdirSync(path.dirname(o.state), { recursive: true });
    fs.writeFileSync(o.state, JSON.stringify(next, null, 2) + '\n');
    fs.writeFileSync(o.out, JSON.stringify(messages, null, 2) + '\n');
    return;
  }

  if (cmd === 'send' && o.messages) {
    // Step 2: post what step 1 decided. Each is already recorded, so a failure is never retried
    // by itself (that could post twice); the warning says to post it by hand.
    const messages = JSON.parse(fs.readFileSync(o.messages, 'utf8'));
    if (!messages.length) return;
    const webhook = webhookFromEnv();
    if (o.preview || !webhook) {
      console.log(`announce: preview${webhook ? '' : " (DISCORD_WEBHOOK_URL isn't set)"}: nothing is posted`);
      for (const m of messages) console.log(`---- would post ${m.key} ----\n${m.content}\n----`);
      return;
    }
    let failed = 0;
    for (const m of messages) {
      try { await post(webhook, m.content); console.log(`announce: posted ${m.key}`); }
      catch (e) { failed++; console.log(`::warning::announce: couldn't post ${m.key} (${e.message}). It won't be tried again by itself: post it with the "Announce on Discord" workflow.`); }
    }
    if (failed) process.exitCode = 1;
    return;
  }

  throw new Error('usage: announce.mjs releases --data <dir> --state <file> --out <messages.json>\n'
    + '       announce.mjs send --messages <messages.json> [--preview]\n'
    + '       announce.mjs manual --title T [--message M] [--link URL] [--preview]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
