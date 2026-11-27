import {confirmAction} from './dialogs';
import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {useEffect,useRef,useState} from 'react';
import {captureFontDrop, importFontDrop, type FontDrop, type FontImportResult as Result} from './font-drop';
import {invoke} from '@tauri-apps/api/core';
import {FolderOpen,Upload,Search,Type,Star,Trash2,LayoutGrid,List} from 'lucide-react';
type Asset={name:string;file:string;format:string;bytes:number};
export function Fonts({initialDrop,onBusyChange}: {initialDrop?:FontDrop;onBusyChange?:(busy:boolean)=>void} = {}){const [dragging,setDragging]=useState(false);const dropLock=useRef(false);const [assets,setAssets]=useState<Asset[]>([]),[system,setSystem]=useState<string[]>([]),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);async function refresh(){try{const [a,s]=await Promise.all([invoke<Asset[]>('font_assets'),invoke<string[]>('lettering_fonts')]);setAssets(a);setSystem(s)}catch(e){setError(String(e))}}useEffect(()=>{if(initialDrop)void dropFonts(initialDrop);else void refresh()},[]);useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange]);async function upload(folder:boolean){setBusy(true);setError('');setResult(null);try{const r=await invoke<Result|null>('import_fonts',{folder});if(r){setResult(r);await refresh()}}catch(e){setError(String(e))}finally{setBusy(false)}}const [favorites,setFavorites]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('studio-font-favorites')||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[]}catch{return []}}),[onlyFavorites,setOnlyFavorites]=useState(false),[sort,setSort]=useState('name');function favorite(id:string){setFavorites(old=>{const next=old.includes(id)?old.filter(x=>x!==id):[...old,id];localStorage.setItem('studio-font-favorites',JSON.stringify(next));return next})}async function remove(a:Asset){if(!await confirmAction('Remove '+a.name+' from the Stitch Studio library? The original imported file is not affected.'))return;setBusy(true);try{await invoke('remove_font_asset',{file:a.file});await refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}const rows = [
  ...assets.map(asset=>({name:asset.name,id:asset.file,format:asset.format,bytes:asset.bytes,asset})),
  ...system.map(name=>({name,id:'system:'+name,format:'system',bytes:0,asset:null})),
].filter(row=>(filter==='all'||filter===row.format)&&matchesName(row.name,query)&&(!onlyFavorites||favorites.includes(row.id)))
.sort((a,b)=>(sort==='size' ? b.bytes-a.bytes : 0)||compareNames(a.name,b.name));
async function dropFonts(entries: FontDrop) {
  if (busy || dropLock.current || !entries.length) return;
  dropLock.current=true;setBusy(true);setError('');setResult(null);
  try {
    setResult(await importFontDrop(entries));
    await refresh();
  } catch (err) {
    setError(String(err));
  } finally {
    dropLock.current=false;setBusy(false);
  }
}
const [sample,setSample]=useState('Stitch Studio'),[view,setView]=useState<'grid'|'list'>('grid');
const page=usePagedList(rows,JSON.stringify([query,filter,onlyFavorites,sort,view]),view==='grid'?12:10);
return <section className={`font-workspace font-view-${view}`}
  onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)setDragging(true);}}}
  onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragging(false)}}
  onDrop={event=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();setDragging(false);void dropFonts(captureFontDrop(event.dataTransfer));}}><div className="font-overview"><div><strong>{assets.length}</strong><small>Imported fonts</small></div><div><strong>{system.length}</strong><small>Lettering families</small></div><div><strong>{favorites.length}</strong><small>Favorites</small></div></div><div className="font-import" data-dragging={dragging||undefined}><button disabled={busy} onClick={()=>upload(true)}><FolderOpen size={24}/><strong>Scan a folder</strong><small>Includes every nested folder</small></button><button disabled={busy} onClick={()=>upload(false)}><Upload size={24}/><strong>Import font files</strong><small>Drop folders or BX, TTF and OTF files, or browse</small></button></div>{busy&&<p role="status">Scanning and importing fonts…</p>}{error&&<p role="alert">{error}</p>}{result&&<article role="status"><h2>Import results</h2><p>{result.imported} imported · {result.duplicates} duplicates · {result.skipped} skipped</p>{result.errors.length>0&&<details><summary>{result.errors.length} errors</summary>{result.errors.map((e,i)=><p key={i}>{e}</p>)}</details>}</article>}<div className="font-preview-toolbar"><label>Preview text<input value={sample} maxLength={64} onChange={e=>setSample(e.target.value)} placeholder="Type your sample"/></label><div role="group" aria-label="Font layout"><button aria-label="Grid view" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><LayoutGrid size={17}/></button><button aria-label="List view" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={17}/></button></div></div><div className="font-filters"><Search size={18}/><input aria-label="Search fonts" placeholder="Search font names…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Font format" value={filter} onChange={e=>setFilter(e.target.value)}>{['all','bx','ttf','otf','system'].map(f=><option key={f} value={f}>{f==='all'?'All fonts':f==='system'?'Installed system fonts':f.toUpperCase()}</option>)}</select><select aria-label="Sort fonts" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Name and stitch size</option><option value="size">Largest files</option></select><label><input type="checkbox" checked={onlyFavorites} onChange={e=>setOnlyFavorites(e.target.checked)}/> Favorites</label></div>{!rows.length&&<p role="status">No fonts match these filters.</p>}
<div className="font-list">{page.items.map(row=><article key={row.id}>
  <div className="font-card-preview" style={row.asset?undefined:{fontFamily:row.name}}>{row.asset?<><Type size={26}/><small>{row.format.toUpperCase()} file</small></>:<span>{sample||"Aa"}</span>}</div>
  <div><strong>{row.name}</strong><small>{row.asset?`${row.format.toUpperCase()} · ${Math.ceil(row.bytes/1024)} KB`:'Lettering family'}</small></div>
  <small>{row.format==='bx'?'BX file saved to library':row.asset?'Installed in Stitch Studio':'Available for lettering'}</small>
  <button aria-label={'Favorite '+row.name} aria-pressed={favorites.includes(row.id)} onClick={()=>favorite(row.id)}><Star size={16} fill={favorites.includes(row.id)?'currentColor':'none'}/></button>
  {row.asset&&<button disabled={busy} aria-label={'Remove '+row.name} onClick={()=>{if(row.asset)void remove(row.asset)}}><Trash2 size={16}/></button>}
</article>)}</div><ListNavigation {...page}/><p className="muted">TTF and OTF imports are available in the Stitch Studio lettering picker. BX files are stored locally and need a compatible decoder to be stitched. Extract ZIP bundles before importing. Identical files with the same name are skipped; conflicting names are preserved.</p></section>}
