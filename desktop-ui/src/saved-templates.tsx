import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {FileArchive, LayoutTemplate, Search} from 'lucide-react';
import {confirmAction} from './dialogs';
import {compareNames, ListNavigation, matchesName, usePagedList} from './list-navigation';

type Plan = {blocks:{color:number[]; runs:number[][][]}[]};
type TemplateProject = {width:number; height:number; format:string};

export function SavedTemplates({onOpen}: {onOpen:()=>void}) {
  const [files,setFiles]=useState<string[]>([]);
  const [query,setQuery]=useState('');
  const [selection,setSelection]=useState('');
  const [plan,setPlan]=useState<Plan|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const page=usePagedList(files.filter(file=>matchesName(file,query)).sort(compareNames),query,8);

  useEffect(()=>{
    let active=true;
    invoke<string[]>('saved_templates').then(result=>{if(active)setFiles(result);})
      .catch(error=>{if(active)setError(String(error));});
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(!selection)return;
    let active=true;
    invoke<Plan>('preview_saved_template',{file:selection}).then(result=>{if(active)setPlan(result);})
      .catch(error=>{if(active)setError(String(error));});
    return ()=>{active=false;};
  },[selection]);

  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('');setMessage('');
    try {await action();}
    catch(error){setError(String(error));}
    finally {setBusy(false);}
  }

  function importZip() {
    void run(async()=>{
      const result=await invoke<{imported:number; duplicates:number; skipped:number}|null>('import_template_archive');
      if(!result)return;
      setFiles(await invoke<string[]>('saved_templates'));
      setMessage(result.imported||result.duplicates
        ? `${result.imported} imported · ${result.duplicates} already saved · ${result.skipped} other files skipped`
        : 'No editable .stitchstudio projects found in the ZIP.');
    });
  }

  function startDesign() {
    void run(async()=>{
      if(!await confirmAction('Start from this template? Save your current design first if you want to keep it.'))return;
      const settings=await invoke<TemplateProject>('open_saved_template',{file:selection});
      const {width,height,format}=settings;
      sessionStorage.setItem('studio-open-project-settings',JSON.stringify({width,height,format}));
      onOpen();
    });
  }

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const block of plan?.blocks??[]){
    for(const run of block.runs){
      for(const [x,y] of run){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
  }

  return <section aria-label="My editable templates">
    <div className="library-filters">
      <label className="library-search"><Search size={16}/><input type="search" aria-label="Search my templates" placeholder="Search my templates" value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <button className="primary" disabled={busy} onClick={importZip}><FileArchive size={16}/> Import template ZIP</button>
    </div>
    <p>Import a ZIP of editable .stitchstudio projects. The library scans nested folders and keeps each project as a reusable layout.</p>
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert">{error}</p>}
    {!files.length&&<p>Your imported templates will appear here.</p>}
    {!!files.length&&!page.total&&<p>No templates match your search.</p>}
    <div className="font-list">
      {page.items.map(file=><article key={file}>
        <LayoutTemplate size={20}/><strong>{file.replace(/\.stitchstudio$/,'')}</strong>
        <button aria-label={`Preview ${file}`} aria-pressed={selection===file} disabled={busy} onClick={()=>{
          if(file!==selection){setPlan(null);setError('');setSelection(file);}
        }}>Preview</button>
      </article>)}
    </div>
    <ListNavigation {...page}/>
    {selection&&<article>
      <h3>{selection.replace(/\.stitchstudio$/,'')}</h3>
      {plan&&Number.isFinite(minX)&&<svg role="img" aria-label="Template stitch preview" viewBox={[minX-3,minY-3,maxX-minX+6,maxY-minY+6].join(' ')} style={{display:'block',width:'100%',height:200}}>
        {plan.blocks.map((block,index)=><g key={index} stroke={`rgb(${block.color.join(',')})`} strokeWidth=".35" fill="none">
          {block.runs.map((run,index)=><polyline key={index} points={run.map(point=>point.join(',')).join(' ')}/>)}
        </g>)}
      </svg>}
      {!plan&&!error&&<p role="status">Loading stitch preview…</p>}
      <button className="primary" disabled={busy||!plan} onClick={startDesign}>Use as new design</button>
    </article>}
  </section>;
}
