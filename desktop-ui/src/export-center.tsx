import {Download, FileText, TriangleAlert, X, Image, FolderOpen, Settings, ClipboardCheck} from 'lucide-react';
import {useEffect,useMemo,useRef,useState} from 'react';

import type {ThreadAssignments} from './thread-order';
import {MachineCommandPreview} from './machine-command-preview';
import './export-center.css';

type Plan={name:string;stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type Props={assignments:ThreadAssignments;plan:Plan;width:number;height:number;format:string;setFormat:(s:string)=>void;machine:string;blocked:boolean;busy:boolean;onExport:(companions:boolean,images?:{sheet?:number[];preview?:number[]})=>Promise<void>;onClose:()=>void};
const formats=['dst','pes','jef','exp','vp3','pec'];
const hex=(color:number[])=>'#'+color.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();

const sewOutChecks=[
  ['Thread mapping','Match each numbered block to the physical spool or needle on the machine. Check repeated colors in sequence.'],
  ['Placement','Run the machine’s positioning check on the intended hoop and a scrap of the production fabric.'],
  ['Puffy lettering','Use a small foam sample. Check sealing stitches, exposed foam at the ends, and even coverage across letters.'],
  ['Appliqué','Verify the placement stitch and the pause before tack-down. Confirm the machine pauses where you can place or trim fabric.'],
] as const;

function designSize(plan:Plan) {
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for(const block of plan.blocks)for(const run of block.runs)for(const [x,y] of run){
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
  }
  return Number.isFinite(left)?`${(right-left).toFixed(1)} × ${(bottom-top).toFixed(1)} mm`:'—';
}

function escapeHtml(value:string) {
  const entities:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return value.replace(/[&<>"']/g,character=>entities[character]);
}

function renderPreview(plan:Plan):HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=900;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f8f5ef';ctx.fillRect(0,0,1200,900);
  let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
  for(const block of plan.blocks)for(const run of block.runs)for(const [x,y] of run){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}
  if(!Number.isFinite(l))return canvas;
  const scale=Math.min(1080/Math.max(1,r-l),780/Math.max(1,b-t));ctx.translate(600-(l+r)/2*scale,450-(t+b)/2*scale);ctx.scale(scale,scale);
  ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=.28;
  for(const block of plan.blocks){ctx.strokeStyle=hex(block.color);ctx.beginPath();for(const run of block.runs)run.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke()}
  return canvas;
}
function renderSheet(plan:Plan,assignments:ThreadAssignments,format:string,machine:string,width:number,height:number,preview:HTMLCanvasElement):HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=790+plan.blocks.length*54;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#754bb0';ctx.fillRect(0,0,1400,105);ctx.fillStyle='#fff';ctx.font='bold 38px sans-serif';ctx.fillText('Stitch Studio',48,66);ctx.font='28px sans-serif';ctx.textAlign='right';ctx.fillText('Color Sequence Sheet',1352,66);ctx.textAlign='left';
  ctx.fillStyle='#28213a';ctx.font='bold 30px sans-serif';ctx.fillText(plan.name,48,151,1304);ctx.font='24px sans-serif';ctx.fillText(format.toUpperCase()+' · '+(machine||'Manual setup')+' · '+plan.stitches.toLocaleString()+' points',48,191,1304);ctx.fillText('Hoop '+width+' × '+height+' mm · '+plan.blocks.length+' color blocks',48,226);
  ctx.drawImage(preview,400,246,600,450);
  const y=710;ctx.fillStyle='#eee6fa';ctx.fillRect(48,y,1304,48);ctx.fillStyle='#28213a';ctx.font='bold 23px sans-serif';
  for(const [label,x] of [['Block',64],['Color',170],['Thread / needle / spool',430],['Points',1170]] as const)ctx.fillText(label,x,y+31);
  plan.blocks.forEach((block,i)=>{const row=y+48+i*54;ctx.fillStyle=i%2?'#faf7ff':'#fff';ctx.fillRect(48,row,1304,54);ctx.fillStyle=hex(block.color);ctx.fillRect(170,row+10,42,32);ctx.strokeStyle='#999';ctx.strokeRect(170,row+10,42,32);ctx.fillStyle='#28213a';ctx.font='23px sans-serif';ctx.fillText(String(i+1),64,row+35);ctx.fillText(hex(block.color),230,row+35);ctx.fillText(assignments[i]||'Not assigned',430,row+35,710);ctx.fillText(block.runs.reduce((n,r)=>n+r.length,0).toLocaleString(),1170,row+35);});
  ctx.font='18px sans-serif';ctx.fillText(format==='dst'?'DST: assign physical threads manually. Verify placement and test sew.':'Verify thread assignments and test sew.',48,canvas.height-10,1304);
  return canvas;
}
async function pngBytes(canvas:HTMLCanvasElement):Promise<number[]> {const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed')),'image/png'));return Array.from(new Uint8Array(await blob.arrayBuffer()))}

export function ExportCenter({assignments,plan,width,height,format,setFormat,machine,blocked,busy,onExport,onClose}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [speed,setSpeed]=useState('600');
  const [ack,setAck]=useState(false);
  const [companions,setCompanions]=useState(true);
  const [includeSheet,setIncludeSheet]=useState(true),[includePreview,setIncludePreview]=useState(true);
  const [exportError,setExportError]=useState('');
  const [encoding,setEncoding]=useState(false);
  const exportLock=useRef(false);
  const preview=useMemo(()=>renderPreview(plan),[plan]);
  const image=useMemo(()=>preview.toDataURL('image/png'),[preview]);
  const sheet=useMemo(()=>renderSheet(plan,assignments,format,machine,width,height,preview),[plan,assignments,format,machine,width,height,preview]);
  const sheetImage=useMemo(()=>sheet.toDataURL('image/png'),[sheet]);
  async function exportPackage(){if(exportLock.current)return;exportLock.current=true;setEncoding(true);try{setExportError('');await onExport(companions,{sheet:includeSheet?await pngBytes(sheet):undefined,preview:includePreview?await pngBytes(preview):undefined})}catch(e){setExportError(String(e))}finally{exportLock.current=false;setEncoding(false)}}
  useEffect(()=>{dialog.current?.showModal();},[]);
  const dimensions=useMemo(()=>designSize(plan),[plan]);
  const sequence=useMemo(()=>plan.blocks.map(block=>({
    color:hex(block.color),points:block.runs.reduce((count,run)=>count+run.length,0)
  })),[plan]);
  const poolin=/poolin/i.test(machine);
  const missingAssignments=sequence.filter((_,index)=>!assignments[index]?.trim()).length;
  const minutes=Math.ceil(plan.stitches/Math.min(1500,Math.max(100,Number(speed)||600)));

  function worksheet() {
    const rows=sequence.map(({color,points},index)=>`<tr><td>${index+1}</td><td><span style="background:${color}"></span> ${color}</td><td>${escapeHtml(assignments[index]||'Not assigned')}</td><td>${points}</td></tr>`).join('');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embroidery worksheet</title>
      <style>body{font:16px system-ui;margin:40px;color:#302842}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ccc;text-align:left}td span{display:inline-block;width:20px;height:20px;border:1px solid #777;vertical-align:middle}@media print{body{margin:12mm}*{print-color-adjust:exact}}</style></head>
      <body><h1>${escapeHtml(plan.name)}</h1><h2>Embroidery worksheet</h2><p>${escapeHtml(machine||'Manual setup')} · ${escapeHtml(format.toUpperCase())}</p>
      <p>Design ${dimensions} · Hoop ${width} × ${height} mm</p><p>${plan.stitches} planned stitches · ${plan.trims} trims · About ${minutes} min needle time</p>
      <img src="${image}" alt="Design stitch preview" style="max-width:320px"/><table><thead><tr><th>Sequence</th><th>Approximate color</th><th>Needle / spool</th><th>Planned points</th></tr></thead><tbody>${rows}</tbody></table>
      <p>${format==='dst'?'DST stores color-change positions only. Assign the listed spools on your machine. ':''}Verify physical spool labels and test sew before production.</p>
      <h2>${poolin?'Poolin EOM ':''}Test sew</h2><ol>${sewOutChecks.map(([label,detail])=>`<li><strong>${label}</strong> — ${detail}</li>`).join('')}</ol>
      <p>Machine / firmware: ____________________ &nbsp; Fabric / stabilizer: ____________________</p>
      <p>Actual stops, thread mapping and sample notes: _______________________________________</p></body></html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=poolin?'poolin-sew-out-worksheet.html':'embroidery-worksheet.html';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  return <dialog ref={dialog} className="studio-modal export-dialog" aria-label="Export review"
    onClose={event=>{if(event.target===event.currentTarget)onClose();}}
    onCancel={event=>{if(busy||encoding)event.preventDefault();}}>
    <header className="export-review-header">
      <div><h2>Export Design Package</h2><p title={plan.name}>{plan.name} <span>· {machine||'Manual machine setup'}</span></p></div>
      <button title="Close export review" aria-label="Close export review" onClick={onClose} disabled={busy||encoding}><X size={18} aria-hidden="true"/></button>
    </header>
    <div className="export-review-body">
      <div className="package-left"><section className="export-review-settings" aria-label="Machine settings">
        <h3>Machine file</h3>
        <fieldset className="export-format">
          <legend>Machine format</legend>
          {formats.map(option=><button key={option} aria-pressed={option===format} disabled={busy||encoding}
            onClick={()=>{setFormat(option);setAck(false);}}>{option.toUpperCase()}</button>)}
        </fieldset>
        {format==='dst'&&<p className="package-notice">DST stores color-change positions, not exact thread colors. Include a color sequence sheet for machine setup.</p>}<div className="package-options"><label><input type="checkbox" checked={includeSheet} onChange={e=>setIncludeSheet(e.target.checked)}/> Color sequence PNG</label><label><input type="checkbox" checked={includePreview} onChange={e=>setIncludePreview(e.target.checked)}/> Design preview PNG</label></div><details className="package-settings"><summary><Settings size={15}/> Export settings</summary><dl className="export-review-metrics">
          <div><dt>Design</dt><dd>{dimensions}</dd></div>
          <div><dt>Hoop</dt><dd>{width} × {height} mm</dd></div>
          <div><dt>Stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd></div>
          <div><dt>Planned trims</dt><dd>{plan.trims.toLocaleString()}</dd></div>
        </dl>
        <label className="export-speed">Machine speed (stitches/min)
          <input type="number" min="100" max="1500" value={speed} disabled={busy||encoding}
            onChange={event=>setSpeed(event.target.value)}
            onBlur={()=>setSpeed(String(Math.min(1500,Math.max(100,Number(speed)||600))))}/>
        </label>
        <p className="export-needle-time">About <strong>{minutes} min</strong> needle time · Excludes stops and travel</p>
        {blocked&&<p role="alert" className="export-alert"><TriangleAlert size={16}/> Check hoop and machine dimensions to export.</p>}
        {plan.trims>50&&<p className="export-alert"><TriangleAlert size={16}/> Review the high trim count before sewing.</p>}
        <MachineCommandPreview format={format} width={width} height={height} disabled={busy||blocked}/></details>
      </section>
      <details className="package-settings production-checks" open={poolin||undefined}>
        <summary><ClipboardCheck size={16}/> {poolin?'Poolin sew-out checks':'Sew-out checks'}</summary>
        {missingAssignments>0&&<p className="package-notice">{missingAssignments} of {sequence.length} blocks have no spool or needle assignment.</p>}
        <dl>{sewOutChecks.map(([label,detail])=><div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
        <button type="button" onClick={worksheet}><FileText size={15}/> Save sew-out checklist</button>
      </details>
      <section className="export-review-threads" aria-label="Thread sequence">
        <div className="export-thread-heading"><h3>Thread sequence</h3><small>{sequence.length} color blocks</small></div>
        {format==='dst'&&<p className="muted">Match the numbered swatches on your machine. DST stores color changes without exact thread colors.</p>}
        <div className="package-sequence"><img src={image} alt="Design stitch preview"/><ol className="export-thread-cards">
          {sequence.map(({color,points},index)=><li key={index}>
            <span className="export-thread-number" aria-label={`Block ${index+1}`}>{index+1}</span>
            <span className="export-thread-swatch" style={{backgroundColor:color}} aria-hidden="true"/>
            <div><strong>{color}</strong>{assignments[index]&&<small>{assignments[index]}</small>}<small>{points.toLocaleString()} points</small></div>
          </li>)}
        </ol></div>
      </section><section className="package-files"><h3><FolderOpen size={17}/> Companion files</h3><div><span><FileText size={16}/> .{format}</span>{includeSheet&&<span><Image size={16}/> .colors.png</span>}{includePreview&&<span><Image size={16}/> .preview.png</span>}{companions&&<span><FileText size={16}/> .colors.html + .preview.svg</span>}</div></section></div><section className="package-sheet"><h3>Color sequence sheet (preview)</h3><p>Printable reference for the design and thread order.</p><div className="package-proof-scroll" tabIndex={0} aria-label="Scrollable color sequence proof"><img src={sheetImage} alt="Color sequence sheet with design preview and all thread assignments"/></div></section>
    </div>
    <footer className="export-review-footer">
      <label><input type="checkbox" checked={ack} disabled={busy||encoding} onChange={event=>setAck(event.target.checked)}/> Reviewed and ready for a test sew</label>
      <div>
        {exportError&&<p role="alert">{exportError}</p>}<label><input type="checkbox" checked={companions} disabled={busy||encoding} onChange={e=>setCompanions(e.target.checked)}/> Also include HTML and SVG</label><button onClick={worksheet}><FileText size={16} aria-hidden="true"/> Save printable worksheet</button>
        <button className="primary" disabled={blocked||busy||encoding||!ack} onClick={()=>void exportPackage()}>
          <Download size={16} aria-hidden="true"/>{encoding?'Preparing package…':busy?'Saving…':'Export package'}
        </button>
      </div>
    </footer>
  </dialog>;
}
