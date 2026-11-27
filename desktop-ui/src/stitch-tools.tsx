import {useEffect,useState,useMemo} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {InspectorDialog} from './workspace-inspector';

type Issue = {uid:number|null;label:string|null;severity:'info'|'warning'|'error';message:string};
type Hoop = {width:number;height:number};
type PathOperation = {kind:'unite'|'minus_front'|'intersect'|'exclude'|'outline_stroke'|'join_open_paths'} |
  {kind:'offset'|'round_corners'|'simplify_outline'|'smooth_path';millimeters:number};

function IssueList({width,height,onLocate,revision,scan}:{width:number;height:number;onLocate:(uid:number)=>void;revision?:unknown;scan?:number}) {
  const [issues,setIssues]=useState<Issue[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;setIssues(null);setError('');
    invoke<Issue[]>('design_issues',{width,height}).then(result=>{
      if(active)setIssues(result);
    }).catch(error=>{if(active)setError(String(error));});
    return ()=>{active=false;};
  },[width,height,revision,scan]);
  if(error)return <p role="alert">{error}</p>;
  if(issues===null)return <p role="status">Checking the current stitch plan…</p>;
  if(!issues.length)return <p role="status">No issues found in this check.</p>;
  return <ul className="stitch-tools-issues">{issues.map((issue,index)=>
    <li key={index}>
      <strong>{issue.severity==='info'?'Note':issue.severity==='error'?'Error':'Warning'}</strong>
      <span>{issue.message}</span>
      {issue.uid!==null&&<button onClick={event=>{
        onLocate(issue.uid!);
        event.currentTarget.closest('dialog')?.close();
      }}>Locate {issue.label||'object'}</button>}
    </li>
  )}</ul>;
}

type RepairPlan={stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type RepairReview={before:RepairPlan;after:RepairPlan;warnings_before:number;warnings_after:number;lettering_before:number;lettering_after:number};
export function QualityInspector({width,height,revision,onLocate,onRepair,disabled}:{width:number;height:number;revision:unknown;onLocate:(uid:number)=>void;onRepair:()=>void;disabled:boolean}){
  const [scan,setScan]=useState(0);
  const [review,setReview]=useState<{revision:unknown;result:RepairReview}|null>(null);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const current=review && review.revision===revision ? review.result : null;
  const comparisonPaths=useMemo(()=>current?[current.before,current.after].map(p=>p.blocks.map(b=>({color:'rgb('+b.color.join(',')+')',runs:b.runs.map(r=>r.map(point=>point.join(',')).join(' '))}))):[],[current]);
  const [sewout,setSewout]=useState(true);
  const [previewWidth,setPreviewWidth]=useState(.40);
  const [detailZoom,setDetailZoom]=useState(1);
  const [detailX,setDetailX]=useState(0);
  const [detailY,setDetailY]=useState(0);
  const view=[detailX-width/(2*detailZoom),detailY-height/(2*detailZoom),width/detailZoom,height/detailZoom].join(' ');

  const speed=Math.max(100,Math.min(1500,Number(localStorage.getItem('studio-sewing-spm'))||800));
  const trimRaw=Number(localStorage.getItem('studio-trim-seconds')??3);
  const changeRaw=Number(localStorage.getItem('studio-change-seconds')??8);
  const estimate=(p:RepairPlan)=>p.stitches/speed+p.trims*(Number.isFinite(trimRaw)?Math.max(0,trimRaw):3)/60+Math.max(0,p.blocks.length-1)*(Number.isFinite(changeRaw)?Math.max(0,changeRaw):8)/60;

  async function inspectRepair(){
    setWorking(true);setMessage('');setReview(null);
    try{const result=await invoke<RepairReview>('preview_coverage_repair');setReview({revision,result});}
    catch(e){setMessage(String(e));}finally{setWorking(false);}
  }
  return <section className="workspace-inspector-group quality-inspector">
    <h3>Quality Inspector</h3>
    <small>Coverage, density, stitch lengths and hoop safety. Test sew before production.</small>
    <div className="inspector-actions"><button disabled={disabled||working} onClick={()=>setScan(n=>n+1)}>Refresh inspection</button><button disabled={disabled||working} onClick={()=>void inspectRepair()}>{working?'Checking repairs…':'Preview quality fix'}</button></div>
    {message&&<p role="status">{message}</p>}
    {current&&<div className="workspace-stack">
      <strong>Proposed quality repair</strong>
      <div className="inspector-actions"><button aria-pressed={sewout} onClick={()=>setSewout(true)}>Sew-out</button><button aria-pressed={!sewout} onClick={()=>setSewout(false)}>Stitch paths</button></div>
      <label>Comparison zoom · {detailZoom}×<input type="range" min="1" max="8" step="1" value={detailZoom} onChange={e=>{setDetailZoom(Number(e.target.value));setDetailX(0);setDetailY(0)}}/></label>
      {detailZoom>1&&<><label>Horizontal position<input type="range" min={-width/2+width/(2*detailZoom)} max={width/2-width/(2*detailZoom)} step=".5" value={detailX} onChange={e=>setDetailX(Number(e.target.value))}/></label><label>Vertical position<input type="range" min={-height/2+height/(2*detailZoom)} max={height/2-height/(2*detailZoom)} step=".5" value={detailY} onChange={e=>setDetailY(Number(e.target.value))}/></label></>}
      <button onClick={()=>{setDetailZoom(1);setDetailX(0);setDetailY(0)}} disabled={detailZoom===1&&detailX===0&&detailY===0}>Fit comparison to hoop</button>
      {sewout&&<label>Visual thread width · {previewWidth.toFixed(2)} mm<input type="range" min=".15" max=".60" step=".05" value={previewWidth} onChange={e=>setPreviewWidth(Number(e.target.value))}/></label>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:6}}>{[current.before,current.after].map((p,i)=><div key={i}><small>{i?'Repaired':'Original'}</small><svg viewBox={view} style={{width:'100%',background:'#faf7f0'}} aria-label={i?'Repaired stitch preview':'Original stitch preview'}>{p.blocks.map((b,j)=><g key={j} fill="none" strokeLinecap="round" strokeLinejoin="round">{b.runs.map((_r,k)=>{const points=comparisonPaths[i][j].runs[k];if(!points)return null;const color=comparisonPaths[i][j].color;return sewout?<g key={k}><polyline points={points} stroke="#211b17" opacity=".28" strokeWidth={previewWidth*1.18} transform="translate(.045 .065)"/><polyline points={points} stroke={color} strokeWidth={previewWidth}/><polyline points={points} stroke="white" opacity=".24" strokeWidth={previewWidth*.27} transform={`translate(${-previewWidth*.18} ${-previewWidth*.18})`}/></g>:<polyline key={k} points={points} stroke={color} strokeWidth=".12"/>})}</g>)}</svg><small>{p.stitches.toLocaleString()} points · {p.trims} trims</small></div>)}</div>
      <small>Both previews share the same zoom, position and visual thread width. This is a rendering estimate, not a physical sew-out.</small>
      <small>Flagged coverage objects: {current.warnings_before} → {current.warnings_after}</small>
      <small>Lettering consistency warnings: {current.lettering_before} → {current.lettering_after}</small>
      <small>Estimated sewing time: {estimate(current.before).toFixed(1)} → {estimate(current.after).toFixed(1)} min</small>
      <small>Stitch change: {((current.after.stitches-current.before.stitches)/Math.max(1,current.before.stitches)*100).toFixed(1)}% · {speed} points/min</small>
      <button disabled={disabled||working} onClick={()=>{setReview(null);onRepair()}}>Apply quality repair</button><button onClick={()=>setReview(null)}>Keep original</button>
      <small>Apply recalculates the repair for the current design. Undo is available.</small>
    </div>}
    <button disabled={disabled||working} onClick={onRepair}>Try general repair</button>
    <IssueList width={width} height={height} onLocate={onLocate} revision={revision} scan={scan}/>
  </section>;
}

export function DesignIssuesDialog({width,height,disabled,onLocate}:Hoop&{disabled:boolean;onLocate:(uid:number)=>void}) {
  return <InspectorDialog label="Design issues" title="Design issues" disabled={disabled}>
    <IssueList width={width} height={height} onLocate={onLocate}/>
  </InspectorDialog>;
}

export function PathToolsDialog({count,disabled,onApply}:{
  count:number;disabled:boolean;onApply:(operation:PathOperation)=>Promise<string|null>;
}) {
  return <InspectorDialog label="Path tools" title="Path tools" disabled={disabled}>
    <PathControls count={count} disabled={disabled} onApply={onApply}/>
  </InspectorDialog>;
}

function PathControls({count,disabled,onApply}:{
  count:number;disabled:boolean;onApply:(operation:PathOperation)=>Promise<string|null>;
}) {
  const [offset,setOffset]=useState(1);
  const [radius,setRadius]=useState(1);
  const [tolerance,setTolerance]=useState(.1);
  const [message,setMessage]=useState('');
  async function apply(operation:PathOperation) {
    setMessage('');
    const error=await onApply(operation);
    setMessage(error??'Path updated. Use Undo to restore the previous artwork.');
  }
  const operations=[
    ['Unite','unite'],['Subtract front','minus_front'],['Intersect','intersect'],['Exclude overlap','exclude'],
  ] as const;
  return <div className="stitch-tools-controls">
    <p>Combine selected shapes, or make an outline or offset from one object.</p>
    <div className="inspector-actions">{operations.map(([label,kind])=>
      <button key={kind} disabled={disabled||count<2} onClick={()=>void apply({kind})}>{label}</button>
    )}</div>
    <button disabled={disabled||count!==2} title="Join the nearest ends of two matching open running paths"
      onClick={()=>void apply({kind:'join_open_paths'})}>Join nearest open ends</button>
    {count<2&&<small>Select at least two objects to combine them.</small>}
    <button disabled={disabled} onClick={()=>void apply({kind:'outline_stroke'})}>Outline stroke</button>
    <label>Offset (mm)<input type="number" min="-20" max="20" step=".1" value={offset}
      onChange={event=>setOffset(Number(event.target.value))}/></label>
    <button disabled={disabled||!offset||Math.abs(offset)<.1||Math.abs(offset)>20}
      onClick={()=>void apply({kind:'offset',millimeters:offset})}>Add offset path</button>
    <label>Corner radius (mm)<input type="number" min=".1" max="15" step=".1" value={radius}
      onChange={event=>setRadius(Number(event.target.value))}/></label>
    <button disabled={disabled||radius<.1||radius>15}
      onClick={()=>void apply({kind:'round_corners',millimeters:radius})}>Round corners</button>
    <label>Outline tolerance (mm)<input type="number" min=".02" max=".5" step=".01" value={tolerance}
      onChange={event=>setTolerance(Number(event.target.value))}/></label>
    <button disabled={disabled||tolerance<.02||tolerance>.5}
      onClick={()=>void apply({kind:'simplify_outline',millimeters:tolerance})}>Simplify outline</button>
    <button disabled={disabled||tolerance<.02||tolerance>.5}
      onClick={()=>void apply({kind:'smooth_path',millimeters:tolerance})}>Smooth paths</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}

const settings = [
  {key:'spacing',name:'Row spacing',unit:'mm',from:.32,to:.48,min:.1,max:2,kinds:['fill','satin','contour']},
  {key:'length',name:'Stitch length',unit:'mm',from:2,to:4,min:.5,max:10,kinds:['fill','run','contour']},
  {key:'pull',name:'Pull compensation',unit:'mm',from:0,to:.4,min:0,max:1,kinds:['fill','satin']},
  {key:'width',name:'Satin width',unit:'mm',from:2,to:4,min:.3,max:15,kinds:['satin']},
  {key:'angle',name:'Fill angle',unit:'°',from:0,to:90,min:0,max:360,kinds:['fill']},
] as const;
type Sheet = {revision:string;width:number;height:number;values:number[];plan:{
  stitches:number;blocks:{color:number[];runs:number[][][]}[];
}};
type SwatchProps = Hoop&{format:string;uid:number;kind:string;blocked:boolean};

export function TestSwatchesDialog({width,height,format,object,disabled,blocked}:Hoop&{
  format:string;object:{uid:number;kind:string}|null;disabled:boolean;blocked:boolean;
}) {
  return <InspectorDialog label="Test swatches" title="Test swatches" disabled={disabled||!object}>
    {object&&<Swatches key={object.uid} width={width} height={height} format={format}
      uid={object.uid} kind={object.kind} blocked={blocked}/>}
  </InspectorDialog>;
}

function Swatches({uid,kind,width,height,format,blocked}:SwatchProps) {
  const choices=settings.filter(setting=>setting.kinds.some(value=>value===kind));
  const [choice,setChoice]=useState(choices[0]??settings[0]);
  const [from,setFrom]=useState<number>(choice.from);
  const [to,setTo]=useState<number>(choice.to);
  const [steps,setSteps]=useState(3);
  const [columns,setColumns]=useState(3);
  const [sheet,setSheet]=useState<Sheet|null>(null);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const request={uid,setting:choice.key,from,to,steps,columns:Math.min(steps,columns)};
  const fits=!!sheet&&sheet.width<=width&&sheet.height<=height&&!blocked;
  const canBuild=from<to&&from>=choice.min&&to<=choice.max&&Number.isInteger(steps)&&steps>=2&&steps<=6&&Number.isInteger(columns)&&columns>=1;
  function draftChanged(){setSheet(null);setMessage('');}
  async function generate(){
    setWorking(true);setMessage('');
    try{setSheet(await invoke<Sheet>('preview_test_swatches',{request}));}
    catch(error){setSheet(null);setMessage(String(error));}
    finally{setWorking(false);}
  }
  async function save(){
    if(!sheet||!fits)return;
    setWorking(true);setMessage('');
    try{
      if(await invoke<boolean>('export_test_swatches',{request,revision:sheet.revision,width,height,format})){
        setMessage('Test swatch file saved.');
      }
    }catch(error){setMessage(String(error));}finally{setWorking(false);}
  }
  if(!choices.length)return <p>Select a fill, satin, running stitch or contour object to make a test sheet.</p>;
  return <div className="stitch-tools-controls">
    <p>Sew labeled copies of this object with different settings. Export the test sheet as a separate file.</p>
    <fieldset className="inspector-fields" disabled={working}>
      <label>Setting<select value={choice.key} onChange={event=>{
        const next=choices.find(value=>value.key===event.target.value);
        if(next){setChoice(next);setFrom(next.from);setTo(next.to);draftChanged();}
      }}>{choices.map(setting=><option key={setting.key} value={setting.key}>{setting.name}</option>)}</select></label>
      <label>From ({choice.unit})<input type="number" step={choice.unit==='°'?1:.01} min={choice.min} max={choice.max} value={from} onChange={event=>{setFrom(Number(event.target.value));draftChanged();}}/></label>
      <label>To ({choice.unit})<input type="number" step={choice.unit==='°'?1:.01} min={choice.min} max={choice.max} value={to} onChange={event=>{setTo(Number(event.target.value));draftChanged();}}/></label>
      <label>Swatches<input type="number" min="2" max="6" step="1" value={steps} onChange={event=>{setSteps(Number(event.target.value));draftChanged();}}/></label>
      <label>Columns<input type="number" min="1" max="6" step="1" value={columns} onChange={event=>{setColumns(Number(event.target.value));draftChanged();}}/></label>
    </fieldset>
    <button disabled={working||!canBuild} onClick={()=>void generate()}>Preview swatches</button>
    {sheet&&<>
      <svg className="swatch-preview" role="img" aria-label="Test sheet stitch preview"
        viewBox={[-sheet.width/2-2,-sheet.height/2-2,sheet.width+4,sheet.height+4].join(' ')}>
        {sheet.plan.blocks.map((block,index)=><g key={index} fill="none" stroke={'rgb('+block.color.join(',')+')'} strokeWidth=".3">
          {block.runs.map((run,index)=><polyline key={index} points={run.map(point=>point.join(',')).join(' ')}/>)}
        </g>)}
      </svg>
      <p>{sheet.values.map(value=>value+choice.unit).join(' · ')}<br/>{sheet.width.toFixed(1)} × {sheet.height.toFixed(1)} mm · {sheet.plan.stitches.toLocaleString()} stitches</p>
      {!fits&&<p role="status">The swatches need a compatible hoop. Try fewer columns, fewer copies, or a smaller object.</p>}
      <button className="primary" disabled={working||!fits} onClick={()=>void save()}>Save {format.toUpperCase()} test sheet</button>
    </>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
