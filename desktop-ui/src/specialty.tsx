import { ArrowUpRight, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirmAction, toast } from './dialogs';
import './specialty.css';

type StitchPlan={stitches:number;blocks:{color:number[];runs:number[][][]}[]};
const shapes = [
  ['circle', 'Circle', 'M50 5 A45 45 0 0 1 50 95 A45 45 0 0 1 50 5 Z'],
  ['shield', 'Shield', 'M10 10 H90 V48 Q90 75 50 95 Q10 75 10 48 Z'],
  ['heart', 'Heart', 'M50 90 C-20 45 10 -10 50 25 C90 -10 120 45 50 90 Z'],
  ['rounded', 'Rounded square', 'M15 5 H85 Q95 5 95 15 V85 Q95 95 85 95 H15 Q5 95 5 85 V15 Q5 5 15 5 Z'],
] as const;

const appliqueSequence = [
  ['Placement', 'Stitch the outline on the base fabric.'],
  ['Tack-down', 'At the first stop, place the fabric and stitch it down.'],
  ['Finishing border', 'At the next stop, trim excess fabric if needed, then sew the border.'],
] as const;

const patchSequence = [
  ['Backing', 'Hoop backing suitable for the patch.'],
  ['Fill and border', 'Preview the fill and check edge coverage on a test sew.'],
  ['Finish', 'Finish or cut the patch using a suitable method.'],
] as const;

export function AppliqueLettering({onDone}:{onDone:()=>void}){
 const [text,setText]=useState('ABC'),[style,setStyle]=useState('block'),[height,setHeight]=useState('2'),[color,setColor]=useState('#754bb0'),[plan,setPlan]=useState<StitchPlan|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const mm=Number(height)*25.4,valid=/^[A-Za-z ]{1,16}$/.test(text)&&!!text.trim()&&mm>=20&&mm<=100;
 const settings={text,style,height:mm,color:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))};
 useEffect(()=>{let active=true;setPlan(null);setError('');if(!valid)return;const timer=setTimeout(()=>{invoke<StitchPlan>('preview_applique_letters',settings).then(p=>{if(active)setPlan(p)}).catch(e=>{if(active)setError(String(e))})},200);return()=>{active=false;clearTimeout(timer)}},[text,style,height,color,valid]);
 let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;for(const block of plan?.blocks??[])for(const run of block.runs)for(const [x,y] of run){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}
 const box=Number.isFinite(l)?[l-3,t-3,r-l+6,b-t+6].join(' '):'0 0 100 100';
 async function insert(){if(busy||!valid||!plan)return;setBusy(true);setError('');try{await invoke('insert_applique_letters',settings);onDone()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <div className="specialty-workspace"><article className="specialty-preview"><h2>Live appliqué lettering preview</h2><div className="specialty-figure">{plan?<svg viewBox={box} role="img" aria-label="Appliqué stitch paths">{plan.blocks.map((block,i)=><g key={i} fill="none" stroke={'rgb('+block.color.join(',')+')'} strokeWidth=".35">{block.runs.map((run,j)=><polyline key={j} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg>:<p>{valid?'Generating stitch preview…':'Enter letters and a valid height.'}</p>}</div>{plan&&<p>{plan.stitches.toLocaleString()} stitches · {plan.blocks.length} sewing blocks</p>}<small>Follow the placement, fabric tack-down and finishing stages for each letter. Verify machine stops and test sew before production.</small></article><article className="specialty-controls"><h2>Appliqué alphabet</h2><label>Text<input value={text} maxLength={16} onChange={e=>setText(e.target.value.toUpperCase())}/></label><label>Alphabet<select value={style} onChange={e=>setStyle(e.target.value)}><option value="block">Classic Block</option><option value="collegiate">Collegiate Narrow</option><option value="wide">Wide Block</option></select></label><label>Letter height (inches)<input type="number" min=".79" max="3.93" step=".1" value={height} onChange={e=>setHeight(e.target.value)}/></label><label>Finishing thread<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><button className="primary" disabled={busy||!valid||!plan} onClick={()=>void insert()}>{busy?'Adding…':'Add to current design'}</button>{error&&<p role="alert">{error}</p>}</article></div>
}

export function Specialty({ applique, onDone }: { applique: boolean; onDone: () => void }) {
  const [alphabet,setAlphabet]=useState(false);
  const [previewStage,setPreviewStage]=useState(2);
  const [shape, setShape] = useState<(typeof shapes)[number]>(shapes[0]);
  const [inches, setInches] = useState(String(Number((65 / 25.4).toFixed(3))));
  const [busy, setBusy] = useState<'design' | 'export' | null>(null);
  const [error, setError] = useState('');
  const width = Number(inches) * 25.4;
  const validWidth = inches.trim() !== '' && width >= 20 && width <= 200;

  const [actual,setActual]=useState<StitchPlan|null>(null);
  const [previewStatus,setPreviewStatus]=useState('');
  useEffect(()=>{
    setActual(null);setPreviewStatus('');
    if(!validWidth)return;
    let active=true;
    setPreviewStatus('Preparing stitch preview…');
    const timer=window.setTimeout(()=>{
      void invoke<StitchPlan>('preview_specialty',{shape:shape[0],style:applique?'applique':'patch',width}).then(plan=>{
        if(active){setActual(plan);setPreviewStatus('')}
      }).catch(()=>{if(active)setPreviewStatus('Stitch preview unavailable; showing shape illustration.')});
    },220);
    return()=>{active=false;window.clearTimeout(timer)};
  },[shape,applique,width,validWidth]);
  const blocks=actual?.blocks.slice(0,applique?previewStage+1:previewStage===0?0:actual.blocks.length)??[];
  const bounds=(()=>{let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity;for(const b of actual?.blocks??[])for(const run of b.runs)for(const [a,b] of run){x=Math.min(x,a);y=Math.min(y,b);X=Math.max(X,a);Y=Math.max(Y,b)}return Number.isFinite(x)?[x-4,y-4,Math.max(1,X-x)+8,Math.max(1,Y-y)+8].join(' '):'0 0 120 120'})();
  async function create() {
    if (!await confirmAction('Replace the current design? Save any existing work first.')) return;
    setBusy('design');
    setError('');
    try {
      await invoke('create_specialty', { shape: shape[0], style: applique ? 'applique' : 'patch', width });
      toast('Design created');
      onDone();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  }

  async function exportOutline() {
    setBusy('export');
    setError('');
    try {
      if (await invoke<boolean>('export_applique_cut_svg', { shape: shape[0], width })) {
        toast('Cutting outline saved');
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  }

  if(applique&&alphabet)return <><div className="studio-tools"><button onClick={()=>setAlphabet(false)}>Shapes</button><button aria-pressed="true">Appliqué lettering</button></div><AppliqueLettering onDone={onDone}/></>;
  return <><div className="studio-tools" hidden={!applique}>{applique&&<><button aria-pressed="true">Shapes</button><button onClick={()=>setAlphabet(true)}>Appliqué lettering</button></>}</div><div className="specialty-workspace">
    <article className="specialty-preview">
      <div className="specialty-preview-heading"><h2>Design preview</h2><span>{actual?'Generated stitch preview':'Illustrative stitch finish'}</span></div><div className="specialty-stage-tabs" role="group" aria-label="Preview sewing stage">{(applique?appliqueSequence:patchSequence).map(([label],i)=><button key={label} aria-pressed={previewStage===i} onClick={()=>setPreviewStage(i)}>{i+1}. {label}</button>)}</div><div className="specialty-figure">
        {actual&&blocks.length>0?<svg className="specialty-real-stitches" viewBox={bounds} role="img" aria-label="Generated stitch paths">{blocks.map((block,i)=><g key={i} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth=".35" strokeLinecap="round">{block.runs.map((run,j)=><polyline key={j} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg>:<svg viewBox="0 0 120 120" role="img" aria-label={shape[1] + ' artwork outline'}>
          <defs><pattern id="specialty-fabric" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#f9f4ff"/><path d="M0 2H8 M2 0V8" stroke="#b89ad9" strokeWidth="3" opacity=".4"/></pattern></defs><path transform="translate(10 10)" d={shape[2]} fill={previewStage===0?"none":"url(#specialty-fabric)"} stroke="var(--specialty-accent)" strokeWidth={previewStage===2?"4":"1.3"} strokeDasharray={previewStage===2?undefined:"2 1.5"}/>{previewStage===2&&<path transform="translate(10 10)" d={shape[2]} fill="none" stroke="#e3d0f7" strokeWidth="2.6" strokeDasharray=".35 .8"/>}
        </svg>}
      </div>{previewStatus&&<p className="muted" role="status">{previewStatus}</p>}
      <div className="specialty-figure-caption">
        <strong>{shape[1]}</strong>{actual&&<small>{actual.stitches.toLocaleString()} stitch points</small>}
        {validWidth && <span>{Number(inches).toFixed(2)} in · {width.toFixed(1)} mm wide</span>}
      </div>
      <div className="specialty-sequence">
        <h2>Sewing sequence</h2>
        <ol>
          {(applique ? appliqueSequence : patchSequence).map(([label, note]) =>
            <li key={label}><strong>{label}</strong><p>{note}</p></li>
          )}
        </ol>
        {applique && <p className="muted">Check that your machine stops at the placement and tack-down changes during a test sew.</p>}
      </div>
    </article>
    <article className="specialty-controls">
      <h2>Shape</h2>
      <div className="specialty-shapes" role="group" aria-label="Choose a shape">
        {shapes.map((preset) => <button
          type="button" key={preset[0]} aria-pressed={shape === preset} disabled={busy !== null}
          onClick={() => setShape(preset)}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true"><path d={preset[2]} fill="currentColor" /></svg>
          {preset[1]}
        </button>)}
      </div>
      <div className="specialty-size">
        <label htmlFor="specialty-width">Artwork width</label>
        <div className="specialty-size-input">
          <input id="specialty-width" type="number" step="any" min={20 / 25.4} max={200 / 25.4}
            value={inches} onChange={event => setInches(event.target.value)} disabled={busy !== null}
            aria-describedby="specialty-dimensions" />
          <span>in</span>
        </div>
        <p id="specialty-dimensions" aria-live="polite">{validWidth ? width.toFixed(1) + ' mm' : 'Enter a width between 20 and 200 mm.'}</p>
      </div>
      <div className="specialty-actions">
        <button className="primary" disabled={busy !== null || !validWidth} onClick={() => void create()}>
          <ArrowUpRight size={17} /> {busy === 'design' ? 'Generating…' : 'Create in Design Studio'}
        </button>
        {applique && <>
          <button disabled={busy !== null || !validWidth} onClick={() => void exportOutline()}>
            <Download size={16} /> {busy === 'export' ? 'Saving outline…' : 'Export cutting SVG'}
          </button>
          <p>The SVG follows the placement outline at the current size, with zero fabric allowance.</p>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  </div></>;
}
