import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
type Entry={group:string;name:string;file:string};
export type Art={name:string;mime:string;bytes:number[];classic?:boolean};
function mime(file:string){return /\.webp$/i.test(file)?'image/webp':/\.jpe?g$/i.test(file)?'image/jpeg':'image/png'}
function Tile({entry,onArt}:{entry:Entry;onArt:(a:Art)=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true,u='';invoke<number[]>('character_image',{group:entry.group,file:entry.file}).then(bytes=>{if(active){u=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime(entry.file)}));setUrl(u)}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false;if(u)URL.revokeObjectURL(u)}},[entry.group,entry.file]);
 async function choose(){setBusy(true);try{const bytes=await invoke<number[]>('character_image',{group:entry.group,file:entry.file});onArt({name:entry.name,mime:mime(entry.file),bytes,classic:entry.group==='Classic animation (1928)'})}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <article><div style={{height:108,display:'grid',placeItems:'center'}}>{url?<img src={url} alt={entry.name} loading="lazy" style={{maxWidth:'100%',maxHeight:108,objectFit:'contain'}}/>:<small>{error?'Image unavailable':'Loading artwork…'}</small>}</div><small>{entry.group}</small>{entry.file==='mickey-1928.jpg'&&entry.group==='Classic animation (1928)'&&<div><a href="https://commons.wikimedia.org/wiki/File:Mickey_Mouse_as_he_appears_in_Steamboat_Willie_(1928).jpg" target="_blank" rel="noreferrer">Artwork source</a></div>}{entry.file==='minnie-1928.png'&&entry.group==='Classic animation (1928)'&&<div><a href="https://commons.wikimedia.org/wiki/File:Minnie_Mouse_from_Steamboat_Willie.png" target="_blank" rel="noreferrer">Artwork source</a></div>}<h3>{entry.name}</h3><button disabled={busy||!url} onClick={choose}>{busy?'Opening…':'Digitize'}</button></article>
}
export function CharacterGallery({onArt}:{onArt:(a:Art)=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[group,setGroup]=useState('All'),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 async function refresh(){setBusy(true);setError('');try{setEntries(await invoke<Entry[]>('character_list'))}catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{void refresh()},[]);
 const filtered=entries.filter(e=>(group==='All'||e.group===group)&&matchesName(e.name,query)).sort((a,b)=>compareNames(a.name,b.name));
 const page=usePagedList(filtered,JSON.stringify([query,group]));
 async function importArtwork(file:File){
   setError('');
   if(file.size>20_000_000){setError('Choose artwork under 20 MB.');return}
   try {
     onArt({name:file.name.replace(/\.[^.]+$/,''),mime:mime(file.name),bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
   } catch(error) {setError(String(error));}
 }
 return <section><h2>Character artwork</h2><label>Add artwork from disk<input type="file" accept=".png,.webp,.jpg,.jpeg"
   onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void importArtwork(file);}}/></label><div className="template-filters"><input aria-label="Search characters" placeholder="Search characters" value={query} onChange={e=>{setQuery(e.target.value)}}/><select aria-label="Collection" value={group} onChange={e=>{setGroup(e.target.value)}}>{['All',...new Set(entries.map(e=>e.group))].map(g=><option key={g}>{g}</option>)}</select><button onClick={refresh} disabled={busy}>Refresh</button></div>{error&&<p role="alert">{error}</p>}{busy?<p>Loading collections…</p>:!entries.length?<p>No local artwork yet. Add artwork you have permission to use to collection folders inside StitchStudio Artwork in your home folder.</p>:<><small>{filtered.length} designs</small><div className="template-grid">{page.items.map(e=><Tile key={e.group+'/'+e.file} entry={e} onArt={onArt}/>)}</div><ListNavigation {...page}/></>}</section>
}
