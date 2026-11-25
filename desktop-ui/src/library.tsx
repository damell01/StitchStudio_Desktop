import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { File, FileArchive, FilePlus, FolderOpen, Search } from 'lucide-react';
import { confirmAction } from './dialogs';
import { importToLibrary, type LibraryImportSource } from './library-import';

type Project = { file: string; name: string; stitches: number; colors: number; width: number; height: number; modified: number };

export function Library({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<'embroidery' | 'projects'>('embroidery');
  const [files, setFiles] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
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
      setFiles(await invoke<string[]>('personal_designs'));
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
      if (result) setProjects(result);
    });
  }

  function open(project: Project) {
    void run(async () => {
      if (!await confirmAction('Open this project? Save existing work first.')) return;
      const { width, height, format } = await invoke<{ width: number; height: number; format: string }>('library_open', { file: project.file });
      sessionStorage.setItem('studio-open-project-settings', JSON.stringify({ width, height, format }));
      onDone();
    });
  }

  const visibleFiles = files.filter(file => matchesName(file,query)).sort(compareNames);
  const visibleProjects = projects.filter(project => matchesName(project.name + ' ' + project.file,query))
    .sort((a, b) => sort === 'name' ? compareNames(a.name,b.name) : sort === 'stitches' ? b.stitches - a.stitches : b.modified - a.modified);
  const filePage=usePagedList(visibleFiles,query);
  const projectPage=usePagedList(visibleProjects,JSON.stringify([query,sort]));
  return <section className="design-library">
    <div className="studio-tools" role="group" aria-label="Design library sources">
      <button aria-pressed={tab === 'embroidery'} onClick={() => { setTab('embroidery'); setQuery(''); }}>Embroidery files</button>
      <button aria-pressed={tab === 'projects'} onClick={() => { setTab('projects'); setQuery(''); }}>Stitch Studio projects</button>
    </div>
    <div className="library-filters">
      <label className="library-search"><Search size={16} /><input aria-label="Search designs" placeholder="Search designs" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {tab === 'embroidery' ? <>
        <button className="primary" disabled={busy} onClick={() => importDesigns('files')}><FilePlus size={16} /> Import files</button>
        <button disabled={busy} onClick={() => importDesigns('folder')}><FolderOpen size={16} /> Import folder</button>
        <button disabled={busy} onClick={() => importDesigns('zip')}><FileArchive size={16} /> Import ZIP</button>
      </> : <>
        <button className="primary" disabled={busy} onClick={scan}><FolderOpen size={16} /> Scan project folder</button>
        <select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)}>
          <option value="recent">Recently modified</option><option value="name">Name A–Z</option><option value="stitches">Stitch count</option>
        </select>
      </>}
    </div>
    {busy && <p role="status">Reading designs…</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {tab === 'embroidery' ? <>
      {files.length === 0 && <p>Import machine files in DST, PES, PEC, EXP or JEF format to use them here.</p>}
      {files.length > 0 && visibleFiles.length === 0 && <p>No files match your search.</p>}
      <div className="font-list">
        {filePage.items.map(file => <article key={file}>
          <File size={20} /><div><strong>{file}</strong></div>
          <button disabled={busy} onClick={() => insert(file)} aria-label={`Insert ${file}`}>Insert design</button>
        </article>)}
      </div><ListNavigation {...filePage}/>
    </> : <>
      <p>{visibleProjects.length} projects found</p>
      <div className="font-list">
        {projectPage.items.map(project => <article key={project.file}>
          <File size={20} /><div><strong>{project.name}</strong>
            <small>{project.stitches.toLocaleString()} points · {project.colors} color blocks · {project.width} × {project.height} mm hoop</small>
          </div>
          <button disabled={busy} onClick={() => open(project)}>Open project</button>
        </article>)}
      </div><ListNavigation {...projectPage}/>
    </>}
  </section>;
}
