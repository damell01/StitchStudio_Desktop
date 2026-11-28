// Prepare original template SVG collections for bundling in the app.
//
//   node scripts/prepare-template-artwork.mjs <source-folder> [dest-folder]
//
// The source is an unpacked Stitch Studio artwork collection (curated/, sayings/, ...).
// Output goes to src/bundled-artwork/expanded/<collection>/<file>.svg plus
// src/bundled-artwork/expanded-manifest.ts (names, categories, tags, colors, complexity).
//
// Cleanup is conservative and embroidery-oriented:
//  * Traced polygon artwork (fill-rule evenodd, M/L/Z rings): removes speckles and
//    pin-holes too small to stitch, and drops small fragments clipped at the frame edge
//    (pieces of neighbouring motifs from the source sheet). Larger shapes are untouched.
//  * Sayings: moves the illustration up when it overlaps the lettering.
//  * Every design: viewBox is tightened around the visible ink with a small margin.
// Vector paths, colors and groups that survive are written back unchanged.
import {chromium} from '@playwright/test';
import {readdir,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,relative,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(process.argv[2]??'');
const dest=resolve(process.argv[3]??join(here,'../src/bundled-artwork/expanded'));
const manifestPath=join(dirname(dest),'expanded-manifest.ts');
if(!process.argv[2]){console.error('usage: prepare-template-artwork.mjs <source-folder> [dest-folder]');process.exit(1)}

// Designs that imitate third-party marks are not redistributed with the app.
const excluded=[/^new-artwork\/colorways\//,/^new-artwork\/football-(pom|script)-helmet\.svg$/];

// Per-collection cleanup strength (fractions of the viewBox area).
const cleanup={
 'premium-sayings-drafts':{island:0.00035,hole:0.00025,edge:0.02},
 'new-artwork':{island:0.0002,hole:0.00012,edge:0.01},
 curated:{island:0.00002,hole:0,edge:0.006},
};

const subcategory={
 faith:'Faith',coastal:'Beach & ocean',nursery:'Baby & children',children:'Baby & children',western:'Western & farm',farm:'Western & farm',
 outdoors:'Outdoors & hunting',fishing:'Fishing',golf:'Sports',sports:'Sports',seasonal:'Seasonal',lifestyle:'Everyday & lifestyle',everyday:'Everyday & lifestyle',
 mini:'Mini & left chest','left-chest':'Mini & left chest',heirloom:'Monograms & frames',birthday:'Birthday & celebrations',boutique:'Boutique & bows',
 construction:'Vehicles & construction',vehicles:'Vehicles & construction',southern:'Southern',motherhood:'Mama & family',
};
const byName=[
 [/monogram|crest|nameplate|frame|shield/,'Monograms & frames'],[/bow|floral|gingham/,'Boutique & bows'],[/mallard|retriever|fawn|reeds|deer|duck/,'Outdoors & hunting'],
 [/fishing|lure|bass|redfish/,'Fishing'],[/baseball|football|sports|golf|basketball|tennis|all-star|game-day/,'Sports'],[/bunny|easter|pumpkin|christmas|autumn/,'Seasonal'],
 [/tractor|barn|western|boots|cowboy|cowgirl|rodeo|longhorn|horseshoe|hay/,'Western & farm'],[/construction|excavator|truck|train|engine/,'Vehicles & construction'],
 [/sailboat|coastal|beach|shrimp|sea|salt|crab|lighthouse|palm|ocean/,'Beach & ocean'],[/faith|cross|church|blessed|blessing|jesus|grace|magnolia/,'Faith'],
 [/teddy|rocking|nursery|baby|stork|little/,'Baby & children'],[/mountain|campfire|outdoor|hunt/,'Outdoors & hunting'],[/mama/,'Mama & family'],[/southern|alabama|cotton|sweet-tea/,'Southern'],
];
const collections={
 curated:{label:'Curated heirloom',style:'Detailed'},'quick-stitch-vol-1':{label:'Quick Stitch Vol. 1',style:'Line art'},'quick-stitch-vol-2':{label:'Quick Stitch Vol. 2',style:'Line art'},
 'solid-color-vol-3':{label:'Quick Stitch Vol. 3',style:'Solid color'},'quick-stitch-vol4':{label:'Quick Stitch Vol. 4',style:'Filled'},sayings:{label:'Sayings',style:'Lettering'},
 'premium-sayings-drafts':{label:'Premium sayings',style:'Lettering'},'new-artwork':{label:'New artwork',style:'Detailed'},
};

async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.name.toLowerCase().endsWith('.svg'))out.push(p)}return out}

// ---- polygon ring cleanup -------------------------------------------------
function rings(d){
 if(/[^MLZmlz0-9.,\s\-eE]/.test(d))return null; // only absolute/relative polygon commands are handled
 const out=[];let cur=null,x=0,y=0,cmd='M';
 const tokens=d.match(/[MLZmlz]|-?\d*\.?\d+(?:e-?\d+)?/g)??[];
 for(let i=0;i<tokens.length;){
  const t=tokens[i];
  if(/[MLZmlz]/.test(t)){cmd=t;i++;if(cmd==='Z'||cmd==='z'){if(cur){out.push(cur);cur=null}}continue}
  const nx=+tokens[i],ny=+tokens[i+1];i+=2;
  const rel=cmd==='m'||cmd==='l';x=rel?x+nx:nx;y=rel?y+ny:ny;
  if(cmd==='M'||cmd==='m'){if(cur)out.push(cur);cur=[[x,y]];cmd=cmd==='M'?'L':'l'}else (cur??=[[x,y]]).push([x,y]);
 }
 if(cur)out.push(cur);
 return out.filter(r=>r.length>=3);
}
const area=r=>{let a=0;for(let i=0;i<r.length;i++){const[p,q]=[r[i],r[(i+1)%r.length]];a+=p[0]*q[1]-q[0]*p[1]}return Math.abs(a)/2};
const box=r=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const[x,y]of r){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}return[x0,y0,x1,y1]};
function inside(pt,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)c=!c}return c}
const nearFrame=(b,vb)=>{const band=Math.max(vb[2],vb[3])*0.12;return b[0]<=vb[0]+band||b[1]<=vb[1]+band||b[2]>=vb[0]+vb[2]-band||b[3]>=vb[1]+vb[3]-band};
const touchesFrame=(b,vb)=>{const e=Math.max(vb[2],vb[3])*0.004;return b[0]<=vb[0]+e||b[1]<=vb[1]+e||b[2]>=vb[0]+vb[2]-e||b[3]>=vb[1]+vb[3]-e};
function core(vb,ctx){
 if(ctx.core)return ctx.core;
 const edge=Math.max(vb[2],vb[3])*0.004;let c=[Infinity,Infinity,-Infinity,-Infinity];
 for(const d of ctx.paths){for(const r of rings(d)??[]){const b=box(r);if(area(r)<0.002*vb[2]*vb[3]||touchesFrame(b,vb))continue;c=[Math.min(c[0],b[0]),Math.min(c[1],b[1]),Math.max(c[2],b[2]),Math.max(c[3],b[3])]}}
 const m=Math.max(vb[2],vb[3])*0.02;return ctx.core=[c[0]-m,c[1]-m,c[2]+m,c[3]+m];
}
const fmt=n=>String(Math.round(n*100)/100);
function cleanRings(d,vb,opt,stats,ctx){
 const rs=rings(d);if(!rs)return d;
 const vbArea=vb[2]*vb[3];
 const info=rs.map(r=>({r,a:area(r),b:box(r),parent:-1,depth:0,drop:false}));
 // Parent = smallest ring that contains this ring's first vertex.
 for(let i=0;i<info.length;i++){let best=-1;for(let j=0;j<info.length;j++){if(i===j||info[j].a<=info[i].a)continue;const b=info[j].b,p=info[i].r[0];if(p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3])continue;if(inside(p,info[j].r)&&(best<0||info[j].a<info[best].a))best=j}info[i].parent=best}
 const depth=i=>info[i].parent<0?0:1+depth(info[i].parent);
 info.forEach((n,i)=>n.depth=depth(i));
 for(const n of info){
  const island=n.depth%2===0;
  if(island&&n.a<opt.island*vbArea){n.drop=true;stats.specks++}
  else if(!island&&n.a<opt.hole*vbArea){n.drop=true;stats.holes++}
  else if(island&&n.a<opt.edge*vbArea&&touchesFrame(n.b,vb))n.edgeCandidate=true;
 }
 // Pieces clipped by the frame are leftovers from neighbouring motifs on the source sheet
 // only when they sit outside the footprint of the main design.
 for(const n of info)if(n.edgeCandidate){
  const c=core(vb,ctx);const ix=Math.max(0,Math.min(n.b[2],c[2])-Math.max(n.b[0],c[0])),iy=Math.max(0,Math.min(n.b[3],c[3])-Math.max(n.b[1],c[1]));
  const own=Math.max(1e-9,(n.b[2]-n.b[0])*(n.b[3]-n.b[1])),frac=ix*iy/own;
  if(frac<0.15){n.drop=true;stats.edges++}
 }
 const dropped=i=>info[i].drop||(info[i].parent>=0&&dropped(info[i].parent));
 return info.filter((_,i)=>!dropped(i)).map(n=>'M'+n.r.map(p=>fmt(p[0])+','+fmt(p[1])).join(' L')+'Z').join(' ');
}

// ---- main ------------------------------------------------------------------
const files=(await walk(source)).sort();
await rm(dest,{recursive:true,force:true});
const browser=await chromium.launch({executablePath:process.env.STITCH_TEST_CHROMIUM||undefined});
const page=await browser.newPage();
const manifest=[];const report={files:0,excluded:0,specks:0,holes:0,edges:0,moved:0};
for(const file of files){
 const rel=relative(source,file).split('\\').join('/');
 if(excluded.some(r=>r.test(rel))){report.excluded++;continue}
 const parts=rel.split('/'),collection=parts[0],slug=basename(rel,'.svg');
 if(!collections[collection])continue;
 let svg=(await readFile(file,'utf8')).trim();
 const vbMatch=svg.match(/viewBox="([^"]+)"/);const vb=vbMatch?vbMatch[1].trim().split(/[\s,]+/).map(Number):[0,0,100,100];
 const opt=cleanup[collection];
 if(opt){const stats={specks:0,holes:0,edges:0},ctx={name:rel,paths:[...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map(m=>m[1])};svg=svg.replace(/(<path\b[^>]*\sd=")([^"]+)(")/g,(_,a,d,c)=>a+cleanRings(d,vb,opt,stats,ctx)+c).replace(/<path\b[^>]*\sd=""[^>]*\/>/g,'');report.specks+=stats.specks;report.holes+=stats.holes;report.edges+=stats.edges}
 // Measure in a real SVG renderer: lettering overlap and the tight ink bounds.
 const measured=await page.evaluate(src=>{
  document.body.innerHTML=src;const root=document.body.querySelector('svg');root.style.overflow='visible';
  const strokePad=el=>{const w=parseFloat(getComputedStyle(el).strokeWidth)||0;return getComputedStyle(el).stroke!=='none'?w/2:0};
  const bounds=el=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const s of [el,...el.querySelectorAll('*')]){if(!(s instanceof SVGGraphicsElement)||s.tagName==='g'||s.tagName==='svg')continue;const b=s.getBBox();if(!b.width&&!b.height)continue;const m=s.getCTM(),r=root.getCTM().inverse().multiply(m),p=strokePad(s);const pts=[[b.x-p,b.y-p],[b.x+b.width+p,b.y-p],[b.x-p,b.y+b.height+p],[b.x+b.width+p,b.y+b.height+p]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(r));for(const q of pts){x0=Math.min(x0,q.x);y0=Math.min(y0,q.y);x1=Math.max(x1,q.x);y1=Math.max(y1,q.y)}}return isFinite(x0)?[x0,y0,x1,y1]:null};
  const ill=root.querySelector('#illustration'),let_=root.querySelector('#lettering');
  const colors=new Set();for(const s of root.querySelectorAll('*')){for(const k of ['fill','stroke']){const v=getComputedStyle(s)[k];if(v&&v!=='none'&&!/rgba\(0, 0, 0, 0\)/.test(v)&&s instanceof SVGGeometryElement)colors.add(v)}}
  let nodes=0;for(const p of root.querySelectorAll('path'))nodes+=(p.getAttribute('d')?.match(/[A-Za-z]/g)??[]).length;
  return {all:bounds(root),ill:ill&&bounds(ill),letters:let_&&bounds(let_),colors:[...colors].filter(c=>c!=='rgb(255, 255, 255)').length,shapes:root.querySelectorAll('path,circle,ellipse,rect,polygon,polyline,line').length,nodes};
 },svg);
 let all=measured.all;
 if(measured.ill&&measured.letters){
  const gap=4,overlap=measured.ill[3]+gap-measured.letters[1];
  if(overlap>0){
   svg=svg.replace(/(<g id="illustration"[^>]*transform="translate\()\s*([-\d.]+)[ ,]+([-\d.]+)\)/,(_,a,x,y)=>`${a}${x} ${fmt(+y-overlap)})`);
   all=[Math.min(measured.letters[0],measured.ill[0]),Math.min(measured.letters[1],measured.ill[1]-overlap),Math.max(measured.letters[2],measured.ill[2]),measured.letters[3]];
   report.moved++;
  }
 }
 if(all){
  const w=all[2]-all[0],h=all[3]-all[1],m=Math.max(w,h)*0.04;
  const nvb=[all[0]-m,all[1]-m,w+2*m,h+2*m].map(fmt).join(' ');
  svg=svg.replace(/\sviewBox="[^"]*"/,` viewBox="${nvb}"`);
  const mmW=100,mmH=Math.round(100*(h+2*m)/(w+2*m)*10)/10;
  svg=svg.replace(/\s(width|height)="[^"]*"/g,'').replace(/<svg\b/,`<svg width="${mmW}mm" height="${mmH}mm"`);
 }
 const out=join(dest,rel);await mkdir(dirname(out),{recursive:true});await writeFile(out,svg+'\n');
 const sub=parts.length>2?parts[1]:null;
 let category=sub&&subcategory[sub]||byName.find(([r])=>r.test(slug))?.[1]||'Everyday & lifestyle';
 const isSaying=collection==='sayings'||collection==='premium-sayings-drafts';
 if(isSaying)category='Sayings';
 const name=slug.replace(/^\d+[-_]/,'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bA\b$/,'A');
 const tags=[...new Set([collections[collection].style,sub&&subcategory[sub],isSaying&&sub?subcategory[sub]:null,/nameplate|monogram|initial/.test(slug)?'Personalize':null].filter(Boolean))];
 const complexity=measured.nodes>2500||measured.shapes>40?'Detailed':measured.nodes>500||measured.shapes>12?'Moderate':'Simple';
 manifest.push({id:'expanded-'+rel.replace(/\.svg$/,'').replace(/\//g,'-'),path:rel,name,category,collection:collections[collection].label,tags,colors:measured.colors,complexity,draft:collection==='premium-sayings-drafts'||collection==='new-artwork'});
 report.files++;
}
await browser.close();
const header='// Generated by scripts/prepare-template-artwork.mjs. Do not edit by hand.\n';
await writeFile(manifestPath,header+"export type TemplateMeta={id:string;path:string;name:string;category:string;collection:string;tags:string[];colors:number;complexity:'Simple'|'Moderate'|'Detailed';draft:boolean};\nexport const expandedManifest:TemplateMeta[]="+JSON.stringify(manifest,null,0).replace(/\},\{/g,'},\n{')+';\n');
console.log(JSON.stringify(report));
