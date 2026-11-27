import {invoke} from '@tauri-apps/api/core';
import {Crosshair, ScanLine} from 'lucide-react';
import {useState} from 'react';
import {InspectorDialog} from './workspace-inspector';

export type NeedleCell = {x:number;y:number;n:number};
type StitchPlan = {stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type DensityPreview = {
  id:number;before:StitchPlan;after:StitchPlan;hits_before:number;hits_after:number;footprint_overlap:number;
};

export function StitchCrop({plan,view,label,cell}: {
  plan:StitchPlan;view:[number,number,number,number];label:string;cell?:NeedleCell;
}) {
  const [x,y,width,height]=view;
  return <svg role="img" aria-label={label} viewBox={view.join(' ')} className="density-repair-crop">
    {plan.blocks.map((block,index)=>{
      const segments:string[]=[];
      for(const run of block.runs)for(let i=1;i<run.length;i++){
        const [ax,ay]=run[i-1], [bx,by]=run[i];
        if(Math.max(ax,bx)>=x&&Math.min(ax,bx)<=x+width&&Math.max(ay,by)>=y&&Math.min(ay,by)<=y+height)
          segments.push(`M${ax} ${ay}L${bx} ${by}`);
      }
      return <path key={index} d={segments.join(' ')} stroke={'rgb('+block.color.join(',')+')'} strokeWidth=".23" strokeLinecap="round" fill="none"/>;
    })}
    {cell&&<rect x={cell.x} y={cell.y} width="1" height="1" fill="none" stroke="#8e57be" strokeWidth=".14"/>}
  </svg>;
}

export function DensityReview({cells,focus,objects,onLocate,onApply,disabled}:{
  cells:NeedleCell[];focus:NeedleCell|null;objects:{uid:number;label:string}[];
  onLocate:(cell:NeedleCell)=>void;onApply:(id:number)=>Promise<string|null>;disabled:boolean;
}) {
  return <div className="density-review">
    {cells.length===0?<p role="status">No cells reach the 24 needle points/mm² review threshold.</p>:<>
      <strong>Densest areas</strong>
      <div className="density-hotspots" role="group" aria-label="Density hotspots">
        {cells.slice(0,6).map((cell,index)=><button key={cell.x+','+cell.y} disabled={disabled}
          aria-label={`Locate hotspot ${index+1}, ${cell.n} needle points`} aria-pressed={focus?.x===cell.x&&focus.y===cell.y}
          onClick={()=>onLocate(cell)}><Crosshair size={14}/><span>{cell.n}</span></button>)}
      </div>
      {focus&&<div className="density-focus"><strong>{focus.n} needle points/mm²</strong>
        <small>{objects.length?objects.map(object=>object.label||'Object '+object.uid).join(', '):'No editable fill bounds intersect this cell.'}</small>
        {objects.length>0&&<InspectorDialog label={<><ScanLine size={15}/> Preview local repair</>} title="Local density repair" disabled={disabled}>
          <RepairComparison key={focus.x+','+focus.y} cell={focus} uids={objects.map(object=>object.uid)} disabled={disabled} onApply={onApply}/>
        </InspectorDialog>}
      </div>}
    </>}
  </div>;
}

function RepairComparison({cell,uids,disabled,onApply}:{
  cell:NeedleCell;uids:number[];disabled:boolean;onApply:(id:number)=>Promise<string|null>;
}) {
  const [preview,setPreview]=useState<DensityPreview|null>(null);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const [applied,setApplied]=useState(false);
  async function generate(){
    setWorking(true);setMessage('');
    try{setPreview(await invoke<DensityPreview>('preview_density_repair',{cell:[cell.x,cell.y],uids}));}
    catch(error){setMessage(String(error));}
    finally{setWorking(false)}
  }
  async function apply(){
    if(!preview||preview.hits_after>=preview.hits_before||working||disabled)return;
    setWorking(true);setMessage('');
    try{
      const error=await onApply(preview.id);
      if(error)setMessage(error);else{setPreview(null);setApplied(true);}
    }finally{setWorking(false)}
  }
  return <div className="density-comparison">
    <p>Compare the highlighted square millimeter after testing wider fill spacing on the nearby artwork.</p>
    {message&&<p role="status">{message}</p>}
    {applied&&<p role="status">Density repair applied. Undo is available.</p>}
    {!preview&&!applied&&<button className="primary" disabled={disabled||working} onClick={()=>void generate()}>{working?'Checking local density…':'Generate comparison'}</button>}
    {preview&&<>
      <div className="density-comparison-grid">{([
        ['Current',preview.before,preview.hits_before],['Proposed',preview.after,preview.hits_after],
      ] as const).map(([label,plan,hits])=><section key={label}>
        <h3>{label}</h3><StitchCrop plan={plan} cell={cell} view={[cell.x-6,cell.y-6,13,13]} label={label+' local stitch paths'}/>
        <dl className="inspector-diagnostics"><div><dt>Needle points in cell</dt><dd>{hits}</dd></div>
          <div><dt>Total stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd></div><div><dt>Trims</dt><dd>{plan.trims}</dd></div></dl>
      </section>)}</div>
      <p>Stitch footprint overlap across the design: {preview.footprint_overlap.toFixed(1)}%.</p>
      <p role="status">{preview.hits_after<preview.hits_before? `Local needle-point reduction: ${((preview.hits_before-preview.hits_after)/Math.max(1,preview.hits_before)*100).toFixed(1)}%. Check the proposed stitch paths for coverage before applying.`:'This candidate does not reduce the selected hotspot. Keep the original stitches.'}</p>
      <button className="primary" disabled={disabled||working||preview.hits_after>=preview.hits_before} onClick={()=>void apply()}>Apply previewed repair</button>
      <button disabled={working} onClick={()=>setPreview(null)}>Keep original</button>
    </>}
  </div>;
}
