import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
type Entry={group:string;name:string;file:string};
type Art={name:string;mime:string;bytes:number[]};
function mime(file:string){return /\.webp$/i.test(file)?'image/webp':/\.jpe?g$/i.test(file)?'image/jpeg':'image/png'}
function Tile({entry,onArt}:{entry:Entry;onArt:(a:Art)=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true,u='';invoke<number[]>('character_image',{group:entry.group,file:entry.file}).then(bytes=>{if(active){u=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime(entry.file)}));setUrl(u)}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false;if(u)URL.revokeObjectURL(u)}},[entry.group,entry.file]);
 async function choose(){setBusy(true);try{const bytes=await invoke<number[]>('character_image',{group:entry.group,file:entry.file});onArt({name:entry.name,mime:mime(entry.file),bytes})}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <article><div style={{height:108,display:'grid',placeItems:'center'}}>{url?<img src={url} alt={entry.name} loading="lazy" style={{maxWidth:'100%',maxHeight:108,objectFit:'contain'}}/>:<small>{error?'Image unavailable':'Loading artwork…'}</small>}</div><small>{entry.group}</small><h3>{entry.name}</h3><button disabled={busy||!url} onClick={choose}>{busy?'Opening…':'Digitize'}</button></article>
}
export function CharacterGallery({onArt}:{onArt:(a:Art)=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[query,setQuery]=useState(''),[group,setGroup]=useState('All'),[error,setError]=useState(''),[busy,setBusy]=useState(true),[limit,setLimit]=useState(24);
 async function refresh(){setBusy(true);setError('');try{setEntries(await invoke<Entry[]>('character_list'))}catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{void refresh()},[]);
 const filtered=entries.filter(e=>(group==='All'||e.group===group)&&e.name.toLowerCase().includes(query.toLowerCase()));
 return <section><h2>Character artwork</h2><div className="template-filters"><input aria-label="Search characters" placeholder="Search characters" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24)}}/><select aria-label="Collection" value={group} onChange={e=>{setGroup(e.target.value);setLimit(24)}}>{['All',...new Set(entries.map(e=>e.group))].map(g=><option key={g}>{g}</option>)}</select><button onClick={refresh} disabled={busy}>Refresh</button></div>{error&&<p role="alert">{error}</p>}{busy?<p>Loading collections…</p>:!entries.length?<p>No local artwork yet. Run the artwork download scripts or add images to collection folders inside StitchStudio Artwork in your home folder.</p>:<><small>{filtered.length} designs</small><div className="template-grid">{filtered.slice(0,limit).map(e=><Tile key={e.group+'/'+e.file} entry={e} onArt={onArt}/>)}</div>{filtered.length>limit&&<button onClick={()=>setLimit(n=>n+24)}>Load more</button>}</>}</section>
}
