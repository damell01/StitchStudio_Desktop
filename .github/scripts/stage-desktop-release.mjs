import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const [version, source, output] = process.argv.slice(2);
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')
  || !source || !output) {
  throw new Error('Usage: stage-desktop-release.mjs VERSION ARTIFACTS OUTPUT');
}
const assets = readdirSync(source, {recursive:true, withFileTypes:true}).filter(entry => entry.isFile());
function file(name) {
  const matches = assets.filter(entry => entry.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name}, found ${matches.length}.`);
  return join(matches[0].parentPath, name);
}

const root = new URL(process.env.STITCH_UPDATE_ASSETS ?? '');
if (root.protocol !== 'https:' || !root.pathname.endsWith('/') || root.username || root.password || root.search || root.hash) {
  throw new Error('Set STITCH_UPDATE_ASSETS to the HTTPS asset directory, ending in a slash.');
}
const manifest = {version, platforms:{}};
for (const target of ['windows-x86_64','darwin-aarch64','darwin-x86_64']) {
  const windows = target.startsWith('windows-');
  const name = `stitch-studio-${target}${windows ? '.exe' : '.app.tar.gz'}`;
  const platform = JSON.parse(readFileSync(file(`${target}.json`),'utf8'));
  const asset = platform.platforms?.[target];
  if (platform.version !== version || !asset?.signature || !asset?.url) {
    throw new Error(`Missing signed ${target} asset for ${version}.`);
  }

  if (asset.url !== new URL(`${version}/${target}/${name}`, root).href) {
    throw new Error(`Unexpected updater URL for ${target}.`);
  }
  const payload = file(name);
  const digest = createHash('sha256').update(readFileSync(payload)).digest('hex');
  if (digest !== asset.sha256) throw new Error(`Checksum mismatch in ${name}.`);
  const destination = join(output, version, target);
  mkdirSync(destination, {recursive:true});
  copyFileSync(payload, join(destination, name));
  if (!windows) {
    const installer = `stitch-studio-${target}.dmg`;
    copyFileSync(file(installer), join(destination, installer));
  }
  manifest.platforms[target] = {url:asset.url, signature:asset.signature};
}
writeFileSync(join(output, 'latest.json'), JSON.stringify(manifest,null,2)+'\n');
