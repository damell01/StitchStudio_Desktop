import {useRef,useState,useEffect} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {FolderOpen,ImagePlus,Check,Play,Pause,X} from 'lucide-react';
import {thumbnailOf,rememberProject,type Project} from './library';
type Plan={stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type Review={id:number;plan:Plan;warnings:string[]};
type Variant={strength:number;plan:Plan|null;quality?:{coverage:number}|null};
type Item={id:string;file:File;status:'queued'|'working'|'review'|'approved'|'rejected'|'failed';original?:string;thumb?:string;stitches?:number;trims?:number;colors?:number;minutes?:number;warnings?:string[];error?:string};
const mimes:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',gif:'image/gif'};
const mime=(f:File)=>mimes[f.name.split('.').pop()?.toLowerCase()??''];
const time=(p:Plan)=>p.stitches/800+p.trims*3/60+Math.max(0,p.blocks.length-1)*8/60;
export function BulkImport({onLibrary}:{onLibrary:()=>void}){
 const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false),[width,setWidth]=useState('3.15'),[error,setError]=useState(''),[filter,setFilter]=useState('all'),[selected,setSelected]=useState<string|null>(null);
 const stop=useRef(false),lock=useRef(false),mounted=useRef(true),urls=useRef<string[]>([]),folder=useRef<HTMLInputElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;urls.current.forEach(u=>URL.revokeObjectURL(u))}},[]);
 useEffect(()=>{folder.current?.setAttribute('webkitdirectory','');folder.current?.setAttribute('directory','')},[]);
 function patch(id:string,part:Partial<Item>){if(mounted.current)setItems(old=>old.map(i=>i.id===id?{...i,...part}:i))}
 function add(files:FileList|File[]){if(lock.current)return;const all=Array.from(files);const valid=all.filter(f=>mime(f)&&f.size>0&&f.size<=20_000_000);const room=Math.max(0,500-items.length);const next=valid.slice(0,room).map(file=>{const original=URL.createObjectURL(file);urls.current.push(original);return {id:crypto.randomUUID(),file,status:'queued' as const,original}});setItems(old=>[...old,...next]);setError(all.length!==next.length?(all.length-next.length)+' files skipped: unsupported format, empty, larger than 20 MB, or batch limit of 500.':'')}
 async function run(){if(lock.current)return;const mm=Number(width)*25.4;if(!Number.isFinite(mm)||mm<5||mm>300){setError('Choose a width between 5 and 300 mm.');return}lock.current=true;stop.current=false;setBusy(true);setError('');
 try{for(const item of items.filter(i=>i.status==='queued')){
  if(stop.current||!mounted.current)break;
  patch(item.id,{status:'working',error:undefined});try{
   const bytes=Array.from(new Uint8Array(await item.file.arrayBuffer()));const type=mime(item.file);let lettering:unknown[]=[];const warnings:string[]=[];
   if(type!=='image/svg+xml'){try{lettering=await invoke<unknown[]>('recognize_artwork_lettering',{bytes,removeBackground:true,tolerance:32,cleanup:true})}catch{warnings.push('Lettering recognition unavailable; used normal tracing.')}}
   if(!mounted.current)break;
   const review=await invoke<Review>('digitize_artwork',{name:item.file.name,mime:type,bytes,widthMm:mm,colors:0,removeBackground:true,detail:60,fabric:'standard',cleanup:true,tolerance:32,thinLines:false,threadPalette:[],lettering});
   let best=review.plan,strength=0;
   if(best.stitches<=100000){try{const variants=await invoke<Variant[]>('compare_digitizer_draft',{id:review.id});for(const v of variants){if(v.plan&&v.strength!==4&&(v.quality?.coverage??0)>=85&&time(v.plan)<time(best)){best=v.plan;strength=v.strength}}}catch{warnings.push('Additional optimization unavailable; original generated plan retained.')}}
   if(!mounted.current)break;
   await invoke('stage_batch_draft',{id:review.id,strength,token:item.id});
   patch(item.id,{status:'review',thumb:thumbnailOf(best),stitches:best.stitches,trims:best.trims,colors:best.blocks.length,minutes:time(best),warnings:[...review.warnings,...warnings]});
  }catch(e){patch(item.id,{status:'failed',error:String(e)})}
 }}finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 async function approve(list:Item[]){if(lock.current)return;lock.current=true;setBusy(true);try{for(const item of list){try{const project=await invoke<Project>('approve_batch_draft',{token:item.id});rememberProject(project);patch(item.id,{status:'approved',error:undefined})}catch(e){patch(item.id,{error:String(e)})}}}finally{lock.current=false;setBusy(false)}}
 async function reject(item:Item){if(lock.current)return;try{await invoke('discard_batch_draft',{token:item.id});patch(item.id,{status:'rejected'})}catch(e){patch(item.id,{error:String(e)})}}
 const count=(status:Item['status'])=>items.filter(i=>i.status===status).length;
 const visible=items.filter(i=>filter==='all'||i.status===filter);
 const focus=items.find(i=>i.id===selected);
 return <section className="bulk-import" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files)}}>
 <div className="studio-tools"><label className="bulk-file-button"><ImagePlus size={16}/> Add artwork files<input type="file" multiple accept={Object.keys(mimes).map(e=>'.'+e).join(',')} disabled={busy} onChange={e=>{if(e.target.files)add(e.target.files);e.target.value=''}}/></label><label className="bulk-file-button"><FolderOpen size={16}/> Add folder<input ref={folder} type="file" multiple disabled={busy} onChange={e=>{if(e.target.files)add(e.target.files);e.target.value=''}}/></label><label>Raster width (in) <input type="number" min=".2" max="11.8" step=".1" value={width} disabled={busy} onChange={e=>setWidth(e.target.value)}/></label><button className="primary" disabled={busy||!count('queued')} onClick={()=>void run()}><Play size={16}/> Digitize queued</button><button disabled={!busy} onClick={()=>{stop.current=true}}><Pause size={16}/> Pause after current</button></div>
 <div className="bulk-counts">{[['Total',items.length],['Queued',count('queued')],['Needs review',count('review')],['Approved',count('approved')],['Failed',count('failed')]].map(([label,n])=><article key={label}><small>{label}</small><strong>{n}</strong></article>)}</div>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Processing queue… designs are handled one at a time.</p>}
 <div className="studio-tools"><select aria-label="Filter imports" value={filter} onChange={e=>setFilter(e.target.value)}>{['all','queued','working','review','approved','rejected','failed'].map(v=><option key={v} value={v}>{v}</option>)}</select><button disabled={busy||!count('review')} onClick={()=>{if(window.confirm('Approve all '+count('review')+' staged designs? Review their previews first.'))void approve(items.filter(i=>i.status==='review'))}}>Approve all reviewed designs</button><button disabled={busy||!count('failed')} onClick={()=>setItems(old=>old.map(i=>i.status==='failed'?{...i,status:'queued',error:undefined}:i))}>Retry failed</button><button disabled={busy} onClick={onLibrary}>Open design library</button></div>
 {!items.length&&<article className="bulk-empty"><FolderOpen size={40}/><h2>Drop artwork here or select files and folders</h2><p>PNG, JPG, SVG, WebP, BMP, TIFF and GIF. Up to 500 files per queue. Originals are unchanged.</p></article>}
 <div className="bulk-grid">{visible.map(item=><article key={item.id}><div className="bulk-thumbs"><div><small>Original</small><img src={item.original} alt="Original artwork"/></div><div><small>Stitches</small>{item.thumb?<img src={item.thumb} alt="Digitized stitch preview"/>:<span>{item.status==='working'?'Digitizing…':'Not generated'}</span>}</div></div><strong title={item.file.name}>{item.file.name}</strong><small>{item.status==='review'?'Ready for review':item.status}</small>{item.stitches!==undefined&&<small>{item.stitches.toLocaleString()} stitches · {item.trims} trims · {item.colors} blocks · ~{Math.ceil(item.minutes??0)} min</small>}{!!item.warnings?.length&&<small>{item.warnings.length} quality notes</small>}{item.error&&<p role="alert">{item.error}</p>}<div className="pricing-actions">{item.thumb&&<button onClick={()=>setSelected(item.id)}>Review</button>}{item.status==='review'&&<><button className="primary" disabled={busy} onClick={()=>void approve([item])}><Check size={15}/> Approve</button><button disabled={busy} onClick={()=>void reject(item)}>Reject</button></>}{(item.status==='failed'||item.status==='rejected')&&<button disabled={busy} onClick={()=>patch(item.id,{status:'queued',error:undefined})}>Retry</button>}</div></article>)}</div>
 {focus&&<div className="pricing-modal-backdrop" onClick={()=>setSelected(null)}><section className="pricing-modal" role="dialog" aria-modal="true" aria-label="Review digitized design" onClick={e=>e.stopPropagation()}><div className="pricing-modal-title"><h2>{focus.file.name}</h2><button onClick={()=>setSelected(null)} aria-label="Close review"><X size={18}/></button></div><div className="bulk-thumbs bulk-review"><div><small>Original</small><img src={focus.original} alt="Original artwork"/></div><div><small>Digitized design</small><img src={focus.thumb} alt="Stitch preview"/></div></div><p>{focus.stitches?.toLocaleString()} stitches · {focus.trims} trims</p>{focus.warnings?.map((w,i)=><p key={i}>{w}</p>)}{focus.status==='review'&&<div className="pricing-actions"><button disabled={busy} className="primary" onClick={()=>{void approve([focus]);setSelected(null)}}>Approve to library</button><button disabled={busy} onClick={()=>{void reject(focus);setSelected(null)}}>Reject</button></div>}</section></div>}
 </section>
}
