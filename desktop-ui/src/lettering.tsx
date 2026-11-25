import {confirmAction} from './dialogs';
import {useEffect,useMemo,useRef,useState} from 'react';
import './lettering.css';
import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {FilePlus,Plus,Search,Type} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
function FontPicker({fonts,selected,choose}:{fonts:string[];selected:string;choose:(font:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState('');
  const filtered=fonts.filter(font=>matchesName(font,query)).sort(compareNames);
  const page=usePagedList(filtered,query,10);
  return <>
    <button onClick={()=>dialog.current?.showModal()} disabled={!fonts.length} aria-label="Choose font"><Type size={16}/> {selected||'Choose font'}</button>
    <dialog className="studio-modal font-picker" ref={dialog} aria-label="Choose an installed font">
      <div className="studio-modal-heading"><h2>Choose an installed font</h2><button onClick={()=>dialog.current?.close()}>Close</button></div>
      <label className="library-search"><Search size={16}/><input autoFocus placeholder="Search fonts" aria-label="Find installed fonts" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      {!filtered.length&&<p role="status">No installed fonts match.</p>}
      <div className="font-picker-results">{page.items.map(font=><button aria-pressed={font===selected} key={font} onClick={()=>{choose(font);dialog.current?.close();}}>
        <span style={{fontFamily:font}}>Aa</span>{font}
      </button>)}</div>
      <ListNavigation {...page}/>
    </dialog>
  </>;
}
type Settings = {
  text:string; font:string; size:number; spacing:number; arc:number; bold:boolean;
  italic:boolean; color:number[]; align:string;
};
type StitchPlan = { stitches:number; blocks:{color:number[];runs:number[][][]}[] };

function previewBounds(plan: StitchPlan) {
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for (const block of plan.blocks) for (const run of block.runs) for (const [x,y] of run) {
    left=Math.min(left,x); right=Math.max(right,x);
    top=Math.min(top,y); bottom=Math.max(bottom,y);
  }
  if (!Number.isFinite(left)) return [0,0,1,1];
  return [left-2,top-2,right-left+4,bottom-top+4];
}

function LetteringPreview({settings,valid}:{settings:Settings;valid:boolean}) {
  const pending=useRef<Promise<void>>(Promise.resolve());
  const [result,setResult]=useState<{settings:Settings;plan?:StitchPlan;error?:string} | null>(null);
  useEffect(()=>{
    if(!valid)return;
    let active=true;
    const timer=window.setTimeout(()=>{
      pending.current=pending.current.then(async()=>{
        if(!active)return;
        try {
          const plan=await invoke<StitchPlan>('preview_lettering',{settings});
          if(active)setResult({settings,plan});
        } catch(error) {
          if(active)setResult({settings,error:String(error)});
        }
      });
    },220);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[settings,valid]);
  const current=valid && result?.settings===settings ? result : null;
  const plan=current?.plan;
  const bounds=useMemo(()=>plan ? previewBounds(plan) : null,[plan]);
  const [threadView,setThreadView]=useState(true);
  const paths=useMemo(()=>plan?.blocks.map(b=>b.runs.map(run=>run.map(p=>p.join(',')).join(' ')))??[],[plan]);
  return <article className="lettering-preview">
    <div className="lettering-preview-heading"><h2>Live stitch preview</h2><div className="lettering-preview-switch" role="group" aria-label="Preview mode"><button aria-pressed={threadView} onClick={()=>setThreadView(true)}>Thread</button><button aria-pressed={!threadView} onClick={()=>setThreadView(false)}>Paths</button></div></div>
    <div className={`lettering-sample ${threadView?"lettering-thread-view":""}`} aria-busy={valid && !current}>
      {plan && bounds ? <svg role="img" aria-label="Planned lettering stitches" viewBox={bounds.join(' ')}>
        {plan.blocks.map((block,i)=><g key={i} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth={threadView?".43":".23"} strokeLinecap="round">
          {block.runs.map((_,j)=><polyline key={j} points={paths[i]?.[j]}/>)}
        </g>)}
      </svg> : <span role="status">{current?.error || (valid?'Planning stitches…':'Choose a font and enter your text.')}</span>}
    </div>
    {plan && bounds && <div className="lettering-metrics" aria-live="polite"><div><small>Stitch points</small><strong>{plan.stitches.toLocaleString()}</strong></div><div><small>Width</small><strong>{(bounds[2]-4).toFixed(1)} mm</strong></div><div><small>Height</small><strong>{(bounds[3]-4).toFixed(1)} mm</strong></div></div>}
    <p className="muted">The preview uses the selected font and stitch settings. Inspect small openings in the letters before sewing.</p>
  </article>;
}

export function Lettering({monogram,onDone}:{monogram:boolean;onDone:()=>void}) {
  const [text,setText]=useState(monogram?'ABC':'Your name');
  const [fonts,setFonts]=useState<string[]>([]),[font,setFont]=useState('');
  const [size,setSize]=useState(12),[spacing,setSpacing]=useState(.4),[arc,setArc]=useState(0);
  const [bold,setBold]=useState(true),[italic,setItalic]=useState(false),[color,setColor]=useState('#6945a2'),[align,setAlign]=useState('center');
  const [offset,setOffset]=useState(false),[x,setX]=useState('0'),[y,setY]=useState('0');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitLock=useRef(false);
  useEffect(()=>{
    let active=true;
    invoke<string[]>('lettering_fonts').then(list=>{
      if(!active)return;
      setFonts(list);
      setFont(['Arial','Helvetica','Liberation Sans','DejaVu Sans'].find(name=>list.includes(name))||list[0]||'');
      if(!list.length)setError('Install a system font to create lettering.');
    }).catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[]);
  const settings=useMemo(()=>({
    text,font,size,spacing,arc,bold,italic,align,color:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))
  }),[text,font,size,spacing,arc,bold,italic,align,color]);
  const valid=Boolean(font && text.trim() && size>=3 && size<=80 && spacing>=0 && spacing<=5 && Math.abs(arc)<=300);
  const xMm=offset?Number(x)*25.4:0, yMm=offset?Number(y)*25.4:0;
  const validPlacement=!offset || (x.trim()!=='' && y.trim()!=='' && Math.abs(xMm)<=500 && Math.abs(yMm)<=500);

  async function create(insert:boolean) {
    if(submitLock.current||!valid||(insert&&!validPlacement))return;
    submitLock.current=true;
    setBusy(true);setError('');
    try {
      if(!insert && !await confirmAction('Start a new lettering design? Save the current project first if you want to keep it.'))return;
      await invoke('create_lettering',{...settings,placement:insert?[xMm,yMm]:null});
      onDone();
    } catch(e) {setError(String(e));}
    finally {submitLock.current=false;setBusy(false);}
  }

  return <section className="lower lettering-workspace">
    <article className="lettering-inspector">
      <h2>{monogram?'Your initials':'Your lettering'}</h2><p className="muted">Choose your text, font and stitch size.</p>
      {monogram
        ? <label>Initials<input value={text} maxLength={3} onChange={e=>setText(e.target.value.toUpperCase())}/></label>
        : <label>Text<textarea rows={2} value={text} maxLength={120} onChange={e=>setText(e.target.value)}/></label>}
      <FontPicker fonts={fonts} selected={font} choose={setFont}/>
      <div className="lettering-size-presets" role="group" aria-label="Letter height presets">{[8,12,20,30,50].map(n=><button key={n} aria-pressed={size===n} onClick={()=>setSize(n)}>{n} mm</button>)}</div><label>Capital height (mm)<input type="number" min="3" max="80" value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <div className="lettering-style">
        <label><input type="checkbox" checked={bold} onChange={e=>setBold(e.target.checked)}/> Bold</label>
        <label><input type="checkbox" checked={italic} onChange={e=>setItalic(e.target.checked)}/> Italic</label>
        <label>Thread color<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
      </div>
      <details className="lettering-controls"><summary>Spacing and layout</summary>
        <label>Letter spacing (mm)<input type="number" min="0" max="5" step=".1" value={spacing} onChange={e=>setSpacing(Number(e.target.value))}/></label>
        <label>Arc radius (mm)<input type="number" min="-300" max="300" value={arc} onChange={e=>setArc(Number(e.target.value))}/><small>Use zero for a straight line and a negative radius for a lower arc.</small></label>
        <label>Alignment<select value={align} onChange={e=>setAlign(e.target.value)}>
          {['left','center','right'].map(a=><option key={a}>{a}</option>)}
        </select></label>
      </details>
      <label className="lettering-placement"><input type="checkbox" checked={offset} onChange={e=>setOffset(e.target.checked)}/> Offset from hoop center</label>
      {offset && <div className="lettering-offsets">
        <label>Right (in)<input type="number" step="any" value={x} onChange={e=>setX(e.target.value)}/></label>
        <label>Down (in)<input type="number" step="any" value={y} onChange={e=>setY(e.target.value)}/></label>
        <small>{validPlacement?`${xMm.toFixed(1)} × ${yMm.toFixed(1)} mm from center`:'Enter offsets within 500 mm of center.'}</small>
      </div>}
      <div className="lettering-actions">
        <button className="primary" disabled={busy||!valid||!validPlacement} onClick={()=>void create(true)}><Plus size={17}/>{monogram?'Add monogram to design':'Add lettering to design'}</button>
        <button disabled={busy||!valid} onClick={()=>void create(false)}><FilePlus size={16}/> Start a new design</button>
      </div>
      {busy&&<p role="status">Preparing lettering…</p>}
      {error&&<p role="alert">{error}</p>}
    </article>
    <LetteringPreview settings={settings} valid={valid}/>
  </section>;
}

export function InlineLettering({uid,disabled,onBusy,onDone}:{uid:number|null;disabled:boolean;onBusy:(busy:boolean)=>void;onDone:()=>void}){
 const [fonts,setFonts]=useState<string[]>([]);
 const [target,setTarget]=useState(uid);
 const [settings,setSettings]=useState<Settings>({text:'Your name',font:'',size:12,spacing:.4,arc:0,bold:true,italic:false,color:[105,69,162],align:'center'});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const lock=useRef(false);
 useEffect(()=>{let active=true;Promise.all([invoke<string[]>('lettering_fonts'),uid===null?Promise.resolve(null):invoke<Settings|null>('lettering_settings',{uid})]).then(([list,s])=>{if(!active)return;setFonts(list);setTarget(s?uid:null);setSettings(old=>s??{...old,font:list.find(f=>f==='Arial')||list[0]||''});setLoading(false)}).catch(e=>{if(active){setError(String(e));setLoading(false)}});return()=>{active=false}},[uid]);
 function change<K extends keyof Settings>(key:K,value:Settings[K]){setSettings(s=>({...s,[key]:value}))}
 const hex='#'+settings.color.map(v=>v.toString(16).padStart(2,'0')).join('');
 const valid=!!settings.font&&!!settings.text.trim()&&settings.size>=3&&settings.size<=80&&settings.spacing>=0&&settings.spacing<=5&&Math.abs(settings.arc)<=300;
 async function apply(){if(lock.current||disabled||!valid)return;lock.current=true;setSaving(true);onBusy(true);setError('');try{
 if(target!==null){await invoke('update_lettering',{uid:target,settings})}
 else {const before=await invoke<{uid:number}[]>('editable_objects');await invoke('create_lettering',{...settings,placement:[0,0]});const after=await invoke<{uid:number}[]>('editable_objects');const added=after.find(o=>!before.some(b=>b.uid===o.uid));if(added)setTarget(added.uid)}
 onDone();
 }catch(e){setError(String(e))}finally{lock.current=false;setSaving(false);onBusy(false)}}
 return <section className="inline-lettering workspace-inspector-group"><h3><Type size={18}/>{target===null?'Add lettering':'Edit lettering'}</h3><p className="muted">Adjust text here while keeping your design visible.</p>{loading?<p role="status">Loading fonts…</p>:<>
 <label>Text<textarea rows={2} maxLength={120} value={settings.text} onChange={e=>change('text',e.target.value)}/></label>
 <label>Font<select value={settings.font} onChange={e=>change('font',e.target.value)}>{fonts.map(f=><option key={f}>{f}</option>)}</select></label>
 <div className="inline-text-sample" style={{fontFamily:settings.font,fontWeight:settings.bold?'bold':'normal',fontStyle:settings.italic?'italic':'normal',color:hex}}>{settings.text}</div>
 <div className="inline-lettering-grid"><label>Height (mm)<input type="number" min="3" max="80" value={settings.size} onChange={e=>change('size',Number(e.target.value))}/></label><label>Spacing (mm)<input type="number" min="0" max="5" step=".1" value={settings.spacing} onChange={e=>change('spacing',Number(e.target.value))}/></label></div>
 <div className="inline-lettering-style"><button aria-pressed={settings.bold} onClick={()=>change('bold',!settings.bold)}><b>B</b></button><button aria-pressed={settings.italic} onClick={()=>change('italic',!settings.italic)}><i>I</i></button><label>Thread color<input type="color" value={hex} onChange={e=>change('color',[1,3,5].map(i=>parseInt(e.target.value.slice(i,i+2),16)))}/></label></div>
 <h4>Text layout</h4><div className="inline-lettering-layout" role="group" aria-label="Text direction">{[{label:'Straight',arc:0},{label:'Arc up',arc:60},{label:'Arc down',arc:-60}].map(a=><button key={a.label} aria-pressed={a.arc===0?settings.arc===0:a.arc>0?settings.arc>0:settings.arc<0} onClick={()=>change('arc',a.arc)}>{a.label}</button>)}</div>
 <label>Curve radius (mm)<input type="number" min="-300" max="300" value={settings.arc} onChange={e=>change('arc',Number(e.target.value))}/></label>
 <label>Alignment<select value={settings.align} onChange={e=>change('align',e.target.value)}>{['left','center','right'].map(a=><option key={a}>{a}</option>)}</select></label>
 <button className="primary" disabled={disabled||saving||!valid} onClick={()=>void apply()}>{saving?'Updating…':target===null?'Add text to design':'Apply text changes'}</button></>}{error&&<p role="alert">{error}</p>}</section>
}
