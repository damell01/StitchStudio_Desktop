import {confirmAction} from './dialogs';
import {useEffect,useMemo,useRef,useState} from 'react';
import './lettering.css';
import {compareNames,matchesName} from './list-navigation';
import {FilePlus,Plus,Search,Type} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
function FontPicker({fonts,selected,choose}:{fonts:string[];selected:string;choose:(font:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState('');
  const filtered=fonts.filter(font=>matchesName(font,query)).sort(compareNames);
  const [limit,setLimit]=useState(36);
  return <>
    <button onClick={()=>dialog.current?.showModal()} disabled={!fonts.length} aria-label="Choose font"><Type size={16}/> {selected||'Choose font'}</button>
    <dialog className="studio-modal font-picker" ref={dialog} aria-label="Choose a lettering font">
      <div className="studio-modal-heading"><h2>Choose a lettering font</h2><button onClick={()=>dialog.current?.close()}>Close</button></div>
      <label className="library-search"><Search size={16}/><input autoFocus placeholder="Search fonts" aria-label="Find installed fonts" value={query} onChange={event=>{setQuery(event.target.value);setLimit(36);}}/></label>
      {!filtered.length&&<p role="status">No installed fonts match.</p>}
      <div className="font-picker-results">{filtered.slice(0,limit).map(font=><button aria-pressed={font===selected} key={font} onClick={()=>{choose(font);dialog.current?.close();}}>
        <span style={{fontFamily:font}}>Aa</span>{font}
      </button>)}</div>
      {filtered.length>limit&&<button onClick={()=>setLimit(previous=>previous+36)}>Show more fonts</button>}
    </dialog>
  </>;
}
const letteringEffects = [["satin","Standard satin"],["puff","Foam satin with end caps (test sew)"],["double_outline","Double satin outline"],["shadow","Offset shadow"],["gradient","Two-thread blended satin"],["fill","Tatami fill"],["applique","Fabric appliqué"],["run","Running outline"],["bean","Bean stitch (triple pass)"],["ripple","Lightweight ripple"],["contour","Contour fill"],["cross","Cross stitch"],["meander","Quilted meander"],["blanket","Blanket edge"]] as const;
type Settings = {
  kind?:string;
  leading?:number;
  effect_color?:number[];inner_color?:number[];
  outer_width?:number;inner_width?:number;shadow_x?:number;shadow_y?:number;
  text:string; font:string; size:number; spacing:number; arc:number; bold:boolean;
  italic:boolean; color:number[]; align:string; h_scale?:number; v_scale?:number; kern?:[number,number][]; path?:string; path_offset?:number; path_flip?:boolean;
};
function colorHex(rgb:number[]|undefined, fallback:string) {
  return rgb?.length===3?'#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join(''):fallback;
}
function rgbHex(hex:string) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)); }
function EffectControls({settings,onChange}:{settings:Settings;onChange:(patch:Partial<Settings>)=>void}) {
 const effect=settings.kind;
 if(!['double_outline','shadow','gradient','puff'].includes(effect??''))return null;
 return <div className="lettering-effect-controls" role="group" aria-label="Embroidery effect adjustments">
  {effect==='puff'&&<small>Foam satin includes native end-cap securing stitches. Use suitable block lettering and sample-stitch with the foam and stabilizer you intend to use.</small>}
  {effect==='double_outline'&&<>
    <label>Outer outline thread<input type="color" value={colorHex(settings.effect_color,'#1c2337')} onChange={e=>onChange({effect_color:rgbHex(e.target.value)})}/></label>
    <label>Outer outline width (mm)<input type="number" min=".5" max="6" step=".1" value={settings.outer_width??2.4} onChange={e=>onChange({outer_width:Number(e.target.value)})}/></label>
    <label>Inner outline thread<input type="color" value={colorHex(settings.inner_color,'#f5f5f5')} onChange={e=>onChange({inner_color:rgbHex(e.target.value)})}/></label>
    <label>Inner outline width (mm)<input type="number" min=".3" max="4" step=".1" value={settings.inner_width??1} onChange={e=>onChange({inner_width:Number(e.target.value)})}/></label>
    <small>The inner border must be narrower than the outer border. Both are actual satin stitch layers.</small>
  </>}
  {effect==='shadow'&&<>
    <label>Shadow thread<input type="color" value={colorHex(settings.effect_color,'#1c2337')} onChange={e=>onChange({effect_color:rgbHex(e.target.value)})}/></label>
    <label>Right offset (mm)<input type="number" min="-10" max="10" step=".5" value={settings.shadow_x??1.5} onChange={e=>onChange({shadow_x:Number(e.target.value)})}/></label>
    <label>Down offset (mm)<input type="number" min="-10" max="10" step=".5" value={settings.shadow_y??1.5} onChange={e=>onChange({shadow_y:Number(e.target.value)})}/></label>
  </>}
  {effect==='gradient'&&<>
    <label>Second thread color<input type="color" value={colorHex(settings.effect_color,'#1c2337')} onChange={e=>onChange({effect_color:rgbHex(e.target.value)})}/></label>
    <small>Two real thread colors overlap in an opened-density satin transition. This is thread blending, not printed color interpolation; verify the result in stitch preview and on fabric.</small>
  </>}
 </div>;
}

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
  const [kind,setKind]=useState('satin');
  const [effectSettings,setEffectSettings]=useState({effect_color:[28,35,55],inner_color:[245,245,245],outer_width:2.4,inner_width:1,shadow_x:1.5,shadow_y:1.5});
  const [leading,setLeading]=useState(1.5);
  const [text,setText]=useState(monogram?'ABC':'Your name');
  const [fonts,setFonts]=useState<string[]>([]),[font,setFont]=useState('');
  const [hScale,setHScale]=useState(100),[vScale,setVScale]=useState(100);
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
    ...effectSettings,kind,leading,text,font,size,spacing,arc,bold,italic,align,h_scale:hScale,v_scale:vScale,color:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))
  }),[kind,leading,text,font,size,spacing,arc,bold,italic,align,color,hScale,vScale,effectSettings]);
  const valid=Boolean(font && text.trim() && size>=3 && size<=80 && spacing>=0 && spacing<=5 && Math.abs(arc)<=300 && hScale>=25 && hScale<=250 && vScale>=25 && vScale<=250);
  const xMm=offset?Number(x)*25.4:0, yMm=offset?Number(y)*25.4:0;
  const validPlacement=!offset || (x.trim()!=='' && y.trim()!=='' && Math.abs(xMm)<=500 && Math.abs(yMm)<=500);

  async function create(insert:boolean) {
    if(submitLock.current||!valid||(insert&&!validPlacement))return;
    submitLock.current=true;
    setBusy(true);setError('');
    try {
      if(!insert && !await confirmAction('Start a new lettering design? Save the current project first if you want to keep it.'))return;
      await invoke('create_lettering',{...settings,hScale:settings.h_scale,vScale:settings.v_scale,effectColor:settings.effect_color,innerColor:settings.inner_color,outerWidth:settings.outer_width,innerWidth:settings.inner_width,shadowX:settings.shadow_x,shadowY:settings.shadow_y,placement:insert?[xMm,yMm]:null});
      onDone();
    } catch(e) {setError(String(e));}
    finally {submitLock.current=false;setBusy(false);}
  }

  return <section className="lower lettering-workspace">
    <article className="lettering-inspector">
      <h2>{monogram?'Your initials':'Your lettering'}</h2><p className="muted">Choose your text, font and stitch size.</p>
      {monogram
        ? <label>Initials<input value={text} maxLength={3} onChange={e=>setText(e.target.value.toUpperCase())}/></label>
        : <><label>Text<textarea rows={3} value={text} maxLength={120} onChange={e=>setText(e.target.value)}/></label><div className="lettering-size-presets"><button onClick={()=>setText(text.toUpperCase())}>UPPERCASE</button><button onClick={()=>setText(text.toLowerCase())}>lowercase</button><button onClick={()=>setText(text.replace(/\p{L}[\p{L}\p{M}]*/gu,w=>w[0].toUpperCase()+w.slice(1).toLowerCase()))}>Title Case</button></div><small>{text.length}/120 characters · {text.split('\n').length} lines</small></>}
      <FontPicker fonts={fonts} selected={font} choose={setFont}/>
      <label>Embroidery effect<select value={kind} onChange={e=>setKind(e.target.value)}>{letteringEffects.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <EffectControls settings={settings} onChange={patch=>setEffectSettings(old=>({...old,...patch}))}/>
      {kind==="applique"&&<small>Review placement, tack-down and finishing stages before exporting. Use a suitable broad font.</small>}
      <div className="lettering-size-presets" role="group" aria-label="Lettering layout presets">
        <button onClick={()=>{setBold(true);setItalic(false);setHScale(100);setVScale(100);setSpacing(.4);setArc(0)}}>Classic</button>
        <button onClick={()=>{setBold(true);setItalic(false);setHScale(85);setVScale(110);setSpacing(.6);setArc(0)}}>Tall block</button>
        <button onClick={()=>{setBold(true);setItalic(false);setHScale(120);setVScale(90);setSpacing(.8);setArc(0)}}>Wide block</button>
        <button onClick={()=>{setBold(false);setItalic(true);setHScale(100);setVScale(100);setSpacing(.3);setArc(0)}}>Slanted</button>
        <button onClick={()=>{setArc(65);setSpacing(.6)}}>Upper arch</button>
        <button onClick={()=>{setArc(-65);setSpacing(.6)}}>Lower arch</button>
      </div>

      <div className="lettering-size-presets" role="group" aria-label="Letter height presets">{[8,12,20,30,50].map(n=><button key={n} aria-pressed={size===n} onClick={()=>setSize(n)}>{n} mm</button>)}</div><label>Capital height (mm)<input type="number" min="3" max="80" value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <div className="lettering-style">
        <label><input type="checkbox" checked={bold} onChange={e=>setBold(e.target.checked)}/> Bold</label>
        <label><input type="checkbox" checked={italic} onChange={e=>setItalic(e.target.checked)}/> Italic</label>
        <label>Thread color<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
      </div>
      <details className="lettering-controls"><summary>Spacing and layout</summary><label>Letter width (%)<input type="number" min="25" max="250" value={hScale} onChange={e=>setHScale(Number(e.target.value))}/></label><label>Letter height scale (%)<input type="number" min="25" max="250" value={vScale} onChange={e=>setVScale(Number(e.target.value))}/></label><button onClick={()=>{setHScale(100);setVScale(100)}}>Reset proportions</button>
        <label>Line spacing (× capital height)<input type="number" min=".5" max="5" step=".1" value={leading} onChange={e=>setLeading(Number(e.target.value))}/></label>
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

export type PickedBaseline = {path:string;label:string};

export function InlineLettering({uid,disabled,onBusy,onDone,baseline,pickingBaseline,onPickBaseline}:{
 uid:number|null;disabled:boolean;onBusy:(busy:boolean)=>void;onDone:(uid:number|null)=>void;
 baseline?:PickedBaseline|null;pickingBaseline?:boolean;onPickBaseline?:()=>void;
}){
 const [fonts,setFonts]=useState<string[]>([]);
 const [target,setTarget]=useState(uid);
 const [settings,setSettings]=useState<Settings>({text:'Your name',font:'',size:12,spacing:.4,arc:0,bold:true,italic:false,color:[105,69,162],align:'center'});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const lock=useRef(false);
 const [character,setCharacter]=useState(0);
 const [fontQuery,setFontQuery]=useState(''),[showAdvanced,setShowAdvanced]=useState(false),[committed,setCommitted]=useState('');
 const [autoApply,setAutoApply]=useState(true),[failedFingerprint,setFailedFingerprint]=useState('');
 const [preview,setPreview]=useState<StitchPlan|null>(null),[previewPending,setPreviewPending]=useState(false);
 useEffect(()=>{
   if(!baseline)return;
   setSettings(previous=>({...previous,path:baseline.path,arc:0,path_offset:.5,path_flip:false,align:'center'}));
 },[baseline]);
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
 <div className="lettering-size-presets" role="group" aria-label="Quick lettering styles">
 {[
 {name:'Classic',values:{bold:true,italic:false,h_scale:100,v_scale:100,spacing:.4}},
 {name:'Tall block',values:{bold:true,italic:false,h_scale:85,v_scale:110,spacing:.6}},
 {name:'Wide block',values:{bold:true,italic:false,h_scale:120,v_scale:90,spacing:.8}},
 {name:'Slanted',values:{bold:false,italic:true,h_scale:100,v_scale:100,spacing:.3}},
 ].map(p=><button type="button" key={p.name} onClick={()=>setSettings(old=>({...old,...p.values}))}>{p.name}</button>)}
 </div>
 <label>Embroidery effect<select value={settings.kind??"satin"} onChange={e=>change("kind",e.target.value)}>{letteringEffects.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><EffectControls settings={settings} onChange={patch=>setSettings(old=>({...old,...patch}))}/>
 <label>Line spacing (× capital height)<input type="number" min=".5" max="5" step=".1" value={settings.leading??1.5} onChange={e=>change("leading",Number(e.target.value))}/></label>
 <label>Find font<input type="search" placeholder="Search installed fonts…" value={fontQuery} onChange={e=>setFontQuery(e.target.value)}/></label><label>Font<select value={settings.font} onChange={e=>change('font',e.target.value)}>{filteredFonts.map(f=><option key={f}>{f}</option>)}</select></label>
 <div className="inline-text-sample" style={{fontFamily:settings.font,fontWeight:settings.bold?'bold':'normal',fontStyle:settings.italic?'italic':'normal',color:hex}}>{preview&&previewBox?<svg viewBox={previewBox.join(' ')} role="img" aria-label="Actual planned stitches">{preview.blocks.map((b,i)=><g key={i} fill="none" stroke={'rgb('+b.color.join(',')+')'} strokeWidth=".24" strokeLinecap="round" strokeLinejoin="round">{b.runs.map((run,j)=><polyline key={j} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg>:settings.text}</div><small role="status">{previewPending?'Planning stitches…':preview?preview.stitches.toLocaleString()+' stitch points · '+(previewBox![2]-4).toFixed(1)+' × '+(previewBox![3]-4).toFixed(1)+' mm':'Font sample'}</small>
 <div className="lettering-size-presets" role="group" aria-label="Quick sizes">{[8,12,20,30].map(n=><button key={n} aria-pressed={settings.size===n} onClick={()=>change('size',n)}>{n} mm</button>)}</div><div className="inline-lettering-grid"><label>Height (mm)<input type="number" min="0.5" max="80" step="0.1" value={settings.size} onChange={e=>change('size',Number(e.target.value))}/></label><label>Spacing (mm)<input type="number" min="0" max="5" step=".1" value={settings.spacing} onChange={e=>change('spacing',Number(e.target.value))}/></label></div>
 <div className="inline-lettering-style"><button aria-pressed={settings.bold} onClick={()=>change('bold',!settings.bold)}><b>B</b></button><button aria-pressed={settings.italic} onClick={()=>change('italic',!settings.italic)}><i>I</i></button><label>Thread color<input type="color" value={hex} onChange={e=>change('color',[1,3,5].map(i=>parseInt(e.target.value.slice(i,i+2),16)))}/></label></div>
 <div className="inline-color-presets" role="group" aria-label="Thread color presets">{['#754bb0','#111111','#ffffff','#ae294f','#24558c','#34754b','#d5a52e'].map(v=><button key={v} aria-label={'Thread '+v} aria-pressed={hex===v} style={{backgroundColor:v}} onClick={()=>change('color',[1,3,5].map(i=>parseInt(v.slice(i,i+2),16)))}/>)}</div><h4>Text layout</h4><div className="inline-lettering-layout"><button type="button" onClick={()=>setSettings(s=>({...s,text:s.text.trim().split(/\s+/).map(w=>Array.from(w)[0]??'').join('').toUpperCase().slice(0,3),spacing:1,arc:0,path:'',align:'center',bold:true}))}>Monogram initials</button><button type="button" onClick={()=>setSettings(s=>({...s,kind:'run',spacing:.6,bold:false}))}>Light outline</button></div><div className="inline-lettering-layout" role="group" aria-label="Text direction">{[{label:'Straight',arc:0},{label:'Arc up',arc:60},{label:'Arc down',arc:-60}].map(a=><button key={a.label} aria-pressed={a.arc===0?settings.arc===0:a.arc>0?settings.arc>0:settings.arc<0} onClick={()=>setSettings(s=>({...s,arc:a.arc,path:''}))}>{a.label}</button>)}<button aria-pressed={!!settings.path} onClick={()=>{setShowAdvanced(true);setSettings(s=>({...s,arc:0,path:s.path||'M 0 0 Q 30 -25 60 0'}))}}>Custom curve</button></div>
 {target===null&&onPickBaseline&&<div className="lettering-baseline-picker">
   <button type="button" aria-pressed={!!pickingBaseline} onClick={onPickBaseline}>
     {pickingBaseline?'Cancel baseline selection':'Pick a baseline on canvas'}
   </button>
   {pickingBaseline?<p role="status">Click an open path. Press Escape to cancel.</p>:
     baseline&&settings.path===baseline.path?<small>Baseline from {baseline.label}</small>:null}
 </div>}
 <button aria-expanded={showAdvanced} onClick={()=>setShowAdvanced(v=>!v)}>{showAdvanced?'Hide advanced layout':'Advanced layout'}</button>{showAdvanced&&<><div className="inline-lettering-grid"><label>Width scale (%)<input type="number" min="25" max="250" value={settings.h_scale??100} onChange={e=>change('h_scale',Number(e.target.value))}/></label><label>Height scale (%)<input type="number" min="25" max="250" value={settings.v_scale??100} onChange={e=>change('v_scale',Number(e.target.value))}/></label></div><label>Character spacing<select value={character} onChange={e=>setCharacter(Number(e.target.value))}>{Array.from(settings.text).map((ch,i)=><option key={i} value={i}>{i+1}: {ch===' '?'Space':ch}</option>)}</select></label><label>Extra gap before character (mm)<input type="number" min="-10" max="10" step=".1" value={settings.kern?.find(([i])=>i===character)?.[1]??0} onChange={e=>change('kern',[...(settings.kern??[]).filter(([i])=>i!==character),[character,Number(e.target.value)]])}/></label><button onClick={()=>change('kern',[])}>Reset character spacing</button><label>Curve radius (mm)<input type="number" min="-300" max="300" value={settings.arc} onChange={e=>change('arc',Number(e.target.value))}/></label>
 <label>Custom baseline (SVG path, mm)<textarea rows={2} placeholder="M 0 0 Q 30 -25 60 0" value={settings.path??''} onChange={e=>change('path',e.target.value)}/></label><small>Use the curve presets or enter a custom SVG path. Clear the path to restore the normal layout.</small><div className="inline-lettering-layout" role="group" aria-label="Custom baseline presets">{[['Wave','M 0 0 Q 15 -15 30 0 T 60 0'],['Arch','M 0 0 Q 30 -30 60 0'],['Vertical baseline','M 0 0 L 0 80'],['Circle clockwise','M 0 -30 A 30 30 0 1 1 0 30 A 30 30 0 1 1 0 -30'],['Circle counterclockwise','M 0 -30 A 30 30 0 1 0 0 30 A 30 30 0 1 0 0 -30']].map(([label,path])=><button key={label} onClick={()=>setSettings(s=>({...s,path,arc:0}))}>{label}</button>)}</div>{settings.path&&<><label>Start along path (%)<input type="number" min="0" max="100" value={Math.round((settings.path_offset??0)*100)} onChange={e=>change('path_offset',Math.max(0,Math.min(1,Number(e.target.value)/100)))}/></label><label><input type="checkbox" checked={settings.path_flip??false} onChange={e=>change('path_flip',e.target.checked)}/> Flip lettering along path</label></>}<label>Alignment<select value={settings.align} onChange={e=>change('align',e.target.value)}>{['left','center','right'].map(a=><option key={a}>{a}</option>)}</select></label></>}
 </fieldset>{!valid&&!loading&&<p role="status">Enter text, choose a font, and check the height (0.5–80 mm), spacing and scale.</p>}{target!==null&&settings.size*(settings.v_scale??100)/100<3&&<small role="status">Very small lettering: inspect stitch coverage and test sew before exporting.</small>}{target!==null&&<label className="live-text-toggle"><input type="checkbox" checked={autoApply} onChange={e=>setAutoApply(e.target.checked)}/> Update canvas automatically</label>}<button className="primary" disabled={disabled||saving||!valid||(target!==null&&!dirty)} onClick={()=>void apply()}>{saving?'Updating…':target===null?'Add text to design':dirty?'Apply text changes':'Changes applied'}</button></>}{error&&<p role="alert">{error}</p>}</section>
}
