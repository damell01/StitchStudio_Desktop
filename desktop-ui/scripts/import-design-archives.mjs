// Extract supported files from user-downloaded archives using the OS archive tool.
// No network requests, no redistribution, no overwriting original downloads.
import {readdir,mkdir,mkdtemp,rm,copyFile,stat} from 'node:fs/promises';
import {join,extname,basename,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
const source=resolve(process.argv[2]||join(homedir(),'Downloads'));
const destination=resolve(process.argv[3]||join(homedir(),'StitchStudio Designs'));
const allowed=new Set(['.dst','.pes','.pec','.jef','.exp']);
await mkdir(destination,{recursive:true});
let imported=0,failed=0;
async function collect(dir,out,depth=0){if(depth>12)return;for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=join(dir,e.name);if(e.isDirectory()){await collect(p,out,depth+1);continue;}if(!e.isFile()||!allowed.has(extname(e.name).toLowerCase()))continue;if((await stat(p)).size>20000000)continue;for(let i=0;i<1000;i++){const name=i?basename(e.name,extname(e.name))+'-'+i+extname(e.name):e.name;try{await copyFile(p,join(out,name),constants.COPYFILE_EXCL);imported++;break}catch(err){if(err.code!=='EEXIST')throw err;}}}}
for(const e of await readdir(source,{withFileTypes:true})){if(!e.isFile()||extname(e.name).toLowerCase()!=='.zip')continue;const p=join(source,e.name);if((await stat(p)).size>50000000)continue;const temp=await mkdtemp(join(tmpdir(),'stitchstudio-'));try{if(process.platform==='win32'){execFileSync('tar',['-xf',p,'-C',temp],{timeout:30000,stdio:'pipe'});}else{execFileSync('unzip',['-q',p,'-d',temp],{timeout:30000,stdio:'pipe'});}await collect(temp,destination);}catch(err){failed++;console.error(e.name,String(err));}finally{await rm(temp,{recursive:true,force:true});}}
console.log('Extracted '+imported+' files; '+failed+' archives failed. Import this folder in Stitch Studio: '+destination);
