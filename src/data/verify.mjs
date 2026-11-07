// Signature checks for the files the app reads (dvr-package's Ed25519 verification).
// The build calls verifyDataDir() with the trusted keys in site-config/trusted-keys.json;
// scripts/test-signatures.mjs calls it with a throwaway test key. There is no
// environment switch that changes which keys are trusted.
import fs from 'node:fs';
import path from 'node:path';
import dvrPackage from 'dvr-package';

/** Reads site-config/trusted-keys.json: [{ id, spki }]. */
export function siteTrustedKeys(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'site-config', 'trusted-keys.json'), 'utf8'));
}

/**
 * Checks registry.json and every games/<id>/index.json in dataDir against their .sig files.
 * `ids` are the games that have an index (status open-beta or stable).
 * Returns a list of problems; empty means every file is signed by a trusted key.
 */
export function verifyDataDir(dataDir, ids, trusted) {
  const files = ['registry.json', ...ids.map((id) => `games/${id}/index.json`)];
  const problems = [];
  for (const rel of files) {
    const file = path.join(dataDir, rel);
    const sig = `${file}.sig`;
    if (!fs.existsSync(sig)) { problems.push(`${rel}: no signature (${rel}.sig)`); continue; }
    const r = dvrPackage.sign.check(fs.readFileSync(file), fs.readFileSync(sig, 'utf8'), trusted);
    if (!r.ok) problems.push(`${rel}: ${r.message}`);
  }
  return problems;
}
