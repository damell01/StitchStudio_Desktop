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
  italic:boolean; color:number[]; align:string; h_scale?:number; v_scale?:number; kern?:[number,number][]; path?:string; path_offset?:number; path_flip?:boolean;
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
        {plan.blocks.map((block,i)=><g key={i} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth={threadView?".24":".12"} strokeLinecap="round" strokeLinejoin="round">
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

export function InlineLettering({uid,disabled,onBusy,onDone}:{uid:number|null;disabled:boolean;onBusy:(busy:boolean)=>void;onDone:(uid:number|null)=>void}){
 const [fonts,setFonts]=useState<string[]>([]);
 const [target,setTarget]=useState(uid);
 const [settings,setSettings]=useState<Settings>({text:'Your name',font:'',size:12,spacing:.4,arc:0,bold:true,italic:false,color:[105,69,162],align:'center'});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const lock=useRef(false);
 const [character,setCharacter]=useState(0);
 const [fontQuery,setFontQuery]=useState(''),[showAdvanced,setShowAdvanced]=useState(false),[committed,setCommitted]=useState('');
 const [autoApply,setAutoApply]=useState(true),[failedFingerprint,setFailedFingerprint]=useState('');
 const [preview,setPreview]=useState<StitchPlan|null>(null),[previewPending,setPreviewPending]=useState(false);
 const fingerprint=JSON.stringify(settings);
 const dirty=fingerprint!==committed;
 const filteredFonts=useMemo(()=>fonts.filter(f=>f===settings.font||matchesName(f,fontQuery)),[fonts,fontQuery,settings.font]);
 useEffect(()=>{let active=true;Promise.all([invoke<string[]>('lettering_fonts'),uid===null?Promise.resolve(null):invoke<Settings|null>('lettering_settings',{uid})]).then(([list,s])=>{if(!active)return;setFonts(list);setTarget(s?uid:null);setSettings(old=>s??{...old,font:list.find(f=>f==='Arial')||list[0]||''});if(s)setCommitted(JSON.stringify(s));setLoading(false)}).catch(e=>{if(active){setError(String(e));setLoading(false)}});return()=>{active=false}},[uid]);
 function change<K extends keyof Settings>(key:K,value:Settings[K]){setSettings(s=>({...s,[key]:value}))}
 const hex='#'+settings.color.map(v=>v.toString(16).padStart(2,'0')).join('');
 const valid=!!settings.font&&!!settings.text.trim()&&settings.size>=0.5&&settings.size<=80&&settings.spacing>=0&&settings.spacing<=5&&Math.abs(settings.arc)<=300&&(settings.h_scale??100)>=25&&(settings.h_scale??100)<=250&&(settings.v_scale??100)>=25&&(settings.v_scale??100)<=250;
 useEffect(()=>{let active=true;setPreview(null);setPreviewPending(valid&&!loading);if(!valid||loading)return;const timer=window.setTimeout(()=>{void invoke<StitchPlan>('preview_lettering',{settings}).then(p=>{if(active){setPreview(p);setPreviewPending(false)}}).catch(()=>{if(active)setPreviewPending(false)})},300);return()=>{active=false;window.clearTimeout(timer)}},[settings,valid,loading]);
 const previewBox=useMemo(()=>preview?previewBounds(preview):null,[preview]);
 async function apply(){if(lock.current||disabled||!valid)return;lock.current=true;setSaving(true);onBusy(true);setError('');try{
 let applied=target;
 if(target!==null){await invoke('update_lettering',{uid:target,settings})}
 else {const before=await invoke<{uid:number}[]>('editable_objects');await invoke('insert_lettering_settings',{settings});const after=await invoke<{uid:number}[]>('editable_objects');const added=after.find(o=>!before.some(b=>b.uid===o.uid));if(added){setTarget(added.uid);applied=added.uid}else{setError('Text added, but its editable object could not be identified. Select it in Layers to continue.');onDone(null);return}}
 setCommitted(fingerprint);setFailedFingerprint('');onDone(applied);
 }catch(e){setError(String(e));setFailedFingerprint(fingerprint)}finally{lock.current=false;setSaving(false);onBusy(false)}}
 useEffect(()=>{if(!autoApply||target===null||loading||disabled||saving||!valid||!dirty||failedFingerprint===fingerprint)return;const timer=window.setTimeout(()=>{void apply()},350);return()=>window.clearTimeout(timer)},[autoApply,target,loading,disabled,saving,valid,dirty,fingerprint,failedFingerprint]);
 return <section className="inline-lettering workspace-inspector-group"><h3><Type size={18}/>{target===null?'Add lettering':'Edit lettering'}</h3><p className="muted">Changes update the canvas automatically after typing.</p>{loading?<p role="status">Loading fonts…</p>:<>
 <fieldset disabled={disabled||saving} className="inline-lettering-fields"><label>Text<textarea rows={2} maxLength={120} value={settings.text} onChange={e=>{const text=e.target.value;setSettings(old=>({...old,text,kern:old.kern?.filter(([i])=>i<Array.from(text).length)}));setCharacter(0)}}/></label>
 <label>Find font<input type="search" placeholder="Search installed fonts…" value={fontQuery} onChange={e=>setFontQuery(e.target.value)}/></label><label>Font<select value={settings.font} onChange={e=>change('font',e.target.value)}>{filteredFonts.map(f=><option key={f}>{f}</option>)}</select></label>
 <div className="inline-text-sample" style={{fontFamily:settings.font,fontWeight:settings.bold?'bold':'normal',fontStyle:settings.italic?'italic':'normal',color:hex}}>{preview&&previewBox?<svg viewBox={previewBox.join(' ')} role="img" aria-label="Actual planned stitches">{preview.blocks.map((b,i)=><g key={i} fill="none" stroke={'rgb('+b.color.join(',')+')'} strokeWidth=".24" strokeLinecap="round" strokeLinejoin="round">{b.runs.map((run,j)=><polyline key={j} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg>:settings.text}</div><small role="status">{previewPending?'Planning stitches…':preview?preview.stitches.toLocaleString()+' stitch points · '+(previewBox![2]-4).toFixed(1)+' × '+(previewBox![3]-4).toFixed(1)+' mm':'Font sample'}</small>
 <div className="lettering-size-presets" role="group" aria-label="Quick sizes">{[8,12,20,30].map(n=><button key={n} aria-pressed={settings.size===n} onClick={()=>change('size',n)}>{n} mm</button>)}</div><div className="inline-lettering-grid"><label>Height (mm)<input type="number" min="0.5" max="80" step="0.1" value={settings.size} onChange={e=>change('size',Number(e.target.value))}/></label><label>Spacing (mm)<input type="number" min="0" max="5" step=".1" value={settings.spacing} onChange={e=>change('spacing',Number(e.target.value))}/></label></div>
 <div className="inline-lettering-style"><button aria-pressed={settings.bold} onClick={()=>change('bold',!settings.bold)}><b>B</b></button><button aria-pressed={settings.italic} onClick={()=>change('italic',!settings.italic)}><i>I</i></button><label>Thread color<input type="color" value={hex} onChange={e=>change('color',[1,3,5].map(i=>parseInt(e.target.value.slice(i,i+2),16)))}/></label></div>
 <div className="inline-color-presets" role="group" aria-label="Thread color presets">{['#754bb0','#111111','#ffffff','#ae294f','#24558c','#34754b','#d5a52e'].map(v=><button key={v} aria-label={'Thread '+v} aria-pressed={hex===v} style={{backgroundColor:v}} onClick={()=>change('color',[1,3,5].map(i=>parseInt(v.slice(i,i+2),16)))}/>)}</div><h4>Text layout</h4><div className="inline-lettering-layout" role="group" aria-label="Text direction">{[{label:'Straight',arc:0},{label:'Arc up',arc:60},{label:'Arc down',arc:-60}].map(a=><button key={a.label} aria-pressed={a.arc===0?settings.arc===0:a.arc>0?settings.arc>0:settings.arc<0} onClick={()=>setSettings(s=>({...s,arc:a.arc,path:''}))}>{a.label}</button>)}<button aria-pressed={!!settings.path} onClick={()=>{setShowAdvanced(true);setSettings(s=>({...s,arc:0,path:s.path||'M 0 0 Q 30 -25 60 0'}))}}>Custom curve</button></div>
 <button aria-expanded={showAdvanced} onClick={()=>setShowAdvanced(v=>!v)}>{showAdvanced?'Hide advanced layout':'Advanced layout'}</button>{showAdvanced&&<><div className="inline-lettering-grid"><label>Width scale (%)<input type="number" min="25" max="250" value={settings.h_scale??100} onChange={e=>change('h_scale',Number(e.target.value))}/></label><label>Height scale (%)<input type="number" min="25" max="250" value={settings.v_scale??100} onChange={e=>change('v_scale',Number(e.target.value))}/></label></div><label>Character spacing<select value={character} onChange={e=>setCharacter(Number(e.target.value))}>{Array.from(settings.text).map((ch,i)=><option key={i} value={i}>{i+1}: {ch===' '?'Space':ch}</option>)}</select></label><label>Extra gap before character (mm)<input type="number" min="-10" max="10" step=".1" value={settings.kern?.find(([i])=>i===character)?.[1]??0} onChange={e=>change('kern',[...(settings.kern??[]).filter(([i])=>i!==character),[character,Number(e.target.value)]])}/></label><button onClick={()=>change('kern',[])}>Reset character spacing</button><label>Curve radius (mm)<input type="number" min="-300" max="300" value={settings.arc} onChange={e=>change('arc',Number(e.target.value))}/></label>
 <label>Custom baseline (SVG path, mm)<textarea rows={2} placeholder="M 0 0 Q 30 -25 60 0" value={settings.path??''} onChange={e=>change('path',e.target.value)}/></label><small>Use the curve presets or enter a custom SVG path. Clear the path to restore the normal layout.</small><div className="inline-lettering-layout" role="group" aria-label="Custom baseline presets">{[['Wave','M 0 0 Q 15 -15 30 0 T 60 0'],['Arch','M 0 0 Q 30 -30 60 0'],['Vertical baseline','M 0 0 L 0 80']].map(([label,path])=><button key={label} onClick={()=>setSettings(s=>({...s,path,arc:0}))}>{label}</button>)}</div>{settings.path&&<><label>Start along path (%)<input type="number" min="0" max="100" value={Math.round((settings.path_offset??0)*100)} onChange={e=>change('path_offset',Math.max(0,Math.min(1,Number(e.target.value)/100)))}/></label><label><input type="checkbox" checked={settings.path_flip??false} onChange={e=>change('path_flip',e.target.checked)}/> Flip lettering along path</label></>}<label>Alignment<select value={settings.align} onChange={e=>change('align',e.target.value)}>{['left','center','right'].map(a=><option key={a}>{a}</option>)}</select></label></>}
 </fieldset>{!valid&&!loading&&<p role="status">Enter text, choose a font, and check the height (0.5–80 mm), spacing and scale.</p>}{target!==null&&settings.size*(settings.v_scale??100)/100<3&&<small role="status">Very small lettering: inspect stitch coverage and test sew before exporting.</small>}{target!==null&&<label className="live-text-toggle"><input type="checkbox" checked={autoApply} onChange={e=>setAutoApply(e.target.checked)}/> Update canvas automatically</label>}<button className="primary" disabled={disabled||saving||!valid||(target!==null&&!dirty)} onClick={()=>void apply()}>{saving?'Updating…':target===null?'Add text to design':dirty?'Apply text changes':'Changes applied'}</button></>}{error&&<p role="alert">{error}</p>}</section>
}
