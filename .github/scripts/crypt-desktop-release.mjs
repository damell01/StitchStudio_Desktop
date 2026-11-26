import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';

const [operation, input, output] = process.argv.slice(2);
const secret = process.env.STITCH_ARTIFACT_KEY ?? '';
if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Set STITCH_ARTIFACT_KEY to a 32-byte hexadecimal key.');
if (!['encrypt','decrypt'].includes(operation) || !input || !output || resolve(input) === resolve(output)) {
  throw new Error('Usage: crypt-desktop-release.mjs encrypt|decrypt INPUT OUTPUT');
}
const key = Buffer.from(secret, 'hex');
const marker = Buffer.from('SS01');
const suffix = '.ssenc';
const encrypt = operation === 'encrypt';
const files = readdirSync(input, {recursive:true, withFileTypes:true}).filter(entry => entry.isFile());
if (!files.length) throw new Error('The release directory is empty.');
for (const entry of files) {
  const source = join(entry.parentPath, entry.name);
  const path = relative(input, source);
  if (!encrypt && !path.endsWith(suffix)) throw new Error('Unexpected unencrypted artifact.');
  const plainPath = encrypt ? path : path.slice(0, -suffix.length);
  const target = join(output, encrypt ? path + suffix : plainPath);
  const bytes = readFileSync(source);
  const name = Buffer.from(basename(plainPath), 'utf8');
  let result;
  if (encrypt) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',key,nonce);
    cipher.setAAD(name);
    const ciphertext = Buffer.concat([cipher.update(bytes),cipher.final()]);
    result = Buffer.concat([marker,nonce,cipher.getAuthTag(),ciphertext]);
  } else {
    if (bytes.length < 32 || !bytes.subarray(0,4).equals(marker)) throw new Error('Invalid encrypted artifact format.');
    const decipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));
    decipher.setAAD(name);
    decipher.setAuthTag(bytes.subarray(16,32));
    result = Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]);
  }
  mkdirSync(dirname(target), {recursive:true,mode:0o700});
  writeFileSync(target,result,{flag:'wx',mode:0o600});
}
