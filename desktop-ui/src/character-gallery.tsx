import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Upload} from 'lucide-react';
import {bundledArtwork} from './bundled-artwork/catalog';
import {sportsArtwork} from './bundled-artwork/sports';
export type ArtworkEntry={group:string;name:string;file:string;svg?:string;id?:string};
export type Art={name:string;mime:string;bytes:number[];classic?:boolean;bundled?:boolean};
const groups:Record<string,string>={
 '01_Bows':'Boutique & bows','02_Sports':'Sports','03_Animals':'Animals & characters','04_Faith':'Faith','05_Floral':'Floral & botanical','06_Blank_Name_Templates':'Blank name templates','07_Seasonal':'Seasonal motifs','08_Western_Farm':'Western & farm motifs','09_Baby':'Baby & children','10_Applique':'Appliqué shapes','11_Boutique_Nameplates':'Boutique nameplates','12_Team_Nameplates':'Sports & team nameplates','13_Faith_Frames':'Faith frames','14_Nursery_Nameplates':'Nursery nameplates','15_Seasonal_Nameplates':'Seasonal nameplates','16_Western_Farm':'Western & farm templates','17_Botanical_Frames':'Botanical frames','18_Ocean_Adventure':'Beach & ocean','19_School_Hobbies':'School & hobbies','20_Applique_Badges':'Appliqué badges'
};
export const builtins:ArtworkEntry[]=[...bundledArtwork,...sportsArtwork].map(a=>({id:a.id,group:groups[a.category]??a.category,name:a.id.replace(/^\d+_/,'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),file:a.id+'.svg',svg:a.svg}));
function mime(file:string){return /\.svg$/i.test(file)?'image/svg+xml':/\.webp$/i.test(file)?'image/webp':/\.jpe?g$/i.test(file)?'image/jpeg':'image/png'}
// Retain the original vector paths and palette. Use a sensible 80 mm starting viewport
// for the single-artwork digitizer; the editor's insertion command sizes the actual artwork.
function artworkBytes(svg:string){
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 const root=doc.documentElement;
 if(root.localName!=='svg'||doc.querySelector('parsererror'))throw Error('Invalid bundled artwork');
 const vb=(root.getAttribute('viewBox')??'').trim().split(/[\s,]+/).map(Number);
 if(vb.length===4&&vb[2]>0&&vb[3]>0&&vb.every(Number.isFinite)){
  root.setAttribute('width','80mm');root.setAttribute('height',(80*vb[3]/vb[2])+'mm');
 }
 return Array.from(new TextEncoder().encode(new XMLSerializer().serializeToString(root)));
}
function Tile({entry,onArt,actionLabel,openPrepared}:{entry:ArtworkEntry;onArt:(a:Art)=>void;actionLabel:string;openPrepared?:()=>Promise<void>}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true,u='';setUrl('');setError('');
  const load=entry.svg!==undefined?Promise.resolve(new TextEncoder().encode(entry.svg)):invoke<number[]>('character_image',{group:entry.group,file:entry.file});
  load.then(bytes=>{if(active){u=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime(entry.file)}));setUrl(u)}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false;if(u)URL.revokeObjectURL(u)}
 },[entry.group,entry.file,entry.svg]);
 async function choose(){setBusy(true);try{const bytes=entry.svg!==undefined?artworkBytes(entry.svg):await invoke<number[]>('character_image',{group:entry.group,file:entry.file});onArt({name:entry.name,mime:mime(entry.file),bytes,bundled:entry.svg!==undefined,classic:entry.group==='Classic animation (1928)'})}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function open(){if(!openPrepared)return;setBusy(true);setError('');try{await openPrepared()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <article><div style={{height:108,display:'grid',placeItems:'center',background:'white',borderRadius:8}}>{url?<img src={url} alt={entry.name} loading="lazy" style={{maxWidth:'100%',maxHeight:108,objectFit:'contain'}}/>:<small>{error?'Image unavailable':'Loading artwork…'}</small>}</div><small>{entry.group}{entry.svg!==undefined?' · Built-in SVG':''}</small>{entry.file==='mickey-1928.jpg'&&entry.group==='Classic animation (1928)'&&<div><a href="https://commons.wikimedia.org/wiki/File:Mickey_Mouse_as_he_appears_in_Steamboat_Willie_(1928).jpg" target="_blank" rel="noreferrer">Artwork source</a></div>}{entry.file==='minnie-1928.png'&&entry.group==='Classic animation (1928)'&&<div><a href="https://commons.wikimedia.org/wiki/File:Minnie_Mouse_from_Steamboat_Willie.png" target="_blank" rel="noreferrer">Artwork source</a></div>}<h3>{entry.name}</h3>{openPrepared&&<><small>Prepared stitch plan · up to 75 mm</small><button className="primary" disabled={busy} onClick={()=>void open()}>Open ready-to-edit design</button></>}<button disabled={busy||!url} onClick={choose}>{busy?'Opening…':actionLabel}</button>{error&&<small role="alert">{error}</small>}</article>
}
export function CharacterGallery({onArt,actionLabel='Digitize',bundledOnly=false,onPrepared}:{onArt:(a:Art)=>void;actionLabel?:string;bundledOnly?:boolean;onPrepared?:(id:string)=>Promise<void>}){
 const [local,setLocal]=useState<ArtworkEntry[]>([]),[query,setQuery]=useState(''),[group,setGroup]=useState('All'),[source,setSource]=useState<'all'|'built-in'|'local'>(bundledOnly?'built-in':'all'),[error,setError]=useState(''),[busy,setBusy]=useState(!bundledOnly);
 const [prepared,setPrepared]=useState<string[]>([]);
 useEffect(()=>{if(!onPrepared)return;let active=true;invoke<string[]>('prepared_bundled_designs').then(ids=>{if(active&&Array.isArray(ids))setPrepared(ids)}).catch(()=>{});return()=>{active=false}},[!!onPrepared]);
 async function refresh(){if(bundledOnly)return;setBusy(true);setError('');try{setLocal(await invoke<ArtworkEntry[]>('character_list'))}catch(e){setError('Local artwork could not be loaded: '+String(e))}finally{setBusy(false)}}
 useEffect(()=>{void refresh()},[bundledOnly]);
 const entries=source==='built-in'||bundledOnly?builtins:source==='local'?local:[...builtins,...local];
 const filtered=entries.filter(e=>(group==='All'||e.group===group)&&matchesName(e.name+' '+e.group,query)).sort((a,b)=>compareNames(a.name,b.name));
 const page=usePagedList(filtered,JSON.stringify([query,group,source]));
 const categories=Array.from(new Set(entries.map(e=>e.group))).sort(compareNames);
 async function saveArtwork(){setBusy(true);setError('');try{const count=await invoke<number|null>('import_artwork_files');if(count!==null){await refresh();setSource('local');setGroup('My imported artwork');setQuery('');}}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function importArtwork(file:File){
   setError('');
   if(!file.size||file.size>20_000_000){setError('Choose artwork between 1 byte and 20 MB.');return}
   try{onArt({name:file.name.replace(/\.[^.]+$/,''),mime:mime(file.name),bytes:Array.from(new Uint8Array(await file.arrayBuffer()))})}catch(e){setError(String(e))}
 }
 return <section><div className="artwork-library-heading"><div><h2>{bundledOnly?'Built-in design collection':'Artwork library'}</h2><small>{builtins.length} offline, editable vector designs · {new Set(builtins.map(e=>e.group)).size} categories</small></div>{!bundledOnly&&<button className="primary" disabled={busy} onClick={()=>void saveArtwork()}><Upload size={16}/> Import artwork files</button>}</div>{!bundledOnly&&<label>Choose a file without saving to library<input type="file" accept=".png,.webp,.jpg,.jpeg,.svg" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void importArtwork(file);}}/></label>}<div className="template-filters">{!bundledOnly&&<select aria-label="Artwork source" value={source} onChange={e=>{setSource(e.target.value as typeof source);setGroup('All')}}><option value="all">All artwork</option><option value="built-in">Built-in collection ({builtins.length})</option><option value="local">Local artwork</option></select>}<input aria-label="Search artwork" placeholder="Search artwork" value={query} onChange={e=>{setQuery(e.target.value)}}/><select aria-label="Design category" value={group} onChange={e=>{setGroup(e.target.value)}}>{['All',...categories].map(g=><option key={g} value={g}>{g==='All'?'All categories':g+' ('+entries.filter(e=>e.group===g).length+')'}</option>)}</select>{!bundledOnly&&<button onClick={()=>void refresh()} disabled={busy}>Refresh</button>}</div>{error&&<p role="alert">{error}</p>}{busy&&<small role="status">Loading local artwork…</small>}{!filtered.length?<p>No artwork matches your filters.</p>:<><small>{filtered.length} designs</small><div className="template-grid">{page.items.map(e=><Tile key={(e.svg!==undefined?'built-in/':'local/')+e.group+'/'+e.file} entry={e} onArt={onArt} actionLabel={actionLabel} openPrepared={onPrepared&&e.id&&prepared.includes(e.id)?()=>onPrepared(e.id!):undefined}/>)}</div><ListNavigation {...page}/></>}</section>
}
