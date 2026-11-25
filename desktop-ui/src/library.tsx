import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { File, FileArchive, FilePlus, FolderOpen, Search } from 'lucide-react';
import { CharacterGallery, type Art } from './character-gallery';
import { confirmAction } from './dialogs';
import { importToLibrary, type LibraryImportSource } from './library-import';

export type Project = { file: string; name: string; stitches: number; colors: number; width: number; height: number; modified: number; created?: number; thumbnail?: string };
function ProjectDates({project,compact=false}:{project:Project;compact?:boolean}){
  const format=(value:number)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value*1000));
  const valid=(value:number|undefined):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&Number.isFinite(new Date(value*1000).getTime());
  return <div className="project-dates">
    {valid(project.modified)?<time dateTime={new Date(project.modified*1000).toISOString()} title={'Last modified: '+format(project.modified)}><span>Modified</span> {format(project.modified)}</time>:<small>Modified date unavailable</small>}
    {!compact&&valid(project.created)&&<time dateTime={new Date(project.created*1000).toISOString()}><span>Created</span> {format(project.created)}</time>}
  </div>;
}

type ThumbnailPlan={stitches:number;blocks:{color:number[];runs:number[][][]}[]};
export function rememberProject(project:Project){try{const previous:Project[]=JSON.parse(localStorage.getItem('studio-recent-projects')||'[]');localStorage.setItem('studio-recent-projects',JSON.stringify([project,...previous.filter(p=>p.file!==project.file)].slice(0,20)))}catch{/* Saving the actual project remains successful. */}}
export function thumbnailOf(plan:ThumbnailPlan):string {const canvas=document.createElement('canvas');canvas.width=220;canvas.height=150;const ctx=canvas.getContext('2d');if(!ctx)return '';let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const b of plan.blocks)for(const run of b.runs)for(const [x,y] of run){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}if(!Number.isFinite(minX))return '';const scale=Math.min(196/Math.max(1,maxX-minX),126/Math.max(1,maxY-minY));ctx.translate(110-(minX+maxX)/2*scale,75-(minY+maxY)/2*scale);ctx.scale(scale,scale);ctx.lineWidth=Math.max(.15,1.2/scale);ctx.lineCap='round';ctx.lineJoin='round';for(const b of plan.blocks){ctx.strokeStyle=`rgb(${b.color.join(',')})`;ctx.beginPath();for(const run of b.runs){run.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y))}ctx.stroke()}return canvas.toDataURL('image/png')}
const thumbnailCache=new Map<string,{image:string;stitches:number;colors:number}>();
function DesignThumbnail({file}:{file:string}){const [preview,setPreview]=useState(()=>thumbnailCache.get(file));useEffect(()=>{let active=true;const cached=thumbnailCache.get(file);setPreview(cached);if(!cached)void invoke<ThumbnailPlan>('library_thumbnail',{file}).then(plan=>{if(!active)return;const result={image:thumbnailOf(plan),stitches:plan.stitches,colors:plan.blocks.length};if(thumbnailCache.size>=100)thumbnailCache.delete(thumbnailCache.keys().next().value!);thumbnailCache.set(file,result);setPreview(result)}).catch(()=>{});return()=>{active=false}},[file]);return <><div className="library-thumb">{preview?.image?<img src={preview.image} alt="Stitch path preview"/>:<File size={30}/>}</div>{preview&&<small>{preview.stitches.toLocaleString()} points · {preview.colors} color blocks</small>}</>}


const projectThumbnailCache=new Map<string,string>();
function ProjectThumbnail({project}:{project:Project}) {
  const cacheKey=project.file+'@'+project.modified;
  const [image,setImage]=useState(project.thumbnail||projectThumbnailCache.get(cacheKey)||'');
  useEffect(()=>{let active=true;const cached=projectThumbnailCache.get(cacheKey)||project.thumbnail||'';setImage(cached);if(!cached)void invoke<ThumbnailPlan>('project_thumbnail',{file:project.file}).then(plan=>{if(active){const next=thumbnailOf(plan);if(projectThumbnailCache.size>=100)projectThumbnailCache.delete(projectThumbnailCache.keys().next().value!);projectThumbnailCache.set(cacheKey,next);setImage(next)}}).catch(()=>{});return()=>{active=false}},[project.file,cacheKey,project.thumbnail]);
  return <div className="library-thumb">{image?<img src={image} alt="Project stitch preview"/>:<File size={25}/>}</div>;
}
function readProjectLibrary():Project[]{try{const saved:Project[]=JSON.parse(localStorage.getItem('studio-project-library')||'[]');const recent:Project[]=JSON.parse(localStorage.getItem('studio-recent-projects')||'[]');return Array.from(new Map([...saved,...recent].map(p=>[p.file,p])).values())}catch{return []}}
function addProjectFiles(files:Project[]){const next=Array.from(new Map([...readProjectLibrary(),...files].map(p=>[p.file,p])).values());localStorage.setItem('studio-project-library',JSON.stringify(next));return next}
export function RecentProjects({onOpen}:{onOpen:()=>void}) {
  const [projects,setProjects]=useState<Project[]>(()=>{try{return JSON.parse(localStorage.getItem('studio-recent-projects')||'[]')}catch{return []}});
  const [error,setError]=useState('');
  async function scan(){try{const result=await invoke<Project[]|null>('scan_projects');if(result){const recent=result.sort((a,b)=>b.modified-a.modified).slice(0,5);recent.slice().reverse().forEach(rememberProject);setProjects(JSON.parse(localStorage.getItem('studio-recent-projects')||'[]'))}}catch(e){setError(String(e))}}
  async function open(project:Project){try{if(!await confirmAction('Open this project? Save existing work first.'))return;const settings=await invoke<{width:number;height:number;format:string}>('library_open',{file:project.file});sessionStorage.setItem('studio-open-project-settings',JSON.stringify(settings));rememberProject(project);onOpen()}catch(e){setError(String(e))}}
  return <section className="recent-project-grid">{projects.slice(0,5).map(p=><article key={p.file}><ProjectThumbnail project={p}/><strong>{p.name}</strong><small>{p.stitches.toLocaleString()} points · {p.colors} colors</small><ProjectDates project={p} compact/><button onClick={()=>void open(p)}>Open project</button></article>)}<button className="recent-scan" onClick={()=>void scan()}><FolderOpen size={22}/>{projects.length?'Refresh from folder':'Find saved projects'}</button>{error&&<p role="alert">{error}</p>}</section>
}

export function Library({ onDone,onArtwork,initialTab='embroidery' }: { onDone: () => void; onArtwork?: (art:Art)=>void;initialTab?:'embroidery'|'projects'|'artwork' }) {
  const [tab, setTab] = useState<'embroidery' | 'projects' | 'artwork'>(initialTab);
  const [files, setFiles] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>(readProjectLibrary);
  const [query, setQuery] = useState('');
  const [layout,setLayout]=useState<'grid'|'list'>(()=>localStorage.getItem('studio-library-layout')==='list'?'list':'grid');
  useEffect(()=>{localStorage.setItem('studio-library-layout',layout)},[layout]);
  const [sort, setSort] = useState('recent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');


  useEffect(() => {
    let active = true;
    void invoke<string[]>('personal_designs')
      .then(result => { if (active) setFiles(result); })
      .catch(err => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }

  function importDesigns(source: LibraryImportSource) {
    void run(async () => {
      const result = await importToLibrary(source);
      if (result === null) return;
      thumbnailCache.clear();setFiles(await invoke<string[]>('personal_designs'));
      setMessage(result);
    });
  }

  function insert(file: string) {
    void run(async () => {
      const plan = await invoke('insert_embroidery', { file, xMm: 0, yMm: 0 });
      if (plan) onDone();
    });
  }

  function scan() {
    void run(async () => {
      const result = await invoke<Project[] | null>('scan_projects');
      if (result) { setProjects(addProjectFiles(result)); [...result].sort((a,b)=>a.modified-b.modified).slice(-5).forEach(rememberProject); }
    });
  }

  function importProjects(){void run(async()=>{const result=await invoke<Project[]|null>('import_project_files');if(result===null)return;setProjects(addProjectFiles(result));setMessage(result.length?result.length+' project files added to library.':'No valid project files selected.');});}
  function open(project: Project) {
    void run(async () => {
      if (!await confirmAction('Open this project? Save existing work first.')) return;
      const { width, height, format, thread_assignments } = await invoke<{ width: number; height: number; format: string;thread_assignments?:Record<number,string> }>('library_open', { file: project.file });
      sessionStorage.setItem('studio-open-project-settings', JSON.stringify({ width, height, format, thread_assignments }));
      rememberProject(project);
      onDone();
    });
  }

  const visibleFiles = files.filter(file => matchesName(file,query)).sort(compareNames);
  const visibleProjects = projects.filter(project => matchesName(project.name + ' ' + project.file,query))
    .sort((a, b) => sort === 'name' ? compareNames(a.name,b.name) : sort === 'stitches' ? b.stitches - a.stitches : b.modified - a.modified);
  const filePage=usePagedList(visibleFiles,query);
  const projectPage=usePagedList(visibleProjects,JSON.stringify([query,sort]));
  return <section className={`design-library library-${layout}`}>
    <div className="studio-tools" role="group" aria-label="Design library sources">
      <button aria-pressed={tab === 'embroidery'} onClick={() => { setTab('embroidery'); setQuery(''); }}>Embroidery files</button>
      <button aria-pressed={tab === 'projects'} onClick={() => { setTab('projects'); setQuery(''); }}>Stitch Studio projects</button>
      {onArtwork&&<button aria-pressed={tab==='artwork'} onClick={()=>{setTab('artwork');setQuery('');}}>Artwork</button>}
    </div>
    {tab==='artwork'&&onArtwork?<CharacterGallery onArt={onArtwork}/>:<>
    <div className="library-filters">
      <label className="library-search"><Search size={16} /><input aria-label="Search designs" placeholder="Search designs" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {tab === 'embroidery' ? <>
        <button className="primary" disabled={busy} onClick={() => importDesigns('files')}><FilePlus size={16} /> Import design files</button>
        <button disabled={busy} onClick={() => importDesigns('folder')}><FolderOpen size={16} /> Import folder</button>
        <button disabled={busy} onClick={() => importDesigns('zip')}><FileArchive size={16} /> Import ZIP</button>
      </> : <>
        <button className="primary" disabled={busy} onClick={importProjects}><FilePlus size={16}/> Import project files</button><button disabled={busy} onClick={scan}><FolderOpen size={16} /> Scan project folder</button>
        <select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)}>
          <option value="recent">Recently modified</option><option value="name">Name A–Z</option><option value="stitches">Stitch count</option>
        </select>
      </>}
      <div className="library-view-switch" role="group" aria-label="Library view"><button aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}>Grid</button><button aria-pressed={layout==='list'} onClick={()=>setLayout('list')}>List</button></div>
    </div>
    {busy && <p role="status">Reading designs…</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {tab === 'embroidery' ? <>
      {files.length === 0 && <>
        <p>Import machine files in DST, PES, PEC, EXP, JEF or VP3 format to use them here.</p>
        {onArtwork&&<CharacterGallery onArt={onArtwork}/>}
      </>}
      {files.length > 0 && visibleFiles.length === 0 && <p>No files match your search.</p>}
      <div className="font-list">
        {filePage.items.map(file => <article key={file}>
          <DesignThumbnail file={file}/><div><strong>{file}</strong><small>{file.split('.').pop()?.toUpperCase()}</small></div>
          <button disabled={busy} onClick={() => insert(file)} aria-label={`Insert ${file}`}>Insert design</button>
        </article>)}
      </div><ListNavigation {...filePage}/>
    </> : <>
      <p>{visibleProjects.length} {visibleProjects.length===1?'project':'projects'} found</p>
      <div className="font-list">
        {projectPage.items.map(project => <article key={project.file}>
          <ProjectThumbnail project={project}/><div><strong>{project.name}</strong>
            <small className="project-metrics">{project.stitches.toLocaleString()} stitches · {project.colors} blocks</small><small className="project-metrics">{(project.width/25.4).toFixed(2)} × {(project.height/25.4).toFixed(2)} in hoop</small><ProjectDates project={project}/>
          </div>
          <button disabled={busy} onClick={() => open(project)}>Open project</button>
        </article>)}
      </div><ListNavigation {...projectPage}/>
    </>}
    </>}
  </section>;
}
