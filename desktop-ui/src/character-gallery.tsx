import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Clock3,FileArchive,Heart,LayoutGrid,Palette,Search,Sparkles,Upload,X,FolderOpen,Wand2,PenLine} from 'lucide-react';
import {templateCatalog,sortCategories,type Complexity} from './template-catalog';
import './template-gallery.css';

export type ArtworkEntry={group:string;name:string;file:string;svg?:string;id?:string;collection?:string;tags?:string[];colors?:number;complexity?:Complexity;draft?:boolean};
export type Art={name:string;mime:string;bytes:number[];classic?:boolean;bundled?:boolean};

export const builtins:ArtworkEntry[]=templateCatalog;

function mime(file:string){return /\.svg$/i.test(file)?'image/svg+xml':/\.webp$/i.test(file)?'image/webp':/\.jpe?g$/i.test(file)?'image/jpeg':'image/png'}
// Retain the original vector paths and palette. Use a sensible 80 mm starting viewport
// for the single-artwork digitizer; the editor's insertion command sizes the actual artwork.
export function artworkBytes(svg:string){
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 const root=doc.documentElement;
 if(root.localName!=='svg'||doc.querySelector('parsererror'))throw Error('Invalid bundled artwork');
 const vb=(root.getAttribute('viewBox')??'').trim().split(/[\s,]+/).map(Number);
 if(vb.length===4&&vb[2]>0&&vb[3]>0&&vb.every(Number.isFinite)){
  root.setAttribute('width','80mm');root.setAttribute('height',(80*vb[3]/vb[2])+'mm');
 }
 return Array.from(new TextEncoder().encode(new XMLSerializer().serializeToString(root)));
}
const svgUrl=(svg:string)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
const keyOf=(e:ArtworkEntry)=>(e.svg!==undefined?'built-in/':'local/')+e.group+'/'+e.file;

function stored(name:string):string[]{try{const v=JSON.parse(localStorage.getItem(name)??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[]}catch{return []}}
function store(name:string,value:string[]){try{localStorage.setItem(name,JSON.stringify(value))}catch{/* preferences are optional */}}
const FAV='studio-template-favorites',RECENT='studio-template-recents';

/** Thumbnail for built-in SVGs (inline) or local files (loaded from the native library). */
function Thumb({entry,large}:{entry:ArtworkEntry;large?:boolean}){
 const [url,setUrl]=useState(entry.svg?svgUrl(entry.svg):''),[error,setError]=useState(false);
 useEffect(()=>{
  if(entry.svg!==undefined){setUrl(svgUrl(entry.svg));return}
  let active=true,u='';setUrl('');setError(false);
  invoke<number[]>('character_image',{group:entry.group,file:entry.file})
   .then(bytes=>{if(active){u=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime(entry.file)}));setUrl(u)}})
   .catch(()=>{if(active)setError(true)});
  return()=>{active=false;if(u)URL.revokeObjectURL(u)}
 },[entry.group,entry.file,entry.svg]);
 return <div className={'tg-thumb'+(large?' large':'')}>{url?<img src={url} alt={entry.name} loading="lazy" draggable={false}/>:<span className={error?'tg-thumb-error':'tg-skeleton'}>{error?'Preview unavailable':''}</span>}</div>;
}

type Filter={style:string;colors:string;complexity:string;sort:string};
const noFilter:Filter={style:'',colors:'',complexity:'',sort:'name'};
const rank:Record<Complexity,number>={Simple:0,Moderate:1,Detailed:2};

export function CharacterGallery({onArt,actionLabel='Digitize',bundledOnly=false,onPrepared,variant='page'}:{onArt:(a:Art)=>void;actionLabel?:string;bundledOnly?:boolean;onPrepared?:(id:string)=>Promise<void>;variant?:'page'|'picker'}){
 const [local,setLocal]=useState<ArtworkEntry[]>([]),[query,setQuery]=useState(''),[group,setGroup]=useState(()=>{try{const c=sessionStorage.getItem('studio-template-category');sessionStorage.removeItem('studio-template-category');return c||'All'}catch{return 'All'}}),[error,setError]=useState(''),[busy,setBusy]=useState(!bundledOnly);
 const [filter,setFilter]=useState<Filter>(noFilter),[selected,setSelected]=useState<ArtworkEntry|null>(null),[working,setWorking]=useState('');
 const [favorites,setFavorites]=useState(()=>stored(FAV)),[recents,setRecents]=useState(()=>stored(RECENT));
 const [archiveNotice,setArchiveNotice]=useState('');
 const [prepared,setPrepared]=useState<string[]>([]);
 useEffect(()=>{if(!onPrepared)return;let active=true;invoke<string[]>('prepared_bundled_designs').then(ids=>{if(active&&Array.isArray(ids))setPrepared(ids)}).catch(()=>{});return()=>{active=false}},[!!onPrepared]);
 async function refresh(){if(bundledOnly)return;setBusy(true);setError('');try{setLocal((await invoke<ArtworkEntry[]>('character_list'))??[])}catch(e){setError('Local artwork could not be loaded: '+String(e))}finally{setBusy(false)}}
 useEffect(()=>{void refresh()},[bundledOnly]);
 useEffect(()=>{if(!selected)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelected(null)};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k)},[selected]);

 const all=useMemo(()=>bundledOnly?builtins:[...builtins,...local],[local,bundledOnly]);
 const byKey=useMemo(()=>new Map(all.map(e=>[keyOf(e),e])),[all]);
 const categories=useMemo(()=>sortCategories(Array.from(new Set(builtins.map(e=>e.group)))),[]);
 const localGroups=useMemo(()=>Array.from(new Set(local.map(e=>e.group))).sort(compareNames),[local]);
 const counts=useMemo(()=>{const m=new Map<string,number>();for(const e of all)m.set(e.group,(m.get(e.group)??0)+1);return m},[all]);
 const styles=useMemo(()=>Array.from(new Set(builtins.flatMap(e=>e.tags?.filter(t=>['Line art','Solid color','Filled','Detailed','Lettering'].includes(t))??[]))).sort(),[]);
 const pick=(keys:string[])=>keys.map(k=>byKey.get(k)).filter((e):e is ArtworkEntry=>!!e);

 const scoped=group==='All'?all:group==='Favorites'?pick(favorites):group==='Recent'?pick(recents):all.filter(e=>e.group===group);
 const filtered=scoped.filter(e=>matchesName([e.name,e.group,e.collection??'',...(e.tags??[])].join(' '),query)
  &&(!filter.style||!!e.tags?.includes(filter.style))
  &&(!filter.complexity||e.complexity===filter.complexity)
  &&(!filter.colors||(e.colors!==undefined&&(filter.colors==='1-2'?e.colors<=2:filter.colors==='3-4'?e.colors>=3&&e.colors<=4:e.colors>=5))));
 if(group!=='Recent')filtered.sort((a,b)=>filter.sort==='simple'?(rank[a.complexity??'Moderate']-rank[b.complexity??'Moderate'])||compareNames(a.name,b.name)
  :filter.sort==='colors'?((a.colors??9)-(b.colors??9))||compareNames(a.name,b.name):compareNames(a.name,b.name));
 const page=usePagedList(filtered,JSON.stringify([query,group,filter]),variant==='picker'?24:48);
 const filtersOn=!!(query||filter.style||filter.colors||filter.complexity);

 function toggleFavorite(e:ArtworkEntry){const k=keyOf(e);setFavorites(f=>{const next=f.includes(k)?f.filter(x=>x!==k):[k,...f];store(FAV,next);return next})}
 function remember(e:ArtworkEntry){const k=keyOf(e);setRecents(r=>{const next=[k,...r.filter(x=>x!==k)].slice(0,24);store(RECENT,next);return next})}
 async function choose(entry:ArtworkEntry){
  setWorking(keyOf(entry));setError('');
  try{const bytes=entry.svg!==undefined?artworkBytes(entry.svg):await invoke<number[]>('character_image',{group:entry.group,file:entry.file});remember(entry);onArt({name:entry.name,mime:mime(entry.file),bytes,bundled:entry.svg!==undefined,classic:entry.group==='Classic animation (1928)'})}
  catch(e){setError(String(e))}finally{setWorking('')}
 }
 async function openPrepared(entry:ArtworkEntry){if(!onPrepared||!entry.id)return;setWorking(keyOf(entry));setError('');try{remember(entry);await onPrepared(entry.id)}catch(e){setError(String(e))}finally{setWorking('')}}
 async function saveArtwork(){setBusy(true);setError('');try{const count=await invoke<number|null>('import_artwork_files');if(count!==null){await refresh();setGroup('My imported artwork');setQuery('')}}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function saveArchive(){
  setBusy(true);setError('');setArchiveNotice('');
  try{
   const report=await invoke<{imported:number;duplicates:number;skipped:number}|null>('import_artwork_archive');
   if(!report)return;
   await refresh();
   setGroup('My imported artwork');setQuery('');setFilter(previous=>({...noFilter,sort:previous.sort}));
   setArchiveNotice(`Added ${report.imported} SVG ${report.imported===1?'file':'files'} · ${report.duplicates} already in this collection · ${report.skipped} skipped`);
  }catch(e){setError(String(e))}finally{setBusy(false)}
 }
 async function importArtwork(file:File){
  setError('');
  if(!file.size||file.size>20_000_000){setError('Choose artwork between 1 byte and 20 MB.');return}
  try{onArt({name:file.name.replace(/\.[^.]+$/,''),mime:mime(file.name),bytes:Array.from(new Uint8Array(await file.arrayBuffer()))})}catch(e){setError(String(e))}
 }

 const railItem=(id:string,label:string,count:number,icon?:ReactNode)=><button key={id} className="tg-rail-item" aria-pressed={group===id} onClick={()=>{setGroup(id);setSelected(null)}}>{icon}<span>{label}</span><small>{count}</small></button>;
 const isFav=(e:ArtworkEntry)=>favorites.includes(keyOf(e));
 const meta=(e:ArtworkEntry)=>[e.colors!==undefined?e.colors+(e.colors===1?' color':' colors'):null,e.complexity].filter(Boolean).join(' · ');
 const heading=group==='All'?'All designs':group==='Recent'?'Recently used':group;
 const preparedFor=(e:ArtworkEntry)=>!!(onPrepared&&e.id&&prepared.includes(e.id));

 return <section className={'tg tg-'+variant+(selected&&variant==='page'?' tg-has-detail':'')} aria-label={bundledOnly?'Built-in design collection':'Artwork library'}>
  <nav className="tg-rail" aria-label="Design categories">
   {railItem('All','All designs',all.length,<LayoutGrid size={15}/>)}
   {railItem('Favorites','Favorites',pick(favorites).length,<Heart size={15}/>)}
   {railItem('Recent','Recently used',pick(recents).length,<Clock3 size={15}/>)}
   <h3>Categories</h3>
   {categories.map(c=>railItem(c,c,counts.get(c)??0))}
   {!bundledOnly&&<><h3>My artwork</h3>{localGroups.length?localGroups.map(c=>railItem(c,c,counts.get(c)??0,<FolderOpen size={15}/>)):<small className="tg-rail-empty">{busy?'Loading…':'No imported artwork yet'}</small>}</>}
  </nav>
  <div className="tg-main">
   <div className="tg-toolbar">
    <select className="tg-rail-select" aria-label="Design category" value={group} onChange={e=>{setGroup(e.target.value);setSelected(null)}}>
     <option value="All">All designs ({all.length})</option><option value="Favorites">Favorites</option><option value="Recent">Recently used</option>
     {[...categories,...localGroups].map(c=><option key={c} value={c}>{c} ({counts.get(c)??0})</option>)}
    </select>
    <label className="tg-search"><Search size={15} aria-hidden="true"/><input aria-label="Search artwork" placeholder={'Search '+all.length+' designs: bow, faith, nameplate…'} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={14}/></button>}</label>
    <select aria-label="Artwork style" value={filter.style} onChange={e=>setFilter({...filter,style:e.target.value})}><option value="">Any style</option>{styles.map(s=><option key={s}>{s}</option>)}</select>
    <select aria-label="Thread colors" value={filter.colors} onChange={e=>setFilter({...filter,colors:e.target.value})}><option value="">Any colors</option><option value="1-2">1–2 colors</option><option value="3-4">3–4 colors</option><option value="5+">5+ colors</option></select>
    <select aria-label="Stitch complexity" value={filter.complexity} onChange={e=>setFilter({...filter,complexity:e.target.value})}><option value="">Any detail</option><option>Simple</option><option>Moderate</option><option>Detailed</option></select>
    <select aria-label="Sort designs" value={filter.sort} onChange={e=>setFilter({...filter,sort:e.target.value})}><option value="name">Name A–Z</option><option value="simple">Simplest first</option><option value="colors">Fewest colors</option></select>
    {!bundledOnly&&<span className="tg-toolbar-actions">{variant==='page'&&<label className="tg-file-button">Use a file once<input type="file" accept=".png,.webp,.jpg,.jpeg,.svg" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void importArtwork(file)}}/></label>}<button className="primary" disabled={busy} onClick={()=>void saveArtwork()}><Upload size={15}/> Import artwork</button><button disabled={busy} onClick={()=>void saveArchive()}><FileArchive size={15}/> Import SVG ZIP</button></span>}
   </div>
   <div className="tg-head"><h2>{heading}</h2><small>{filtered.length} {filtered.length===1?'design':'designs'}</small>{filtersOn&&<button className="tg-link" onClick={()=>{setQuery('');setFilter({...noFilter,sort:filter.sort})}}>Clear filters</button>}</div>
   {archiveNotice&&<p role="status">{archiveNotice}</p>}
   {error&&<p className="tg-error" role="alert">{error}</p>}
   {!filtered.length?<div className="tg-empty">{group==='Favorites'&&!filtersOn?<><Heart size={22}/><strong>No favorites yet</strong><span>Tap the heart on any design to keep it here.</span></>:group==='Recent'&&!filtersOn?<><Clock3 size={22}/><strong>Nothing used yet</strong><span>Designs you open appear here.</span></>:<><Search size={22}/><strong>No designs match</strong><span>Try another word or clear the filters.</span></>}</div>
   :<><div className="tg-grid">{page.items.map(e=>{const k=keyOf(e),current=!!selected&&keyOf(selected)===k;return <div key={k} className={'tg-card'+(current?' selected':'')}>
     <button className="tg-card-main" aria-label={(variant==='picker'?actionLabel+': ':'')+e.name} aria-pressed={variant==='page'?current:undefined} disabled={working===k}
      onClick={()=>variant==='picker'?void choose(e):setSelected(current?null:e)} onDoubleClick={()=>{if(variant==='page')void choose(e)}}>
      <Thumb entry={e}/>
      <span className="tg-card-name">{e.name}</span>
      <span className="tg-card-meta">{e.svg===undefined?'My artwork':meta(e)}</span>
     </button>
     <button className={'tg-fav'+(isFav(e)?' on':'')} aria-label={(isFav(e)?'Remove from':'Add to')+' favorites: '+e.name} aria-pressed={isFav(e)} onClick={()=>toggleFavorite(e)}><Heart size={14}/></button>
     {e.draft&&<span className="tg-badge" title="Traced artwork. Review lettering and edges before production.">Draft</span>}
    </div>})}</div><ListNavigation {...page}/></>}
  </div>
  {variant==='page'&&selected&&<div role="region" className="tg-detail" aria-label={'Design details: '+selected.name}>
   <button className="tg-detail-close" aria-label="Close details" onClick={()=>setSelected(null)}><X size={16}/></button>
   <Thumb entry={selected} large/>
   <h3>{selected.name}</h3>
   <p className="tg-detail-sub">{selected.svg===undefined?'My artwork · '+selected.group:[selected.group,selected.collection].filter(Boolean).join(' · ')}</p>
   {(selected.colors!==undefined||selected.complexity)&&<dl className="tg-facts">
    {selected.colors!==undefined&&<div><dt><Palette size={13}/> Colors</dt><dd>{selected.colors}</dd></div>}
    {selected.complexity&&<div><dt><Sparkles size={13}/> Detail</dt><dd>{selected.complexity}</dd></div>}
   </dl>}
   {!!selected.tags?.length&&<div className="tg-tags">{selected.tags.map(t=><button key={t} onClick={()=>{setQuery(t);setGroup('All');setSelected(null)}}>{t}</button>)}</div>}
   {selected.draft&&<p className="tg-note">Traced artwork. Check lettering and edges in the stitch preview before sewing.</p>}
   <div className="tg-actions">
    {preparedFor(selected)&&<button className="primary" disabled={!!working} onClick={()=>void openPrepared(selected)}><PenLine size={15}/> Open ready-to-edit design</button>}
    <button className={preparedFor(selected)?'':'primary'} disabled={!!working} onClick={()=>void choose(selected)}><Wand2 size={15}/> {working===keyOf(selected)?'Opening…':actionLabel}</button>
    <button onClick={()=>toggleFavorite(selected)} aria-pressed={isFav(selected)}><Heart size={15}/> {isFav(selected)?'Favorited':'Add to favorites'}</button>
   </div>
   <small className="tg-hint">Double-click a design to {actionLabel.toLowerCase()} it straight away.</small>
  </div>}
 </section>;
}
