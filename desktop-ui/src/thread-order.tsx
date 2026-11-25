import {useRef,useState,useEffect,useMemo} from 'react';
import {thumbnailOf} from './library';
import {ListOrdered,X} from 'lucide-react';
import {ListNavigation,usePagedList} from './list-navigation';

export type ThreadAssignments=Record<number,string>;
type Block = {color:number[]; runs:number[][][]};

export function ThreadOrder({blocks,format,machine,assignments,onAssign}:{blocks:Block[];format:string;machine:string;assignments:ThreadAssignments;onAssign:(index:number,value:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const page=usePagedList(blocks,'thread-order',8);
  return <>
    <button className="studio-tool-icon" aria-label="Thread order" title="Thread order and machine color mapping" disabled={!blocks.length} onClick={()=>dialog.current?.showModal()}><ListOrdered size={18}/></button>
    <dialog className="studio-modal thread-order-dialog" ref={dialog} aria-label="Thread order">
      <div className="studio-modal-heading"><h2>Thread order</h2><button aria-label="Close thread order" onClick={()=>dialog.current?.close()}><X size={17}/></button></div>
      <p>{machine||'Manual machine setup'} · {format.toUpperCase()} · {blocks.length} {blocks.length===1?'color block':'color blocks'}</p>
      <p>Use the block numbers to match thread colors on your machine. Enter a needle number or spool label for reference.{format==='dst'?' DST carries color-change positions. Use these swatches to match the colors by hand.':''}</p>
      <table className="thread-order-table">
        <thead><tr><th scope="col">Block</th><th scope="col">Design color</th><th scope="col">Needle or spool</th></tr></thead>
        <tbody>{page.items.map((block,offset)=>{
          const index=page.start+offset;
          const color='#'+block.color.map(channel=>channel.toString(16).padStart(2,'0')).join('').toUpperCase();
          return <tr key={index}>
            <th scope="row">{index+1}</th>
            <td><span className="thread-order-swatch" style={{backgroundColor:color}}/>{color}</td>
            <td><input aria-label={`Needle or spool for block ${index+1}`} maxLength={40} placeholder="e.g. 3 or White" value={assignments[index]??''}
              onChange={event=>onAssign(index,event.target.value)}/></td>
          </tr>;
        })}</tbody>
      </table>
      <ListNavigation {...page}/>
      <p className="muted">Assignments are included in the export worksheet and companion files. Apply them on the machine; DST does not carry thread labels.</p>
    </dialog>
  </>;
}

type MappingPlan={stitches:number;blocks:Block[]};
const colorHex=(c:number[])=>'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
const colorRgb=(s:string)=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
export function ReferenceColorPanel({plan,busy,onApply}:{plan:MappingPlan;busy:boolean;onApply:(original:number[][],colors:number[][])=>Promise<unknown>}){
 const [url,setUrl]=useState(''),[colors,setColors]=useState(()=>plan.blocks.map(b=>colorHex(b.color))),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const request=useRef(0);
 useEffect(()=>{request.current++;setColors(plan.blocks.map(b=>colorHex(b.color)));setWorking(false)},[plan]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);
 const preview=useMemo(()=>colors.length===plan.blocks.length?thumbnailOf({...plan,blocks:plan.blocks.map((b,i)=>({...b,color:colorRgb(colors[i])}))}):'',[plan,colors]);
 async function suggest(source:string){
 const id=++request.current;setWorking(true);setError('');
 try{
 const image=new Image();image.src=source;await image.decode();
 const canvas=document.createElement('canvas'),scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
 const w=canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)),h=canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image sampling unavailable');ctx.drawImage(image,0,0,w,h);
 const pixels=ctx.getImageData(0,0,w,h).data;
 let l=w,t=h,r=-1,b=-1,x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>128){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}
 for(const block of plan.blocks)for(const run of block.runs)for(const [x,y] of run){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
 if(r<l||!Number.isFinite(x0))throw Error('Empty image or design');
 const next=plan.blocks.map(block=>{
 const bins=new Map<string,{count:number;sum:number[]}>();let j=0;const stride=Math.max(1,Math.ceil(block.runs.reduce((n,v)=>n+v.length,0)/3000));
 for(const run of block.runs)for(const [x,y] of run){if(j++%stride)continue;
 const px=Math.max(l,Math.min(r,Math.round(l+(x-x0)/Math.max(.001,x1-x0)*(r-l)))),py=Math.max(t,Math.min(b,Math.round(t+(y-y0)/Math.max(.001,y1-y0)*(b-t))));
 const k=(py*w+px)*4;if(pixels[k+3]<150)continue;
 const c=[pixels[k],pixels[k+1],pixels[k+2]],key=c.map(v=>v>>5).join(',');const bin=bins.get(key)||{count:0,sum:[0,0,0]};bin.count++;c.forEach((v,i)=>bin.sum[i]+=v);bins.set(key,bin)
 }
 const best=Array.from(bins.values()).sort((a,b)=>b.count-a.count)[0];return best?colorHex(best.sum.map(v=>Math.round(v/best.count))):colorHex(block.color)
 });
 if(id===request.current)setColors(next)
 }catch(e){if(id===request.current)setError(String(e))}finally{if(id===request.current)setWorking(false)}
 }
 return <section className="reference-colors"><h4>Match reference artwork</h4><p className="muted">Use a tightly cropped matching image. Review suggested thread colors before applying.</p><input aria-label="Reference artwork" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||working} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>20000000){setError('Choose an image under 20 MB');return}const u=URL.createObjectURL(f);setUrl(u);void suggest(u)}}/>
 {url&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}><div><img style={{width:'100%',height:90,objectFit:'contain'}} src={url} alt="Reference"/><small>Reference</small></div><div><img style={{width:'100%',height:90,objectFit:'contain'}} src={preview} alt="Mapped stitches"/><small>Mapped stitches</small></div></div><button disabled={busy||working} onClick={()=>void suggest(url)}>Suggest again</button></>}
 <details open={!!url}><summary>Review thread colors</summary>{plan.blocks.map((b,i)=><label key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>Block {i+1}<input type="color" aria-label={'Color for block '+(i+1)} disabled={busy||working} value={colors[i]??colorHex(b.color)} onChange={e=>setColors(old=>old.map((v,j)=>j===i?e.target.value:v))}/></label>)}</details>
 <button className="primary" disabled={busy||working||colors.length!==plan.blocks.length||colors.every((c,i)=>c===colorHex(plan.blocks[i].color))} onClick={()=>void onApply(plan.blocks.map(b=>b.color),colors.map(colorRgb))}>Apply reviewed colors</button>{working&&<small role="status">Sampling colors…</small>}{error&&<p role="alert">{error}</p>}</section>
}
