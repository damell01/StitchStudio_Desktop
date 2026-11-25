import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [platform, directory] = process.argv.slice(2);
if (!['win32', 'darwin'].includes(platform) || !directory) {
  throw new Error('Usage: node verify-desktop-bundles.mjs <win32|darwin> <bundle directory>');
}
const bundle = resolve(directory);

async function findFiles(subdirectory, extension) {
  const entries = await readdir(join(bundle, subdirectory), { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map(entry => [subdirectory, entry.name].join('/'))
    .sort();
  if (!files.length) throw new Error(`No ${extension} packages found in ${subdirectory}`);
  return files;
}

async function verifySignature(path, signature, trailer = false) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const actual = Buffer.alloc(signature.length);
    const position = trailer ? size - 512 : 0;
    if (position < 0 || (await file.read(actual, 0, actual.length, position)).bytesRead !== actual.length ||
        !actual.equals(signature)) {
      throw new Error(`Unexpected package format: ${path}`);
    }
  } finally {
    await file.close();
  }
}

const packages = [];
if (platform === 'win32') {
  for (const name of await findFiles('nsis', '.exe')) {
    await verifySignature(join(bundle, name), Buffer.from('MZ'));
    packages.push(name);
  }
} else {
  const archive = 'Stitch-Studio-macOS.zip';
  await verifySignature(join(bundle, archive), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  packages.push(archive);
  for (const name of await findFiles('dmg', '.dmg')) {
    await verifySignature(join(bundle, name), Buffer.from('koly'), true);
    packages.push(name);
  }
}

const checksums = [];
for (const name of packages) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(bundle, name))) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(join(bundle, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
