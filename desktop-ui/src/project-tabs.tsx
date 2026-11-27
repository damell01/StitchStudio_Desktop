import {invoke} from '@tauri-apps/api/core';
import {FileText,History,Plus,X} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Command} from './command-palette';
import {confirmAction} from './dialogs';
import {Editor} from './editor';
import './project-tabs.css';

export type WorkspaceView = {
  width:number;height:number;format:string;machine:string;hoop:string;zoom:number;pan:number[];
  threadAssignments:Record<string,string>;
};
type EditorStatus = {view:WorkspaceView;name:string|null;busy:boolean};
type Tab = {id:string;name:string;has_design:boolean};
type TabList = {active:string;tabs:Tab[]};
type RecoveryEntry = {id:string;name:string};
type ProjectSettings = {width:number;height:number;format:string;thread_assignments?:Record<string,string>};
type Action = {type:'new'}|{type:'select'|'close';id:string};
const views=new Map<string,WorkspaceView>();
let lastActiveTab:string|undefined;
const sessionKey='studio-previous-project-tabs';
type PreviousSession = {ids:string[];active:string};

function readPreviousSession():PreviousSession|null{
  try{
    const saved=JSON.parse(localStorage.getItem(sessionKey)??'null');
    return saved && Array.isArray(saved.ids) && saved.ids.length>0 && saved.ids.length<=6 &&
      saved.ids.every((id:unknown)=>typeof id==='string') && saved.ids.includes(saved.active) ? saved : null;
  }catch{return null;}
}
function rememberSession(list:TabList){
  try{
    const snapshot=JSON.stringify({ids:list.tabs.map(tab=>tab.id),active:list.active});
    if(localStorage.getItem(sessionKey)!==snapshot)localStorage.setItem(sessionKey,snapshot);
  }catch{/* Recovery copies can still be opened individually. */}
}

export function StudioWorkspace({navigation,initialAssistant,onAssistantOpened}:{
  navigation:Command[];initialAssistant:boolean;onAssistantOpened:()=>void;
}){
  const [list,setList]=useState<TabList|null>(null);
  const [resumedView]=useState(()=>{
    const resume=sessionStorage.getItem('studio-resume-view')==='1';
    sessionStorage.removeItem('studio-resume-view');
    return resume&&lastActiveTab?views.get(lastActiveTab):undefined;
  });
  const [status,setStatus]=useState<{name:string|null;busy:boolean}>({name:null,busy:false});
  const [pending,setPending]=useState(false);
  const [previous,setPrevious]=useState(readPreviousSession);
  const [restoreNotice,setRestoreNotice]=useState('');
  const [sessionGeneration,setSessionGeneration]=useState(0);
  const [error,setError]=useState('');
  const [recovery,setRecovery]=useState<RecoveryEntry[]>([]);
  const [loadingRecovery,setLoadingRecovery]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const current=useRef<EditorStatus|null>(null);
  const changing=useRef(false);
  const focusedTab=useRef<string|null>(null);

  useEffect(()=>{
    let active=true;
    void invoke<TabList>('workspace_tabs').then(value=>{if(active&&value)setList(value);}).catch(()=>{});
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    if(!list||focusedTab.current!==list.active)return;
    document.querySelector<HTMLButtonElement>('[data-project-tab="'+CSS.escape(list.active)+'"]')?.focus();
    focusedTab.current=null;
  },[list?.active]);

  function updateStatus(value:EditorStatus){
    current.current=value;
    if(list){lastActiveTab=list.active;views.set(list.active,value.view);}
    if(list&&value.name){
      rememberSession(list);
      if(previous)setPrevious(null);
    }
    setStatus(old=>old.name===value.name&&old.busy===value.busy?old:{name:value.name,busy:value.busy});
  }

  async function flushRecovery(){
    const view=current.current;
    if(!list||!view?.name)return;
    await invoke('recovery_save',{
      expectedTab:list.active,width:view.view.width,height:view.view.height,
      format:view.view.format,threadAssignments:view.view.threadAssignments,
    });
  }

  async function run(action:()=>Promise<TabList>){
    if(!list||changing.current||current.current?.busy)return false;
    const actionStartedWithDesign=!!current.current?.name;
    changing.current=true;setPending(true);setError('');
    try{
      await flushRecovery();
      const next=await action();
      if(!next)return false;
      if(next.active!==list.active){
        current.current=null;
        setStatus({name:null,busy:false});
      }
      setList(next);
      if(!previous||actionStartedWithDesign)rememberSession(next);
      return true;
    }catch(error){setError(String(error));return false;}
    finally{changing.current=false;setPending(false);}
  }

  function change(action:Action){
    if(action.type==='select'&&action.id===list?.active)return;
    if(action.type==='close'){
      const tab=list?.tabs.find(item=>item.id===action.id);
      if(tab?.has_design||action.id===list?.active&&status.name){
        void confirmAction('Close this project tab? Saved projects stay on disk. You can reopen its latest recovery copy.').then(yes=>{
          if(yes)void run(()=>invoke<TabList>('change_workspace_tab',{action})).then(closed=>{if(closed)views.delete(action.id)});
        });
        return;
      }
    }
    void run(()=>invoke<TabList>('change_workspace_tab',{action})).then(()=>{
      if(action.type==='close')views.delete(action.id);
    });
  }

  async function findRecovery(){
    dialog.current?.showModal();
    setLoadingRecovery(true);setError('');
    try{setRecovery(await invoke<RecoveryEntry[]>('recoverable_workspace_tabs')??[]);}
    catch(error){setError(String(error));}
    finally{setLoadingRecovery(false);}
  }

  function restore(id:string){
    void run(async()=>{
      const result=await invoke<{tabs:TabList;project:ProjectSettings}>('restore_workspace_tab',{id});
      const {width,height,format,thread_assignments}=result.project;
      sessionStorage.setItem('studio-open-project-settings',JSON.stringify({width,height,format,thread_assignments}));
      dialog.current?.close();
      return result.tabs;
    });
  }

  const canRestoreSession=!!previous&&list?.tabs.length===1&&!list.tabs[0].has_design&&!status.name;
  function restoreSession(){
    if(!previous||!canRestoreSession)return;
    void run(async()=>{
      const result=await invoke<{tabs:TabList;projects:Record<string,ProjectSettings>;skipped:number}>(
        'restore_workspace_session',previous);
      for(const [id,project] of Object.entries(result.projects)){
        views.set(id,{
          width:project.width,height:project.height,format:project.format,
          threadAssignments:project.thread_assignments??{},zoom:100,pan:[0,0],machine:'',hoop:'',
        });
      }
      current.current=null;
      setSessionGeneration(generation=>generation+1);
      setPrevious(null);
      rememberSession(result.tabs);
      setRestoreNotice(result.skipped ? 'Recovered available projects. '+result.skipped+' tabs had no usable recovery copy.' : 'Previous workspace restored.');
      dialog.current?.close();
      return result.tabs;
    });
  }

  // Use a stable initial editor key while the native tab list first loads.
  // On later tab changes, remount the editor against the newly active Rust workspace.
  const initialTab=useRef<string|null>(null);
  if(list&&!initialTab.current)initialTab.current=list.active;
  const editorKey=sessionGeneration+':'+(list&&list.active!==initialTab.current?list.active:'initial-project');
  const tabId=list?.active;
  const working=pending||status.busy;
  const newTab:Command={label:'New project tab',group:'Workspace',run:()=>change({type:'new'}),
    disabled:!list||working||list.tabs.length>=6};
  const restoreTab:Command={label:'Restore a project tab',group:'Workspace',run:()=>void findRecovery(),
    disabled:!list||working};
  const closedRecovery=recovery.filter(item=>!list?.tabs.some(tab=>item.id===tab.id));

  // Editor remains mounted when the tab list is discovered, so on first load
  // it consumes project settings even when opened from Home or the library.
  const tabStrip=list&&<div className="project-tab-strip" role="group" aria-label="Open projects">
      <div className="project-tab-scroll" role="tablist" aria-label="Project tabs">
        {list.tabs.map((tab,index)=>{
          const active=list.active===tab.id;
          const name=active?(status.name??tab.name):tab.name;
          return <div className="project-tab" data-current={active} key={tab.id}>
            <button type="button" role="tab" data-project-tab={tab.id} aria-selected={active} tabIndex={active?0:-1}
              title={name} disabled={working} onClick={()=>change({type:'select',id:tab.id})}
              onKeyDown={event=>{
                if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
                event.preventDefault();
                const offset=event.key==='ArrowLeft'?-1:1;
                const next=list.tabs[(index+offset+list.tabs.length)%list.tabs.length];
                focusedTab.current=next.id;change({type:'select',id:next.id});
              }}><FileText size={14}/><span>{name}</span></button>
            {list.tabs.length>1&&<button className="project-tab-close" type="button"
              title={'Close '+name} aria-label={'Close '+name} disabled={working}
              onClick={()=>change({type:'close',id:tab.id})}><X size={14}/></button>}
          </div>;
        })}
      </div>
      <button className="studio-tool-icon" type="button" title="New project tab" aria-label="New project tab"
        disabled={newTab.disabled} onClick={newTab.run}><Plus size={17}/></button>
      <button className="studio-tool-icon" type="button" title="Restore a project tab" aria-label="Restore a project tab"
        disabled={restoreTab.disabled} onClick={restoreTab.run}><History size={17}/></button>
      {error&&!dialog.current?.open&&<small role="alert">{error}</small>}
      {restoreNotice&&<small role="status">{restoreNotice}</small>}
    </div>;
  const navigationDock=document.getElementById('studio-project-tabs');
  return <>
    {navigationDock ? createPortal(tabStrip, navigationDock) : tabStrip}
    <dialog ref={dialog} className="studio-modal" aria-label="Restore a project tab">
      <div className="studio-modal-heading"><h2>Restore a project tab</h2><button onClick={()=>dialog.current?.close()}>Close</button></div>
      {canRestoreSession&&<button className="primary" disabled={working} onClick={restoreSession}><History size={16}/> Restore previous workspace</button>}
      {loadingRecovery?<p role="status">Checking for recovery copies…</p>:closedRecovery.length?
        <div className="workspace-stack">{closedRecovery.map(item=><button key={item.id}
          disabled={working||!list||list.tabs.length>=6} onClick={()=>restore(item.id)}><History size={16}/>{item.name}</button>)}</div>:
        <p>There are no closed project tabs to recover.</p>}
      {error&&<p role="alert">{error}</p>}
    </dialog>
    <Editor key={editorKey} initialView={tabId?views.get(tabId):resumedView} tabId={tabId}
      initialAssistant={initialAssistant} onAssistantOpened={onAssistantOpened}
      onWorkspaceStatus={updateStatus} navigation={[newTab,restoreTab,...navigation]}/>
  </>;
}
