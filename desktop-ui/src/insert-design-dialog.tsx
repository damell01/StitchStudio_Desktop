import {thumbnailOf,type Project} from './library';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Crosshair, FileInput, FolderOpen, Image, LayoutGrid, Plus, Search, X } from 'lucide-react';
import { CharacterGallery } from './character-gallery';
import { compareNames, ListNavigation, matchesName, usePagedList } from './list-navigation';
import { TemplateAttribution, TemplateLibrary, type Template } from './templates';
import { importToLibrary, type LibraryImportSource } from './library-import';
import './insert-design-dialog.css';

type Artwork = { name: string; mime: string; bytes: number[] };
type Source = 'templates' | 'personal' | 'artwork' | 'layouts' | 'approved';
type Selection =
  | { source: 'templates'; template: Template }
  | { source: 'layouts'; file: string }
  | { source: 'approved'; project: Project }
  | { source: 'personal'; file: string | null }
  | { source: 'artwork'; art: Artwork };

type StitchPreview = {
  stitches: number;
  blocks: { color: number[]; runs: number[][][] }[];
};

const MM_PER_INCH = 25.4;
const sources = [
  { id: 'templates', label: 'Templates', icon: LayoutGrid },
  { id: 'layouts', label: 'Saved layouts', icon: LayoutGrid },
  { id: 'personal', label: 'My designs', icon: FolderOpen },
  { id: 'approved', label: 'Digitized designs', icon: LayoutGrid },
  { id: 'artwork', label: 'Artwork', icon: Image },
] as const;

function ApprovedPreview({file}:{file:string}){
 const [image,setImage]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let active=true;setImage('');setError('');invoke<StitchPreview>('project_thumbnail',{file}).then(p=>{if(active)setImage(thumbnailOf(p))}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[file]);
 return image?<img src={image} alt="Approved stitch preview"/>:<small>{error||'Loading stitch preview…'}</small>;
}
function ArtworkPreview({art}: {art: Artwork}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const source = URL.createObjectURL(new Blob([new Uint8Array(art.bytes)], {type: art.mime}));
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [art]);
  return url ? <img src={url} alt={art.name}/> : null;
}

function TemplatePreview({ template, widthMm }: { template: Template; widthMm: number | null }) {
  const [preview, setPreview] = useState<StitchPreview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (widthMm === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void invoke<StitchPreview>('preview_template', { id: template.id, art: template.art, widthMm })
        .then(result => { if (active) setPreview(result); })
        .catch(error => { if (active) setError(String(error)); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [template, widthMm]);

  if (!preview || widthMm === null) return <>
    <svg viewBox="0 0 100 100" role="img" aria-label={template.name} dangerouslySetInnerHTML={{ __html: template.art }} />
    {widthMm !== null && <small>{error ? 'Stitch preview unavailable' : 'Generating stitch preview…'}</small>}
  </>;
  return <>
    <svg viewBox={`${-widthMm / 2} ${-widthMm / 2} ${widthMm} ${widthMm}`} role="img" aria-label={`${template.name} stitch preview`}>
      {preview.blocks.map((block, index) => <g key={index} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth=".28">
        {block.runs.map((run, runIndex) => <polyline key={runIndex} points={run.map(point => point.join(',')).join(' ')} />)}
      </g>)}
    </svg>
    <small>{preview.stitches.toLocaleString()} stitch points · {preview.blocks.length} colors</small>
  </>;
}

export function InsertDesignDialog<Plan>({ dialogRef, onInsert, anchorBounds, editorBusy=false }: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onInsert: (plan: Plan) => void;
  anchorBounds?: number[] | null;
  editorBusy?: boolean;
}) {
  const [source, setSource] = useState<Source>('templates');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [approved,setApproved]=useState<Project[]>([]);
  const [category,setCategory]=useState('all');
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const approvedPage=usePagedList(approved.filter(p=>matchesName(p.name+' '+(p.category??'Uncategorized'),query)&&(category==='all'||(p.category??'Uncategorized')===category)).sort((a,b)=>compareNames(a.name,b.name)),JSON.stringify([query,category]),36);
  const [width, setWidth] = useState('2');
  const [artAspect,setArtAspect]=useState<number|null>(null);
  const selectedArt=selection?.source==='artwork'?selection.art:null;
  useEffect(()=>{
    setArtAspect(null);
    if(!selectedArt)return;
    let active=true;
    const url=URL.createObjectURL(new Blob([new Uint8Array(selectedArt.bytes)],{type:selectedArt.mime}));
    const image=new window.Image();
    image.onload=()=>{if(active&&image.naturalWidth>0&&image.naturalHeight>0)setArtAspect(image.naturalHeight/image.naturalWidth)};
    image.src=url;
    return()=>{active=false;URL.revokeObjectURL(url)};
  },[selectedArt]);

  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [offset, setOffset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const page = usePagedList(files.filter(file => matchesName(file, query)).sort(compareNames), query, 36);
  const widthMm = Number(width) * MM_PER_INCH;
  const widthValid = widthMm >= 5 && widthMm <= 250;
  const xMm = offset ? Number(x) * MM_PER_INCH : 0;
  const yMm = offset ? Number(y) * MM_PER_INCH : 0;
  const offsetValid = Math.abs(xMm) <= 500 && Math.abs(yMm) <= 500;
  const name = selection?.source === 'approved' ? selection.project.name : selection?.source === 'templates' ? selection.template.name :
    selection?.source === 'personal' ? selection.file ?? 'Machine file from disk' :
    selection?.source === 'artwork' ? selection.art.name : selection?.source === 'layouts' ? selection.file.replace(/\.stitchstudio$/,'') : '';

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (error) { setError(String(error)); }
    finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function chooseArtwork(file:File){
    if(!/\.(png|jpe?g|webp|bmp|svg)$/i.test(file.name)){setError('Choose PNG, JPEG, WebP, BMP or SVG artwork.');return;}
    if(file.size>25*1024*1024){setError('Artwork must be under 25 MB.');return;}
    void run(async()=>{
      const mime=/\.svg$/i.test(file.name)?'image/svg+xml':file.type||'application/octet-stream';
      setSource('artwork');
      setSelection({source:'artwork',art:{name:file.name,mime,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))}});
    });
  }

  useEffect(()=>{
    const receive=(event:DragEvent)=>{
      if(editorBusy||event.defaultPrevented||!event.dataTransfer?.types.includes('Files')||lock.current)return;
      const file=event.dataTransfer.files[0];
      if(!file||!/\.(png|jpe?g|webp|bmp|svg)$/i.test(file.name))return;
      event.preventDefault();
      if(!dialogRef.current?.open)dialogRef.current?.showModal();
      chooseArtwork(file);
    };
    const allow=(event:DragEvent)=>{
      if(event.dataTransfer?.types.includes('Files')&&!lock.current)event.preventDefault();
    };
    window.addEventListener('dragover',allow);
    window.addEventListener('drop',receive);
    return()=>{window.removeEventListener('dragover',allow);window.removeEventListener('drop',receive)};
  },[dialogRef,editorBusy]);

  async function loadFiles() {
    setFiles(await invoke<string[]>('personal_designs'));
  }

  function chooseSource(next: Source) {
    if (next !== source) {setSelection(null);setFiles([]);setQuery('');}
    setSource(next);
    setError('');
    setMessage('');
    if (next === 'personal') void run(loadFiles);
    if(next==='approved')void run(async()=>setApproved(await invoke<Project[]>('approved_batch_projects')));
    if (next === 'layouts') void run(async()=>setFiles(await invoke<string[]>('saved_templates')));
  }

  function importFiles(source: LibraryImportSource) {
    void run(async () => {
      const result = await importToLibrary(source);
      if (result === null) return;
      await loadFiles();
      setMessage(result);
    });
  }

  function insert(candidate = selection) {
    if (!candidate || !offsetValid || ((candidate.source === 'templates' || candidate.source === 'artwork') && !widthValid)) return;
    void run(async () => {
      const position = { xMm, yMm };
      const result = candidate.source === 'approved' ? await invoke<Plan>('insert_approved_design',{...position,file:candidate.project.file}) : candidate.source === 'templates'
        ? await invoke<Plan>('insert_template', { ...position, id: candidate.template.id, art: candidate.template.art, widthMm })
        : candidate.source === 'artwork'
          ? await invoke<Plan>(candidate.art.mime==='image/svg+xml'?'insert_svg_artwork':'insert_character', { ...position, bytes: candidate.art.bytes, name: candidate.art.name, widthMm })
          : candidate.source === 'layouts' ? await invoke<Plan>('insert_saved_template',{...position,file:candidate.file})
          : await invoke<Plan | null>('insert_embroidery', { ...position, file: candidate.file });
      if (!result) return;
      onInsert(result);
      dialogRef.current?.close();
    });
  }

  return <dialog ref={dialogRef} className="studio-modal studio-insert" aria-labelledby="studio-insert-title"
    onCancel={event => { if (lock.current) event.preventDefault(); }}>
    <div className="studio-insert-header">
      <div>
        <h2 id="studio-insert-title">Insert a design</h2>
        <p>Choose a design to add to the current project.</p>
      </div>
      <button aria-label="Close design browser" disabled={busy} onClick={() => dialogRef.current?.close()}><X size={18}/></button>
    </div>
    <div className="studio-insert-layout">
      <section className="studio-insert-library" aria-label="Design sources" inert={busy}>
        <div className="studio-insert-sources" role="group" aria-label="Design source">
          {sources.map(({ id, label, icon: Icon }) =>
            <button key={id} aria-pressed={source === id} onClick={() => chooseSource(id)}><Icon size={16}/> {label}</button>
          )}
        </div>
        {source === 'templates' && <TemplateLibrary
          selectedId={selection?.source === 'templates' ? selection.template.id : undefined}
          onPreview={template => { setSelection({ source, template }); setError(''); }} />}
        {source === 'artwork' && <div className="studio-insert-files" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files[0])chooseArtwork(e.dataTransfer.files[0])}}>
          <label>Drop artwork here or browse<input type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,.svg" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];if(file)chooseArtwork(file);e.currentTarget.value=''}}/></label>
          <small>Preview artwork, choose its size and placement, then insert without replacing your design.</small>
        </div>}
        {source === 'artwork' && <CharacterGallery actionLabel="Select design" onArt={art => { setSelection({ source, art }); setError(''); }} />}
        {source==='approved'&&<><select aria-label="Design category" value={category} onChange={e=>{setCategory(e.target.value);setSelection(null)}}><option value="all">All categories</option>{Array.from(new Set(approved.map(p=>p.category??'Uncategorized'))).sort().map(c=><option key={c}>{c}</option>)}</select><label className="studio-insert-search"><Search size={16}/><input placeholder="Search digitized designs" value={query} onChange={e=>setQuery(e.target.value)}/></label>{!approvedPage.total&&<p>{approved.length?'No matching designs.':'Approve artwork in Bulk Design Import to add reusable designs here.'}</p>}<div className="approved-insert-grid">{approvedPage.items.map(project=><button key={project.file} aria-pressed={selection?.source==='approved'&&selection.project.file===project.file} onClick={()=>setSelection({source:'approved',project})}><ApprovedPreview file={project.file}/><strong>{project.name}</strong><small>{project.category??'Uncategorized'}</small><small>{project.stitches.toLocaleString()} stitches</small></button>)}</div><ListNavigation {...approvedPage}/></>}
        {source === 'layouts' && <>
          <label className="studio-insert-search"><Search size={16}/><input placeholder="Find a saved layout" aria-label="Search saved layouts"
            value={query} onChange={event=>setQuery(event.target.value)}/></label>
          {!page.total&&<p>{files.length?'No layouts match your search.':'Import editable .stitchstudio projects under Template Library to use them here.'}</p>}
          <div className="studio-insert-file-list">
            {page.items.map(file=><button key={file} aria-pressed={selection?.source==='layouts'&&selection.file===file}
              onClick={()=>{setSelection({source,file});setError('');}}><LayoutGrid size={16}/>{file.replace(/\.stitchstudio$/,'')}</button>)}
          </div>
          <ListNavigation {...page}/>
        </>}
        {source === 'personal' && <>
          <div className="studio-insert-files">
            <button disabled={!offsetValid} onClick={() => insert({ source, file: null })}>
              <FileInput size={17}/> Choose file from disk
            </button>
            <button onClick={() => importFiles('files')}>Import files to library</button>
            <button onClick={() => importFiles('folder')}>Import folder</button>
            <button onClick={() => importFiles('zip')}>Import ZIP</button>
          </div>
          <label className="studio-insert-search"><Search size={16}/><input placeholder="Find a saved design" aria-label="Search personal designs"
            value={query} onChange={event => setQuery(event.target.value)}/></label>
          {!page.total && <p>{files.length ? 'No designs match your search.' : 'No saved designs. Import a file or folder to build your library.'}</p>}
          <div className="studio-insert-file-list">
            {page.items.map(file => <button key={file} aria-pressed={selection?.source === 'personal' && selection.file === file}
              onClick={() => { setSelection({ source, file }); setError(''); }}><FileInput size={16}/> {file}</button>)}
          </div>
          <ListNavigation {...page}/>
        </>}
      </section>
      <section className="studio-insert-placement" aria-label="Design placement">
        <h3>{name || 'Choose a design'}</h3>
        <div className="studio-insert-preview">
          {selection?.source === 'approved' ? <ApprovedPreview file={selection.project.file}/> : selection?.source === 'templates'
            ? <TemplatePreview key={`${selection.template.id}/${widthMm}`} template={selection.template} widthMm={widthValid ? widthMm : null} />
            : selection?.source === 'artwork' ? <ArtworkPreview art={selection.art}/>
            : selection?.source === 'personal' ? <FileInput size={34}/> : <Crosshair size={34}/>}
        </div>
        {selection?.source==='artwork'&&selection.art.mime==='image/svg+xml'&&<p>Original vector artwork. Stitches are generated at your chosen width when inserted. Add or edit names separately using lettering.</p>}
        {selection?.source === 'templates' && <TemplateAttribution template={selection.template}/>}
        {selection?.source === 'personal'
          ? <p>Machine files keep their original size.</p>
          : selection?.source === 'approved' ? <p>Editable design is inserted at its saved size; resize after insertion.</p> : selection?.source === 'layouts' ? <p>Layouts keep their original size and internal arrangement.</p> : <label>Width (in)
              <input type="number" value={width} min=".2" max="9.84" step="any" disabled={busy}
                onChange={event => setWidth(event.target.value)} aria-invalid={!widthValid}/>
              {!widthValid && <small>Enter a width from 5 to 250 mm.</small>}
              {artAspect!==null&&widthValid&&<small>Estimated height: {(Number(width)*artAspect).toFixed(2)} in</small>}
            </label>}
        {anchorBounds&&widthValid&&<div className="studio-insert-files" role="group" aria-label="Placement relative to existing design">
          <strong>Place relative to existing design</strong>
          {(['above','below','left','right','center'] as const).map(side=><button key={side} disabled={busy} onClick={()=>{
            const [ax,ay,aw,ah]=anchorBounds;
            const radius=widthMm/2+3;
            const verticalRadius=widthMm*(artAspect??1)/2+3;
            const cx=side==='left'?ax-radius:side==='right'?ax+aw+radius:ax+aw/2;
            const cy=side==='above'?ay-verticalRadius:side==='below'?ay+ah+verticalRadius:ay+ah/2;
            setOffset(true);setX((cx/MM_PER_INCH).toFixed(3));setY((cy/MM_PER_INCH).toFixed(3));
          }}>{side==='center'?'Overlay center':side[0].toUpperCase()+side.slice(1)+' design'}</button>)}
          <small>Suggested spacing uses artwork proportions when available. Check placement after insertion.</small>
        </div>}
        <div className="studio-insert-files" role="group" aria-label="Quick placement">
          <button disabled={busy} onClick={()=>{setOffset(false);setX('0');setY('0')}}>Hoop center</button>
          <button disabled={busy||!widthValid} onClick={()=>{setOffset(true);setX('0');setY(String(-Number(width)*0.65))}}>Above center</button>
          <button disabled={busy||!widthValid} onClick={()=>{setOffset(true);setX('0');setY(String(Number(width)*0.65))}}>Below center</button>
          <button disabled={busy||!widthValid} onClick={()=>{setOffset(true);setX(String(-Number(width)*0.65));setY('0')}}>Left of center</button>
          <button disabled={busy||!widthValid} onClick={()=>{setOffset(true);setX(String(Number(width)*0.65));setY('0')}}>Right of center</button>
        </div>
        <small>Quick positions are relative to the hoop. Fine-tune placement using the offsets or canvas after insertion.</small>
        <label className="studio-insert-offset"><input type="checkbox" checked={offset} disabled={busy}
          onChange={event => setOffset(event.target.checked)}/> Offset from hoop center</label>
        {offset && <div className="studio-insert-offset-fields">
          <label>Right (in)<input type="number" step="any" value={x} disabled={busy} onChange={event => setX(event.target.value)}/></label>
          <label>Down (in)<input type="number" step="any" value={y} disabled={busy} onChange={event => setY(event.target.value)}/></label>
        </div>}
        {!offsetValid && <p>Offsets must be within 500 mm of the hoop center.</p>}
      </section>
    </div>
    <footer className="studio-insert-footer">
      {error ? <p role="alert">{error}</p> : <p role="status">{busy ? 'Working…' : message || (offset ? 'Custom placement' : 'Centered in hoop')}</p>}
      <button className="primary" onClick={() => insert()}
        disabled={busy || !selection || !offsetValid || ((selection.source === 'templates' || selection.source === 'artwork') && !widthValid)}>
        <Plus size={17}/> Insert design
      </button>
    </footer>
  </dialog>;
}
