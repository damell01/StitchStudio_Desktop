import {readThreads} from './threads';
import {FabricPicker} from './fabric-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, ChartNoAxesColumn, Columns2, Image as ArtworkIcon, ImagePlus, Layers2 } from 'lucide-react';
import { ArtworkEdit } from './artwork-edit';
import { CharacterGallery, type Art } from './character-gallery';
import { PdfArtwork } from './pdf-artwork';

type OcrLine = { text:string; font:string; rect:number[]; confidence:number; enabled:boolean };

type Plan = {
  stitches: number;
  trims: number;
  blocks: { color: number[]; runs: number[][][] }[];
};
type Review = {
  id: number;
  plan: Plan;
  quality: { short: number; long: number; zero: number; sewn_mm: number };
  warnings: string[];
  density: [number, number, number][];
  jumps: number;
  dst_stitches: number;
  color_changes: number;
  optimization?: [number,number] | null;
};

const defaults = {
  widthMm: 80, colors: 0, useOwnedThreads: localStorage.getItem('studio-use-owned-threads') === 'true', detail: 60, fabric: 'standard',
  removeBackground: true, cleanup: true, tolerance: 32, thinLines: false,
};
// All imports use the same automatic pipeline; gallery metadata must not force a palette.
const artworkMimes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif:'image/jpeg', jpe:'image/jpeg', svg: 'image/svg+xml',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', gif: 'image/gif',
};

// Serialize native tracing across mounts. An obsolete request can finish in Rust,
// but it cannot update the visible draft or write to the design workspace.
let pendingGeneration: Promise<void> = Promise.resolve();

function useArtworkUrl(art: Art | null) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!art) { setUrl(''); return; }
    const next = URL.createObjectURL(new Blob([new Uint8Array(art.bytes)], { type: art.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [art]);
  return url;
}

export function Digitizer({ onDone, initialArtwork }: { onDone: () => void; initialArtwork?: Art | null }) {
  const [art, setArt] = useState<Art | null>(initialArtwork??null);
  const [original, setOriginal] = useState<Art | null>(initialArtwork??null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [settings, setSettings] = useState(defaults);
  const [outputFormat,setOutputFormat]=useState(()=>{let preferred='';try{const id=localStorage.getItem('studio-default-machine');const machines: {id:string;format?:string}[]=JSON.parse(localStorage.getItem('studio-machines')||'[]');preferred=machines.find(m=>m.id===id)?.format?.toLowerCase()||''}catch{}const saved=preferred||localStorage.getItem('studio-digitizer-format')||'dst';return ['dst','pes','pec','jef','exp','vp3'].includes(saved)?saved:'dst'});
  const [ocr,setOcr]=useState<{art:Art;settings:typeof defaults;lines:OcrLine[]}|null>(null);
  const [ocrFonts,setOcrFonts]=useState<string[]>([]);
  const [ocrBusy,setOcrBusy]=useState(false);
  const [autoOcr,setAutoOcr]=useState(true);
  const [ocrAttempt,setOcrAttempt]=useState<{art:Art;removeBackground:boolean;tolerance:number;cleanup:boolean}|null>(null);
  const [ocrMessage,setOcrMessage]=useState('');
  const activeOcr=ocr?.art===art&&ocr.settings.removeBackground===settings.removeBackground&&ocr.settings.tolerance===settings.tolerance&&ocr.settings.cleanup===settings.cleanup?ocr:null;
  const [approved,setApproved]=useState<{art:Art;settings:typeof defaults;lines:OcrLine[]}|null>(null);
  const selected=autoOcr&&approved?.art===art&&approved.settings.removeBackground===settings.removeBackground&&approved.settings.tolerance===settings.tolerance&&approved.settings.cleanup===settings.cleanup?approved:null;
  const [inspector,setInspector] = useState<'settings'|'quality'|'threads'>('settings');
  const [generated, setGenerated] = useState<{ art: Art; settings: typeof defaults; review: Review; lettering?: typeof selected } | null>(null);
  const [failed, setFailed] = useState<{ art: Art; settings: typeof defaults; message: string; lettering?: typeof selected } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'compare' | 'stitches' | 'original' | 'density' | 'thread'>('compare');
  const [showProcessed, setShowProcessed] = useState(false);
  const [processed, setProcessed] = useState<{ art: Art; settings: typeof defaults; url: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const artworkUrl = useArtworkUrl(original);
  const vector = art?.mime === 'image/svg+xml';
  const review = generated?.art === art && generated?.settings === settings && generated.lettering===selected ? generated.review : null;
  const [comparison,setComparison]=useState<{id:number;deep:boolean;variants:{strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[]}|null>(null);
  const [deepRequest,setDeepRequest]=useState<{id:number}|null>(null);
  const currentDeepRequest=review&&deepRequest?.id===review.id?deepRequest:null;
  const [compareBusy,setCompareBusy]=useState(false);
  const [compareError,setCompareError]=useState('');
  const [chosen,setChosen]=useState(0);const [recommended,setRecommended]=useState(0);const [exportWidth,setExportWidth]=useState('');const [exportHeight,setExportHeight]=useState('');const [exportNotice,setExportNotice]=useState('');const [showExport,setShowExport]=useState(false);
  const activeComparison=comparison?.id===review?.id?comparison:null;
  useEffect(()=>{
    if(!currentDeepRequest){setChosen(0);setRecommended(0);}
    setCompareError('');setCompareBusy(false);
    if(!review)return;
    let active=true;setCompareBusy(true);
    invoke<{strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[]>('compare_digitizer_draft',{id:review.id,quick:!currentDeepRequest}).then(variants=>{
      if(!active||!Array.isArray(variants))return;
      setComparison({id:review.id,deep:!!currentDeepRequest,variants});
      const speed=Math.max(100,Math.min(1500,Number(localStorage.getItem('studio-sewing-spm'))||800));
      const trim=Number(localStorage.getItem('studio-trim-seconds')??3);
      const change=Number(localStorage.getItem('studio-change-seconds')??8);
      const time=(p:Plan)=>p.stitches/speed+p.trims*(Number.isFinite(trim)?trim:3)/60+Math.max(0,p.blocks.length-1)*(Number.isFinite(change)?change:8)/60;
      const eligible=variants.filter(v=>v.plan&&v.strength!==4&&(v.quality?.coverage??0)>=85&&time(v.plan)<time(review.plan));
      eligible.sort((a,b)=>time(a.plan!)-time(b.plan!));
      const best=eligible[0]?.strength??0;setRecommended(best);setChosen(best);
    }).catch(e=>{if(active)setCompareError(String(e))}).finally(()=>{if(active)setCompareBusy(false)});
    return()=>{active=false};
  },[review?.id,currentDeepRequest]);
  
  const threadUsage=useMemo(()=>{
    const usage=new Map<string,number>();
    for(const block of review?.plan.blocks??[]){const key=block.color.join(',');let length=0;for(const run of block.runs)for(let i=1;i<run.length;i++)length+=Math.hypot(run[i][0]-run[i-1][0],run[i][1]-run[i-1][1]);usage.set(key,(usage.get(key)??0)+length/1000);}
    return Array.from(usage,([key,meters])=>({key,meters}));
  },[review]);
  const generationError = failed?.art === art && failed?.settings === settings && failed.lettering===selected ? failed.message : '';
  const valid = vector || (settings.widthMm >= 5 && settings.widthMm <= 300);
  const ocrReady = !autoOcr || vector || (ocrAttempt?.art===art && ocrAttempt?.removeBackground===settings.removeBackground && ocrAttempt?.tolerance===settings.tolerance && ocrAttempt?.cleanup===settings.cleanup);
  const processing = Boolean(art && valid && !review && !generationError);
  const processedUrl = processed?.art === art && processed?.settings === settings ? processed.url : '';

  useEffect(() => {
    if (!art || !valid || !ocrReady) return;
    let active = true;
    const timer = setTimeout(() => {
      pendingGeneration = pendingGeneration.then(async () => {
        if (!active) return;
        try {
          const threadPalette = settings.useOwnedThreads ? readThreads().filter(t=>t.stock>0).map(t=>[1,3,5].map(i=>parseInt(t.color.slice(i,i+2),16))) : [];
          const result = await invoke<Review>('digitize_artwork', { name:art.name, mime:art.mime, bytes:art.bytes, ...settings, threadPalette, lettering:selected?.lines??[] });
          if (active) setGenerated({ art, settings, review: result, lettering:selected });
        } catch (err) {
          if (active) setFailed({ art, settings, message: String(err), lettering:selected });
        }
      });
    }, art === original ? (settings === defaults ? 0 : 450) : 450);
    return () => { active = false; clearTimeout(timer); };
  }, [art, original, settings, valid, selected, ocrReady]);

  useEffect(() => {
    if (!showProcessed || !art || vector || processing || !valid || processedUrl) return;
    let active = true;
    setPreviewError('');
    invoke<{ width: number; height: number; rgba: number[] }>('preview_cleanup', {
      bytes: art.bytes, removeBackground: settings.removeBackground,
      tolerance: settings.tolerance, cleanup: settings.cleanup,
    }).then(result => {
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('Preview unavailable');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
      setProcessed({ art, settings, url: canvas.toDataURL('image/png') });
    }).catch(err => { if (active) setPreviewError(String(err)); });
    return () => { active = false; };
  }, [art, settings, showProcessed, vector, processing, valid, processedUrl]);

  const acceptArtwork = useCallback((next: Art) => {
    setOcr(null);setApproved(null);setOcrAttempt(null);setOcrMessage('');
    setInspector('settings');
    setShowExport(false);
    setExportNotice('');
    setArt(next);
    setOriginal(next);
    setSettings({...defaults,useOwnedThreads:localStorage.getItem('studio-use-owned-threads')==='true'});
    setShowProcessed(next.mime === 'image/tiff');
    setError('');
    setGenerated(null);
    setFailed(null);
    setProcessed(null);
    setMode('compare');
    setPdf(null);
  }, []);

  async function chooseArtwork() {
    setBusy(true);
    setError('');
    try {
      const next = await invoke<Art | null>('choose_artwork');
      if(next?.mime==='application/pdf') {
        setPdf(new File([new Uint8Array(next.bytes)],next.name+'.pdf',{type:'application/pdf'}));
      } else if(next) acceptArtwork(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function readDrop(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (extension === 'pdf') { setPdf(file); setError(''); return; }
    const mime = artworkMimes[extension];
    if (!mime) { setError('Choose PNG, JPEG, SVG, WebP, BMP, TIFF, GIF, or PDF. For another format, export it as PNG first.'); return; }
    if (!file.size || file.size > 20_000_000) { setError('Artwork must be between 1 byte and 20 MB.'); return; }
    setBusy(true);
    try {
      acceptArtwork({ name: file.name, mime, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rotateArtwork() {
    if (!art) return;
    setBusy(true);
    setError('');
    const url = URL.createObjectURL(new Blob([new Uint8Array(art.bytes)], { type: art.mime }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16_000_000) throw Error('Artwork exceeds editing size limit');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalHeight;
      canvas.height = image.naturalWidth;
      const context = canvas.getContext('2d');
      if (!context) throw Error('Canvas unavailable');
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(result => result ? resolve(result) : reject(Error('Image conversion failed')), 'image/png'));
      setArt({ ...art, mime: 'image/png', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
      setShowProcessed(true);
    } catch (err) {
      setError(String(err));
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  useEffect(()=>{
    if(!art||vector||!autoOcr||ocrReady)return;
    let active=true;
    const request={art,removeBackground:settings.removeBackground,tolerance:settings.tolerance,cleanup:settings.cleanup};
    const timer=setTimeout(async()=>{
      setOcrBusy(true);setOcrMessage('Recognizing lettering locally…');
      try {
        const [lines,fonts]=await Promise.all([
          invoke<OcrLine[]>('recognize_artwork_lettering',{bytes:art.bytes,removeBackground:request.removeBackground,tolerance:request.tolerance,cleanup:request.cleanup}),
          invoke<string[]>('lettering_fonts')
        ]);
        if(!active)return;
        const result={art,settings,lines:lines.map(l=>({...l,enabled:true}))};
        setOcr(result);setApproved(result);setOcrFonts(fonts);
        setOcrMessage(lines.length? `${lines.length} text regions detected automatically. Expand Review lettering to make corrections.`:'No text regions detected; using normal artwork tracing.');
      } catch(err){if(active){setOcr(null);setApproved(null);setOcrMessage('Lettering recognition unavailable; normal tracing will continue. '+String(err));}}
      finally{if(active){setOcrAttempt(request);setOcrBusy(false);}}
    },250);
    return()=>{active=false;clearTimeout(timer);setOcrBusy(false);};
  },[art,vector,autoOcr,ocrReady,settings.removeBackground,settings.tolerance,settings.cleanup]);

  async function exportChosen(){
    if(!review||busy||compareBusy)return;
    const w=Number(exportWidth)*25.4,h=Number(exportHeight)*25.4;
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0){setExportNotice('Enter the usable hoop width and height.');return}
    setBusy(true);setExportNotice('');
    try{const saved=await invoke<boolean>('export_digitizer_variant',{id:review.id,strength:activeComparison?chosen:0,format:outputFormat,width:w,height:h});if(saved)setExportNotice('Embroidery file saved. Verify the hoop and thread sequence on your machine.');}
    catch(e){setExportNotice(String(e))}finally{setBusy(false)}
  }
  async function openDraft() {
    if (!review) return;
    setBusy(true);
    try {
      await invoke('apply_digitizer_draft', { id: review.id, strength:activeComparison?chosen:0 });
      sessionStorage.setItem('studio-digitizer-output-format',outputFormat);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof typeof defaults>(key: K, value: (typeof defaults)[K]) {
    setSettings(previous => ({ ...previous, [key]: value }));
  }

  const plan = activeComparison?.variants.find(variant => variant.strength === chosen)?.plan ?? review?.plan;
  const previewBox=useMemo(()=>{let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;for(const block of plan?.blocks??[])for(const run of block.runs)for(const [x,y] of run){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}if(!Number.isFinite(l))return [-1,-1,2,2];const padding=Math.max(2,Math.max(r-l,b-t)*.06);return [l-padding,t-padding,Math.max(1,r-l)+padding*2,Math.max(1,b-t)+padding*2]},[plan]);
  const colors = new Set(plan?.blocks.map(block => block.color.join(',')));
  const displayUrl = showProcessed ? processedUrl : artworkUrl;
  const stitchPaths=useMemo(()=>plan?.blocks.map(b=>b.runs.map(run=>run.map(p=>p.join(',')).join(' ')))??[],[plan]);

  return <div
    className={`lower digitizer-layout digitizer-stage-${art ? 3 : 0}`}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file && !busy) void readDrop(file);
    }}
  >
    {editing && art && <ArtworkEdit art={art} onClose={() => setEditing(false)} onApply={next => {
      setArt(next);
      setShowProcessed(true);
      setEditing(false);
    }} />}
    <article className="digitizer-controls">
      <h2>{art ? 'Automatic digitizing' : 'Choose artwork'}</h2><div className="digitizer-start-steps" aria-label="Digitizing progress">{['Import','Digitize','Review','Edit & export'].map((label,i)=><span key={label} aria-current={i===(!art?0:review?2:1)?'step':undefined}><b>{i+1}</b> {label}</span>)}</div>
      {art && <div className="digitizer-inspector-tabs" role="group" aria-label="Inspector view">{(['settings','quality','threads'] as const).map(t=><button key={t} aria-pressed={inspector===t} disabled={t!=='settings'&&!review} onClick={()=>setInspector(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>}
      <div hidden={!!art&&inspector!=='settings'} className="digitizer-inspector-content">
      {art && <p>{processing?'Generating stitches. Review the result before opening the editor.':review?'Next: compare artwork and stitches, check the Quality and Threads tabs, then open the design studio.':'Adjust settings or retry the generation.'}</p>}
      {art && settings !== defaults && <button type="button" onClick={()=>setSettings(defaults)}>Restore automatic settings</button>}
      <button className={art ? '' : 'artwork-import-zone'} disabled={busy} onClick={chooseArtwork}>
        <ImagePlus size={art ? 16 : 28} /> <strong>{art ? 'Choose another image or PDF' : 'Choose or drop an image'}</strong>{!art&&<span>Browse your computer to get started</span>}
      </button>
      {!art && <p>PNG, JPEG, SVG, WebP, BMP, TIFF, GIF or PDF. Digitizing starts as soon as you select artwork.</p>}
      {(!art || pdf) && <PdfArtwork onArt={acceptArtwork} droppedFile={pdf} />}
      {!art && <CharacterGallery onArt={acceptArtwork} />}
      {art && <>
        <label>Target embroidery format<select value={outputFormat} disabled={busy} onChange={e=>{setOutputFormat(e.target.value);localStorage.setItem('studio-digitizer-format',e.target.value)}}>{[['dst','DST · Poolin / Tajima'],['pes','PES · Brother / Baby Lock'],['pec','PEC · Brother'],['jef','JEF · Janome'],['exp','EXP · Melco / compatible machines'],['vp3','VP3 · Husqvarna Viking / Pfaff']].map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><small>{outputFormat==='dst'||outputFormat==='exp'?'Keep the native project and thread sequence for intended colors.':'Check format compatibility with your machine.'}</small>
        {!vector && <label>Width (inches) · {settings.widthMm.toFixed(1)} mm
          <input type="number" min={5 / 25.4} max={300 / 25.4} step=".01" disabled={busy}
            value={Number((settings.widthMm / 25.4).toFixed(3))}
            onChange={event => update('widthMm', Number(event.target.value) * 25.4)} />
        </label>}
        <FabricPicker value={settings.fabric} disabled={busy} onChange={fabric => update('fabric', fabric)}/>
        {!vector && <label><input type="checkbox" checked={settings.useOwnedThreads} disabled={!readThreads().some(t=>t.stock>0)} onChange={e=>{localStorage.setItem('studio-use-owned-threads',String(e.target.checked));update('useOwnedThreads',e.target.checked)}}/> Match my in-stock threads ({readThreads().filter(t=>t.stock>0).length})</label>}
        {!vector&&<section className="digitizer-options" aria-label="Artwork simplification">
          <h3>Simplify before digitizing</h3><small>Reduce tiny texture and traced detail before generating stitches. Preview the result to check lettering and outlines.</small>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
          {[{label:'Detailed',detail:80},{label:'Balanced',detail:50},{label:'Simplified',detail:20}].map(p=><button type="button" key={p.label} disabled={busy} aria-pressed={settings.detail===p.detail&&settings.cleanup} onClick={()=>setSettings(old=>({...old,detail:p.detail,cleanup:true}))}>{p.label}</button>)}
          </div>
          <button type="button" aria-pressed={settings.cleanup&&settings.colors===4} onClick={()=>setSettings(old=>({...old,cleanup:true,colors:4,detail:35}))}>Simplify textured mockup & colors</button>
        </section>}
        {!vector && <details className="digitizer-options">
          <summary>Advanced artwork options</summary>
          <fieldset disabled={busy}>
            <div className="digitizer-thread-picker" role="group" aria-label="Thread colors">
              <span>Thread colors</span>
              <div>{[0,2,3,4,5,6,7,8,9,10].map(count=>
                <button type="button" key={count} aria-pressed={settings.colors===count}
                  onClick={()=>update('colors',count)}>{count||'Auto'}</button>
              )}</div>
            </div>
            <label><input type="checkbox" checked={settings.cleanup} onChange={event => update('cleanup', event.target.checked)} /> Clean textured artwork</label>
            <label><input type="checkbox" checked={settings.removeBackground} onChange={event => update('removeBackground', event.target.checked)} /> Remove connected background</label>
            {settings.removeBackground && <label>Background sensitivity · {settings.tolerance}
              <input type="range" min="8" max="100" value={settings.tolerance} onChange={event => update('tolerance', Number(event.target.value))} />
            </label>}
            <label><input type="checkbox" checked={settings.thinLines} onChange={event => update('thinLines', event.target.checked)} /> Trace fine lines</label>
            <label>Detail · {settings.detail}%<input type="range" min="0" max="100" value={settings.detail} onChange={event => update('detail', Number(event.target.value))} /></label>
            {art.mime !== 'image/tiff' && <>
              <button onClick={() => setEditing(true)}>Crop or erase</button>
              <button onClick={rotateArtwork}>Rotate 90°</button>
            </>}
            {art !== original && <button onClick={() => setArt(original)}>Restore original</button>}
          </fieldset>
        </details>}
        {!vector&&<section className="digitizer-options" aria-label="Automatic lettering recognition">
          <h3>Automatic lettering recognition</h3>
          <small>Offline · converts traced text into editable lettering.</small>
          <label><input type="checkbox" checked={autoOcr} onChange={e=>{setAutoOcr(e.target.checked);setOcrAttempt(null);setApproved(null);setOcrMessage('');}}/> Automatically recognize and reconstruct lettering</label>
          {ocrBusy&&<small role="status">Detecting text and matching fonts…</small>}
          {ocrMessage&&<p role="status">{ocrMessage}</p>}
          {autoOcr&&activeOcr&&<details style={{border:'1px solid var(--border,#ddd)',borderRadius:8,padding:8}}>
            <summary style={{cursor:'pointer',fontWeight:600}}>Review lettering · {activeOcr.lines.filter(l=>l.enabled).length}/{activeOcr.lines.length} selected</summary>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
              <button type="button" onClick={()=>setOcr({...activeOcr,lines:activeOcr.lines.map(l=>({...l,enabled:true}))})}>Select all</button>
              <button type="button" onClick={()=>setOcr({...activeOcr,lines:activeOcr.lines.map(l=>({...l,enabled:false}))})}>Keep all traced</button>
            </div>
            {activeOcr.lines.map((line,i)=><details key={i} style={{padding:'6px 0',borderBottom:'1px solid var(--border,#ddd)'}}>
              <summary style={{cursor:'pointer',fontSize:13}}>{line.enabled?'Replace':'Keep traced'} · {line.text||'Empty region'}</summary>
              <label><input type="checkbox" checked={line.enabled} onChange={e=>setOcr({...activeOcr,lines:activeOcr.lines.map((l,j)=>j===i?{...l,enabled:e.target.checked}:l)})}/> Replace with editable text</label>
              <input aria-label={'Recognized text '+(i+1)} value={line.text} onChange={e=>setOcr({...activeOcr,lines:activeOcr.lines.map((l,j)=>j===i?{...l,text:e.target.value}:l)})}/>
              <select aria-label={'Font for region '+(i+1)} value={line.font} onChange={e=>setOcr({...activeOcr,lines:activeOcr.lines.map((l,j)=>j===i?{...l,font:e.target.value}:l)})}>{ocrFonts.map(font=><option key={font}>{font}</option>)}</select>
            </details>)}
            <button type="button" disabled={busy||processing} onClick={()=>{setApproved(activeOcr);setMode('compare')}}>Update lettering preview</button>
          </details>}
          {selected&&<button type="button" onClick={()=>{setAutoOcr(false);setApproved(null);setOcrMessage('Using original traced lettering.')}}>Restore traced lettering</button>}
        </section>}
      </>}
      </div>
            {!valid && <p role="alert">Width must be between 5 and 300 mm.</p>}
      {(error || generationError) && <p role="alert">{error || generationError}</p>}
      {generationError && !vector && settings.removeBackground && generationError.includes('No foreground') &&
        <button onClick={() => update('removeBackground', false)}>Retry with background</button>}
      {review && <>
        <div hidden={inspector!=='quality'} className="digitizer-inspector-content">
        <h3>Stitch quality</h3>
        {review.optimization&&<section className="digitizer-quality-summary" aria-label="Automatic optimization results"><strong>Automatic density optimization applied</strong><div><span>Original plan</span><b>{review.optimization[0].toLocaleString()}</b></div><div><span>Optimized plan</span><b>{review.optimization[1].toLocaleString()}</b></div><div><span>Stitch points saved</span><b>{(review.optimization[0]-review.optimization[1]).toLocaleString()} ({(100*(review.optimization[0]-review.optimization[1])/Math.max(1,review.optimization[0])).toFixed(1)}%)</b></div><small>The alternative passed automated geometry and stitch-count comparisons. Test sew to confirm coverage.</small></section>}
        <section className="digitizer-quality-summary" aria-label="Design preflight">
          <strong>{review.warnings.length || review.quality.long || review.quality.zero ? 'Review recommended' : 'No flagged geometry issues'}</strong>
          <small>Automated geometry checks are not a substitute for a test sew.</small>
          <div><span>Unique threads</span><b>{new Set(review.plan.blocks.map(b=>b.color.join(','))).size}</b></div>
          <div><span>Trims per 1,000 points</span><b>{(1000*review.plan.trims/Math.max(1,review.plan.stitches)).toFixed(1)}</b></div>
          <div><span>Long segments</span><b>{review.quality.long}</b></div>
          <div><span>Near-zero segments</span><b>{review.quality.zero}</b></div>
          <button type="button" onClick={()=>setMode('density')}>Inspect needle density</button>
        </section>
        <div className="digitize-metrics">
          <div><strong>{review.plan.stitches.toLocaleString()}</strong><small>Stitch points</small></div>
          <div><strong>{review.plan.blocks.length}</strong><small>Color blocks</small></div>
          <div><strong>{review.plan.trims}</strong><small>Planned trims</small></div>
        </div>
        <p>{(review.quality.sewn_mm / 1000).toFixed(2)} m of sewn path</p>
        <p>DST preview · {review.jumps} jumps · {review.color_changes} color changes</p>

        <p>About {(review.dst_stitches / 600).toFixed(1)} minutes of needle time at 600 stitches/min,
          excluding travel and stops.</p>
        {(review.quality.short > 0 || review.quality.long > 0 || review.quality.zero > 0) &&
          <p>{review.quality.short} short, {review.quality.long} long, and {review.quality.zero} near-zero segments.</p>}
        {review.warnings.length > 0 && <ul>{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <div className="review-palette" aria-label="Generated thread colors">
          {Array.from(colors, rgb => <span key={rgb} title={`RGB ${rgb}`} style={{ background: `rgb(${rgb})` }} />)}
        </div>
        </div>
        <div hidden={inspector!=='threads'} className="digitizer-inspector-content">        <section className="digitizer-options">
          <h3>Thread setup · {new Set(review.plan.blocks.map(b=>b.color.join(','))).size} unique colors</h3>
          <h4>Thread usage by color</h4><small>Estimated sewn path only; excludes bobbin, tails and waste.</small><div className="digitizer-quality-summary">{threadUsage.map((t,i)=><div key={t.key}><span><span style={{display:'inline-block',width:12,height:12,border:'1px solid #888',borderRadius:3,background:`rgb(${t.key})`,marginRight:6}}/>Slot {i+1}</span><b>{t.meters.toFixed(2)} m</b></div>)}</div>
          <p>Follow this sewing order on your machine. Repeated colors reuse the same thread slot. DST does not store thread colors.</p>
          <div style={{maxHeight:280,overflow:'auto'}}>
          {review.plan.blocks.map((b,i)=>{
            const key=b.color.join(',');
            const unique=Array.from(new Set(review.plan.blocks.map(x=>x.color.join(','))));
            const hex='#'+b.color.map(v=>v.toString(16).padStart(2,'0')).join('');
            const owned=readThreads().find(t=>t.stock>0&&t.color.toLowerCase()===hex);
            return <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0'}}>
              <span style={{width:24,height:24,borderRadius:5,border:'1px solid #999',background:hex,flexShrink:0}}/>
              <span>{i+1}. Slot {unique.indexOf(key)+1} · {owned?[owned.brand,owned.code,owned.name].filter(Boolean).join(' '):hex.toUpperCase()}</span>
            </div>
          })}
          </div>
          <button type="button" onClick={()=>{
            const unique=Array.from(new Set(review.plan.blocks.map(b=>b.color.join(','))));
            const rows=review.plan.blocks.map((b,i)=>{
              const hex='#'+b.color.map(v=>v.toString(16).padStart(2,'0')).join('');
              const t=readThreads().find(t=>t.stock>0&&t.color.toLowerCase()===hex);
              return [i+1,unique.indexOf(b.color.join(','))+1,hex,t?.brand||'',t?.code||'',t?.name||''];
            });
            const csv=[['Sewing order','Suggested thread slot','RGB','Brand','Thread number','Name'],...rows].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
            const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
            const link=document.createElement('a');link.href=url;link.download=(art?.name||'design')+'-thread-sequence.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
          }}>Download thread sequence CSV</button>
        </section></div>
      </>}
    </article>
    <article className={`artwork-preview review-${mode === 'density' || mode === 'thread' ? 'stitches' : mode}`}>
      <div className="preview-heading"><div><small>DESIGN REVIEW</small><strong title={art?.name}>{art?.name}</strong></div><span className="digitizer-preview-state" role="status">{processing?"Generating":review?"Preview ready":"Artwork"}</span></div>
      {review&&<section className="digitizer-variant-review" aria-label="Compare embroidery-ready designs"><div className="digitizer-variant-heading"><div><strong>Choose your stitch plan</strong><small>Compare actual stitch paths before editing or exporting.</small></div>{compareBusy&&<span role="status">{currentDeepRequest?'Checking fill directions, spacing and solid artwork…':'Optimizing alternatives…'}</span>}</div>{compareError&&<p role="status">Alternative preview unavailable: {compareError}. Original still available.</p>}<DigitizerVariants base={review.plan} variants={activeComparison?.variants??[]} chosen={chosen} recommended={recommended} onChoose={setChosen}/><div className="digitizer-review-actions">{!activeComparison?.deep&&<button disabled={busy||compareBusy} onClick={()=>setDeepRequest({id:review.id})}>Deep optimization</button>}<button disabled={busy||compareBusy} onClick={()=>setShowExport(v=>!v)}>Export {outputFormat.toUpperCase()}</button><button className="primary" disabled={busy||compareBusy} onClick={openDraft}>Open in design studio <ArrowRight size={16}/></button></div>{showExport&&<div className="digitizer-direct-export"><strong>Confirm usable sewing field</strong><div className="workspace-hoop-fields"><label>Width (in)<input type="number" min=".1" step=".01" value={exportWidth} onChange={e=>setExportWidth(e.target.value)}/></label><label>Height (in)<input type="number" min=".1" step=".01" value={exportHeight} onChange={e=>setExportHeight(e.target.value)}/></label></div><small>Use the machine's usable sewing field, not the hoop's outer dimensions. DST does not preserve exact thread colors.</small><button className="primary" disabled={busy||compareBusy||!(Number(exportWidth)>0&&Number(exportHeight)>0)} onClick={()=>void exportChosen()}>Save {outputFormat.toUpperCase()} file</button>{exportNotice&&<p role="status">{exportNotice}</p>}</div>}<small>The Quality report and density heatmap describe the original plan.</small></section>}
      {plan&&<div className="digitizer-preview-metrics"><div><small>Stitch points</small><strong>{plan.stitches.toLocaleString()}</strong></div><div><small>Unique colors</small><strong>{colors.size}</strong></div><div><small>Color blocks</small><strong>{plan.blocks.length}</strong></div><div><small>Trims</small><strong>{plan.trims}</strong></div></div>}<div className="review-switch" role="group" aria-label="Preview options">
        {(['compare', 'stitches', 'original'] as const).map(view =>
          <button key={view} aria-pressed={mode === view} onClick={() => setMode(view)}>
            {view === 'compare'
              ? <><Columns2 size={15} /> Compare</>
              : view === 'stitches'
                ? <><Layers2 size={15} /> Stitches</>
                : <><ArtworkIcon size={15} /> Artwork</>}
          </button>)}
        {review && <button aria-pressed={mode === 'thread'} onClick={() => setMode('thread')}><Layers2 size={15} /> Thread view</button>}
        {review && <button aria-pressed={mode === 'density'} onClick={() => setMode('density')} title="Inspect where the needle penetrates most often"><ChartNoAxesColumn size={15} /> Density</button>}
        {!vector && <button aria-pressed={showProcessed} onClick={() => setShowProcessed(value => !value)} title="Show the artwork after cleanup">Processed</button>}
      </div>
      <h3 className="source-heading">{showProcessed ? 'Processed artwork' : 'Original artwork'}</h3>
      {displayUrl && (showProcessed || original?.mime !== 'image/tiff') &&
        <img src={displayUrl} alt={showProcessed ? 'Processed artwork' : 'Original artwork'} className="digitizer-source-image" />}
      {showProcessed && !displayUrl && mode !== 'stitches' && <p>{previewError || 'Preparing artwork preview…'}</p>}
      {processing && <>
        <h3 className="stitch-heading">Generating stitch paths</h3>
        <div className="digitizer-stitch-image digitizer-processing" role="status" aria-live="polite">
          <div className="digitizer-processing-orbit" aria-hidden="true"><span>✦</span></div>
          <strong>Digitizing your artwork</strong>
          <p>Analyzing shapes, thread colors and stitch paths.</p>
          <small>Complex artwork may take a little longer.</small>
          <div className="digitizer-processing-dots" aria-hidden="true"><i/><i/><i/></div>
        </div>
      </>}
      {!processing && plan && <>
        <h3 className="stitch-heading">{mode === 'density' ? 'Densest 1 mm² cells · DST preview' : 'Generated stitch paths'}</h3>
        <svg aria-label="Generated stitches" viewBox={previewBox.join(' ')} className={`digitizer-stitch-image ${mode === 'thread' ? 'digitizer-thread-view' : ''}`}>
          {mode === 'density' && review ? review.density.map(([x, y, count]) =>
            <rect key={x + ',' + y} x={x} y={y} width="1" height="1" fill="#6945A2"
              opacity={0.15 + 0.85 * count / (review.density[0]?.[2] || 1)}>
              <title>{count} needle penetrations in this square millimeter</title>
            </rect>) : plan.blocks.map((block, index) => <g key={index} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth={mode==="thread"?".43":".3"} strokeLinecap="round" strokeLinejoin="round">
            {block.runs.map((_, i) => <polyline key={i} points={stitchPaths[index]?.[i]} />)}
          </g>)}
        </svg>
      </>}
    </article>
  </div>;
}

function DigitizerVariants({base,variants,chosen,recommended,onChoose}:{base:Plan;variants:{strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[];chosen:number;recommended:number;onChoose:(n:number)=>void}){
 const all=[{strength:0,plan:base,reason:null,quality:null},...variants];
 const view=useMemo(()=>{let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;for(const v of all)for(const block of v.plan?.blocks??[])for(const run of block.runs)for(const [x,y] of run){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}return Number.isFinite(l)?[l-3,t-3,Math.max(6,r-l+6),Math.max(6,b-t+6)].join(' '):'0 0 100 100'},[base,variants]);
 const speed=Math.max(100,Math.min(1500,Number(localStorage.getItem('studio-sewing-spm'))||800));const tr=Number(localStorage.getItem('studio-trim-seconds')??3);const ch=Number(localStorage.getItem('studio-change-seconds')??8);const trim=Number.isFinite(tr)?tr:3,change=Number.isFinite(ch)?ch:8;
 const minutes=(p:Plan)=>p.stitches/speed+p.trims*trim/60+Math.max(0,p.blocks.length-1)*change/60;
 const fastest=all.filter(v=>v.plan).reduce((a,b)=>minutes(a.plan!)<=minutes(b.plan!)?a:b);
 return <><div className="digitizer-variant-grid">{all.map(v=><button type="button" key={v.strength} disabled={!v.plan} aria-pressed={chosen===v.strength} onClick={()=>onChoose(v.strength)} className="digitizer-variant-card"><strong>{['Original','Gentle','Balanced','Maximum','Solid silhouette','Fast Stitch'][v.strength]}</strong>{v.plan?<><svg viewBox={view} aria-label="Stitch paths">{v.plan.blocks.map((b,i)=><g key={i} fill="none" stroke={'rgb('+b.color.join(',')+')'} strokeWidth=".3" strokeLinecap="round">{b.runs.map((run,j)=><polyline key={j} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg><b>{v.plan.stitches.toLocaleString()} stitches</b><span>{v.plan.trims} trims · ~{Math.ceil(minutes(v.plan))} min</span>{v.quality&&<small>{Math.round(v.quality.coverage)}% stitch footprint overlap · peak {v.quality.density_peak}/mm²</small>}{v.strength===recommended&&<small>Recommended · automatic selection</small>}{v.strength===fastest.strength&&<small>Fastest available</small>}{v.strength>0&&<small>{v.plan.stitches<base.stitches?Math.round((base.stitches-v.plan.stitches)/base.stitches*100)+'% fewer stitches · ':''}{Math.round(Math.abs(minutes(base)-minutes(v.plan))/Math.max(.01,minutes(base))*100)}% {minutes(v.plan)<=minutes(base)?'less':'more'} estimated time</small>}</>:<small title={v.reason??''}>No eligible improvement</small>}</button>)}</div><small>Estimates: {speed} stitches/min, {trim} sec/trim, {change} sec/color change. Test sew for coverage.</small></>
}
