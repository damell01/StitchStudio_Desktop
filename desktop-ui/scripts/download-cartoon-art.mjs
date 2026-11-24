import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||join(process.env.USERPROFILE||process.env.HOME||'.','StitchStudio Artwork');
const bluey=['Bluey','Bingo','Bandit','Chilli','Muffin','Socks','Uncle Stripe','Aunt Trixie','Nana','Frisky','Uncle Rad','Grandad','Lucky','Chloe','Coco','Snickers','Rusty','Jack','Mackenzie','Indy','Honey','Winton'];
const disney=['Mickey Mouse','Minnie Mouse','Donald Duck','Daisy Duck','Goofy','Pluto','Stitch','Winnie the Pooh','Tigger','Eeyore','Angel','Simba','Nala','Ariel','Belle','Cinderella','Elsa','Anna','Olaf','Moana','Rapunzel'];
const extra=[...['Hello Kitty','My Melody','Kuromi','Cinnamoroll','Pompompurin','Keroppi','Badtz-Maru'].map(name=>({name,group:'Sanrio',url:'https://www.sanrio.com/collections/'+name.toLowerCase().replaceAll(' ','-')})),...['Mario','Luigi','Peach','Yoshi','Toad','Bowser','Donkey Kong'].map(name=>({name,group:'Nintendo',url:'https://mario.nintendo.com/characters/'}))];
const jobs=[...extra,...bluey.map(name=>({name,group:'Bluey',url:'https://www.bluey.tv/characters/'+name.toLowerCase().replaceAll(' ','-')+'/'})),...disney.map(name=>({name,group:'Disney',url:'https://characters.disney.com/'+name.toLowerCase().replaceAll(' ','-')}))];
let failures=0;
for(const job of jobs){
try{
const page=await fetch(job.url,{signal:AbortSignal.timeout(30000)});
if(!page.ok)throw Error('Source HTTP '+page.status);
const html=await page.text();
const candidates=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>{const tag=m[0];const src=tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];const alt=tag.match(/\balt=["']([^"']*)["']/i)?.[1]||'';return {src,alt}});
const key=job.name.toLowerCase().replace(/[^a-z]/g,'');
const matches=candidates.filter(c=>c.src&&c.src.match(/\.(png|webp)(?:\?|$)/i)&&((c.alt+c.src).toLowerCase().replace(/[^a-z]/g,'').includes(key)));
if(!matches.length)throw Error('No matching character artwork found; manual source selection required');
const url=new URL(matches[0].src.replaceAll('&amp;','&'),page.url);
if(url.protocol!=='https:')throw Error('Unsafe image URL');
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Image HTTP '+response.status);
const bytes=Buffer.from(await response.arrayBuffer());
const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
if(bytes.length>20000000||(!png&&!webp))throw Error('Unsupported image');
const dir=join(root,job.group);await mkdir(dir,{recursive:true});
await writeFile(join(dir,job.name+(png?'.png':'.webp')),bytes);
await writeFile(join(dir,job.name+'.source.txt'),url.href+'\n'+job.url+'\n');
console.log('Saved candidate artwork: '+job.name);
}catch(e){failures++;console.error(job.name+': '+e.message)}
}
console.log('Artwork folder: '+root+'; unresolved: '+failures);
if(failures)process.exitCode=1;
