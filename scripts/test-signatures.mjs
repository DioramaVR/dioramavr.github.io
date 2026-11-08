// Tests the site's signature check (src/data/verify.mjs) with a throwaway key made here.
// The real signing key is never needed or used.   node scripts/test-signatures.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyDataDir, siteTrustedKeys } from '../src/data/verify.mjs';

const root = path.resolve(import.meta.dirname, '..');
const newKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, trusted: { id: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16), spki: der.toString('base64') } };
};
const sign = (key, file) =>
  fs.writeFileSync(`${file}.sig`, JSON.stringify({ key: key.trusted.id, sig: crypto.sign(null, fs.readFileSync(file), key.privateKey).toString('base64') }) + '\n');

function signedCopy(key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-site-sig-'));
  fs.cpSync(path.join(root, 'sample-data'), dir, { recursive: true });
  sign(key, path.join(dir, 'registry.json'));
  sign(key, path.join(dir, 'games', 'tpm-vr', 'index.json'));
  return dir;
}

const key = newKey(), other = newKey();
const ids = ['tpm-vr'];
let failed = 0;
function expect(name, problems, want) {
  const ok = want === null ? problems.length === 0 : problems.some((p) => p.includes(want));
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${problems.length ? `: ${problems.join('; ')}` : ''}`);
}

let dir = signedCopy(key);
expect('signed by a trusted key', verifyDataDir(dir, ids, [key.trusted]), null);
expect('the real trusted keys refuse a test-signed file', verifyDataDir(dir, ids, siteTrustedKeys(root)), "isn't trusted");
expect('signed by a key that is not in the list', verifyDataDir(dir, ids, [other.trusted]), "isn't trusted");
expect('old and new key side by side (rotation)', verifyDataDir(dir, ids, [other.trusted, key.trusted]), null);

fs.appendFileSync(path.join(dir, 'registry.json'), ' ');
expect('registry.json changed after signing', verifyDataDir(dir, ids, [key.trusted]), "registry.json: the signature doesn't match");

dir = signedCopy(key);
const reg = path.join(dir, 'registry.json');
fs.writeFileSync(reg, fs.readFileSync(reg, 'utf8').replace(/\n/g, '\r\n'));
expect('registry.json with CRLF line ends (a Windows checkout)', verifyDataDir(dir, ids, [key.trusted]), "registry.json: the signature doesn't match");

dir = signedCopy(key);
fs.rmSync(path.join(dir, 'games', 'tpm-vr', 'index.json.sig'));
expect('index.json with no .sig', verifyDataDir(dir, ids, [key.trusted]), 'games/tpm-vr/index.json: no signature');

dir = signedCopy(key);
fs.writeFileSync(path.join(dir, 'registry.json.sig'), 'not json\n');
expect('a .sig that is not JSON', verifyDataDir(dir, ids, [key.trusted]), 'not JSON');

console.log(failed ? `${failed} test(s) failed` : 'all signature tests passed');
process.exitCode = failed ? 1 : 0;
