import {Download, FileText, TriangleAlert, X} from 'lucide-react';
import {useEffect,useMemo,useRef,useState} from 'react';
import {MachineCommandPreview} from './machine-command-preview';
import './export-center.css';

type Plan={name:string;stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type Props={plan:Plan;width:number;height:number;format:string;setFormat:(s:string)=>void;machine:string;blocked:boolean;busy:boolean;onExport:()=>Promise<void>;onClose:()=>void};
const formats=['dst','pes','jef','exp','vp3','pec'];
const hex=(color:number[])=>'#'+color.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();

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

export function ExportCenter({plan,width,height,format,setFormat,machine,blocked,busy,onExport,onClose}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [speed,setSpeed]=useState('600');
  const [ack,setAck]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const dimensions=useMemo(()=>designSize(plan),[plan]);
  const sequence=useMemo(()=>plan.blocks.map(block=>({
    color:hex(block.color),points:block.runs.reduce((count,run)=>count+run.length,0)
  })),[plan]);
  const minutes=Math.ceil(plan.stitches/Math.min(1500,Math.max(100,Number(speed)||600)));

  function worksheet() {
    const rows=sequence.map(({color,points},index)=>`<tr><td>${index+1}</td><td><span style="background:${color}"></span> ${color}</td><td>${points}</td></tr>`).join('');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embroidery worksheet</title>
      <style>body{font:16px system-ui;margin:40px;color:#302842}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ccc;text-align:left}td span{display:inline-block;width:20px;height:20px;border:1px solid #777;vertical-align:middle}@media print{body{margin:12mm}*{print-color-adjust:exact}}</style></head>
      <body><h1>${escapeHtml(plan.name)}</h1><h2>Embroidery worksheet</h2><p>${escapeHtml(machine||'Manual setup')} · ${escapeHtml(format.toUpperCase())}</p>
      <p>Design ${dimensions} · Hoop ${width} × ${height} mm</p><p>${plan.stitches} planned stitches · ${plan.trims} trims · About ${minutes} min needle time</p>
      <table><thead><tr><th>Sequence</th><th>Approximate color</th><th>Planned points</th></tr></thead><tbody>${rows}</tbody></table>
      <p>Verify physical spool labels and test sew before production.</p></body></html>`;
    const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='embroidery-worksheet.html';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  return <dialog ref={dialog} className="studio-modal export-dialog" aria-label="Export review"
    onClose={event=>{if(event.target===event.currentTarget)onClose();}}
    onCancel={event=>{if(busy)event.preventDefault();}}>
    <header className="export-review-header">
      <div><h2>Export design</h2><p title={plan.name}>{plan.name} <span>· {machine||'Manual machine setup'}</span></p></div>
      <button title="Close export review" aria-label="Close export review" onClick={onClose} disabled={busy}><X size={18} aria-hidden="true"/></button>
    </header>
    <div className="export-review-body">
      <section className="export-review-settings" aria-label="Machine settings">
        <h3>Machine setup</h3>
        <fieldset className="export-format">
          <legend>Machine format</legend>
          {formats.map(option=><button key={option} aria-pressed={option===format} disabled={busy}
            onClick={()=>{setFormat(option);setAck(false);}}>{option.toUpperCase()}</button>)}
        </fieldset>
        <dl className="export-review-metrics">
          <div><dt>Design</dt><dd>{dimensions}</dd></div>
          <div><dt>Hoop</dt><dd>{width} × {height} mm</dd></div>
          <div><dt>Stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd></div>
          <div><dt>Planned trims</dt><dd>{plan.trims.toLocaleString()}</dd></div>
        </dl>
        <label className="export-speed">Machine speed (stitches/min)
          <input type="number" min="100" max="1500" value={speed} disabled={busy}
            onChange={event=>setSpeed(event.target.value)}
            onBlur={()=>setSpeed(String(Math.min(1500,Math.max(100,Number(speed)||600))))}/>
        </label>
        <p className="export-needle-time">About <strong>{minutes} min</strong> needle time · Excludes stops and travel</p>
        {blocked&&<p role="alert" className="export-alert"><TriangleAlert size={16}/> Check hoop and machine dimensions to export.</p>}
        {plan.trims>50&&<p className="export-alert"><TriangleAlert size={16}/> Review the high trim count before sewing.</p>}
        <MachineCommandPreview format={format} width={width} height={height} disabled={busy||blocked}/>
      </section>
      <section className="export-review-threads" aria-label="Thread sequence">
        <div className="export-thread-heading"><h3>Thread sequence</h3><small>{sequence.length} color blocks</small></div>
        {format==='dst'&&<p className="muted">Match the numbered swatches on your machine. DST stores color changes without exact thread colors.</p>}
        <ol className="export-thread-cards">
          {sequence.map(({color,points},index)=><li key={index}>
            <span className="export-thread-number" aria-label={`Block ${index+1}`}>{index+1}</span>
            <span className="export-thread-swatch" style={{backgroundColor:color}} aria-hidden="true"/>
            <div><strong>{color}</strong><small>{points.toLocaleString()} points</small></div>
          </li>)}
        </ol>
      </section>
    </div>
    <footer className="export-review-footer">
      <label><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/> Reviewed and ready for a test sew</label>
      <div>
        <button onClick={worksheet}><FileText size={16} aria-hidden="true"/> Save printable worksheet</button>
        <button className="primary" disabled={blocked||busy||!ack} onClick={()=>void onExport()}>
          <Download size={16} aria-hidden="true"/>{busy?'Saving…':'Save embroidery file'}
        </button>
      </div>
    </footer>
  </dialog>;
}
