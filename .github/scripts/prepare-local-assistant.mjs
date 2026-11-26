import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  chmodSync, copyFileSync, createReadStream, existsSync, linkSync, mkdirSync, mkdtempSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {basename, join, relative, resolve} from 'node:path';
import {homedir} from 'node:os';

const release = 'b7993';
const runtimes = {
  'darwin-arm64': ['macos-arm64.tar.gz','ea1665144c0eba5f627e89454005da0cce329a658435e7ca7b4c7284cd143108'],
  'darwin-x64': ['macos-x64.tar.gz','8b0519e73360f6fa07a14ce0cd6c4e95c2f0521ebeff1421de18ca6e6d237b43'],
  'win32-x64': ['win-cpu-x64.zip','5d6de1209cc170be150853971b259f62d75b5334ceb21895540d9c16d3fa9013'],
};
const arch = {x86_64:'x64',aarch64:'arm64'}[process.env.TAURI_ENV_ARCH] ?? process.arch;
const platform = process.env.TAURI_ENV_PLATFORM === 'macos' ? 'darwin'
  : process.env.TAURI_ENV_PLATFORM === 'windows' ? 'win32' : process.platform;
const target = runtimes[`${platform}-${arch}`];
if (!target) {
  console.log('Bundled assistant packages are available for Windows x64 and macOS Intel and Apple silicon.');
  process.exit(0);
}
const modelRevision = '9217f5db79a29953eb74d5343926648285ec7e67';
const modelName = 'qwen2.5-0.5b-instruct-q4_k_m.gguf';
const modelHash = '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db';
const modelUrl = `https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/${modelRevision}/${modelName}`;
const archiveName = `llama-${release}-bin-${target[0]}`;
const cache = resolve(process.env.STITCH_ASSISTANT_CACHE || join(homedir(), '.cache', 'stitch-studio-model'));
const resources = resolve('resources/local-assistant');
mkdirSync(cache,{recursive:true});
mkdirSync(resources,{recursive:true});

async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

function run(program, args) {
  const result = spawnSync(program,args,{stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed to prepare the bundled assistant.`);
}

async function verifiedDownload(name, url, expected) {
  const result = join(cache,name);
  if (existsSync(result) && await digest(result) === expected) return result;
  const temporary = `${result}.${process.pid}.download`;
  try {
    run('curl',['--fail','--location','--retry','3','--silent','--show-error','--output',temporary,url]);
    if (await digest(temporary) !== expected) throw new Error(`SHA-256 mismatch for ${name}.`);
    rmSync(result,{force:true});
    renameSync(temporary,result);
    return result;
  } finally {
    rmSync(temporary,{force:true});
  }
}

const model = await verifiedDownload(modelName,modelUrl,modelHash);
const archive = await verifiedDownload(archiveName,
  `https://github.com/ggml-org/llama.cpp/releases/download/${release}/${archiveName}`,target[1]);
const unpacked = mkdtempSync(join(cache,'llama-'));
try {
  run('tar',['-xf',archive,'-C',unpacked]);
  const destination = join(resources,'runtime');
  rmSync(destination,{recursive:true,force:true});
  mkdirSync(destination);
  const runtimeName = platform === 'win32' ? 'llama-cli.exe' : 'llama-cli';
  const files = readdirSync(unpacked,{recursive:true,withFileTypes:true});
  const runtimes = files.filter(entry=>entry.name===runtimeName&&entry.isFile());
  if (runtimes.length !== 1) throw new Error(`The pinned archive must contain one ${runtimeName}.`);
  const executable = join(runtimes[0].parentPath,runtimeName);
  for (const entry of files) {
    if (entry.name !== runtimeName && !/\.(dll|dylib)$/i.test(entry.name)) continue;
    const path = join(entry.parentPath,entry.name);
    const canonical = realpathSync(path);
    if (relative(unpacked,canonical).startsWith('..') || !statSync(canonical).isFile()) continue;
    const output = join(destination,basename(path));
    if (!existsSync(output) || path === executable) copyFileSync(canonical,output);
  }
  if (platform !== 'win32') chmodSync(join(destination,runtimeName),0o755);
  const modelTarget = join(resources,modelName);
  rmSync(modelTarget,{force:true});
  try { linkSync(model,modelTarget); } catch { copyFileSync(model,modelTarget); }
  writeFileSync(join(destination,'pins.txt'),`${modelHash}  ${modelName}\n${target[1]}  ${archiveName}\n`);
  console.log(`Prepared the bundled Qwen model and llama.cpp runtime for ${platform}-${arch}.`);
} finally {
  rmSync(unpacked,{recursive:true,force:true});
}
