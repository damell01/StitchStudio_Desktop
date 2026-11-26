import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const [version, ...manifests] = process.argv.slice(2);
if (version === 'merge') {
  if (!manifests.length) throw new Error('Pass one or more platform manifest files.');
  const release = JSON.parse(readFileSync(manifests[0], 'utf8'));
  release.platforms = {};
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.version !== release.version) throw new Error('Update versions must match.');
    for (const [platform, asset] of Object.entries(manifest.platforms)) {
      if (release.platforms[platform]) throw new Error(`Duplicate update target: ${platform}`);
      release.platforms[platform] = asset;
    }
  }
  process.stdout.write(JSON.stringify(release, null, 2) + '\n');
} else {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error('Pass a three-part release version, such as 0.1.1.');
  }
  const {STITCH_UPDATE_FEED, STITCH_UPDATE_ASSETS, STITCH_UPDATE_PUBLIC_KEY,
    TAURI_SIGNING_PRIVATE_KEY} = process.env;
  if (!STITCH_UPDATE_PUBLIC_KEY?.trim() || !TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error('Set STITCH_UPDATE_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY.');
  }
  const feed = new URL(STITCH_UPDATE_FEED ?? '');
  const assets = new URL(STITCH_UPDATE_ASSETS ?? '');
  if (feed.protocol !== 'https:' || assets.protocol !== 'https:' || !assets.pathname.endsWith('/')
      || feed.origin !== assets.origin || feed.username || feed.password || assets.username || assets.password || assets.search || assets.hash) {
    throw new Error('Use HTTPS URLs and end STITCH_UPDATE_ASSETS with a slash.');
  }
  const windows = process.platform === 'win32';
  if (!windows && process.platform !== 'darwin') throw new Error('Build on Windows or macOS.');
  const {stdout, status} = spawnSync('rustc', ['-vV'], {encoding:'utf8'});
  const arch = status === 0 ? stdout.match(/^host: (x86_64|aarch64)-/m)?.[1] : undefined;
  if (!arch) throw new Error('Could not determine the Rust host target. Install the native Rust toolchain.');
  const target = `${windows ? 'windows' : 'darwin'}-${arch}`;
  const config = {
    version,
    bundle:{createUpdaterArtifacts:true},
    plugins:{updater:{pubkey:STITCH_UPDATE_PUBLIC_KEY.trim(),endpoints:[feed.href],requireSignedVersion:true,requireAccessKey:process.env.STITCH_UPDATE_REQUIRE_KEY === '1'}},
  };
  const result = spawnSync(process.execPath, [
    'node_modules/@tauri-apps/cli/tauri.js','build','--config',JSON.stringify(config),
    '--bundles',...(windows ? ['nsis'] : ['app','dmg']),'--','--locked',
  ], {stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const bundle = 'src-tauri/target/release/bundle';
  const platformFolder = join(bundle, windows ? 'nsis' : 'macos');
  const suffix = windows ? '.exe.sig' : '.app.tar.gz.sig';
  const signatures = readdirSync(platformFolder).filter(name => name.endsWith(suffix)
    && (!windows || name.includes(`_${version}_`)));
  if (signatures.length !== 1) throw new Error(`Expected one signed ${target} update asset.`);
  const signatureFile = join(platformFolder, signatures[0]);
  const payload = signatureFile.slice(0, -4);
  if (!existsSync(payload)) throw new Error('The signed update payload is missing.');
  const payloadName = `stitch-studio-${target}${windows ? '.exe' : '.app.tar.gz'}`;
  const assetPath = `${version}/${target}/${payloadName}`;
  const url = new URL(assetPath, assets).href;
  const signature = readFileSync(signatureFile,'utf8').trim();
  const trusted = Buffer.from(signature, 'base64').toString().split(/\r?\n/)
    .find(line => line.startsWith('trusted comment: '));
  if (!trusted?.slice('trusted comment: '.length).split('\t').includes(`version:${version}`)) {
    throw new Error(`The updater signature does not bind version ${version}.`);
  }
  const output = join(bundle, 'updates', `${target}.json`);
  mkdirSync(dirname(output), {recursive:true});
  const stagedPayload = join(dirname(output), payloadName);
  copyFileSync(payload, stagedPayload);
  if (!windows) {
    const images = readdirSync(join(bundle, 'dmg')).filter(name => name.endsWith('.dmg') && name.includes(`_${version}_`));
    if (images.length !== 1) throw new Error(`Expected one installer DMG for ${target} ${version}.`);
    copyFileSync(join(bundle, 'dmg', images[0]), join(dirname(output), `stitch-studio-${target}.dmg`));
  }
  writeFileSync(output, JSON.stringify({version,platforms:{
    [target]:{signature,url,sha256:createHash('sha256').update(readFileSync(payload)).digest('hex')},
  }}, null, 2) + '\n');
  console.log(`Prepared ${target} signed payload and manifest.`);
}
