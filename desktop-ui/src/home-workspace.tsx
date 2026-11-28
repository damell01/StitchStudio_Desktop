import {invoke} from '@tauri-apps/api/core';
import {
  ArrowRight, BookOpen, FileText, FolderOpen, History, ImagePlus, Layers3, LayoutTemplate,
  Library, Plus, Scissors, Settings, Shapes, Shield, Type,
} from 'lucide-react';
import {useEffect,useState} from 'react';
import {confirmAction} from './dialogs';
import {RecentProjects} from './library';
import {templateCatalog} from './template-catalog';
import heroPhoto from './assets/home-embroidery.webp';
import './home-workspace.css';

type Overview = {current:string|null;recovery:boolean};
type ProjectSettings = {width:number;height:number;format:string;thread_assignments?:Record<string,string>};
type Props = {
  navigate:(page:string)=>void;
  studio:(assistant?:boolean)=>void;
  projects:()=>void;
  onArtworkDrop:(file:File)=>void;
  /** Opens the template library, optionally on one category. */
  templates?:(category?:string)=>void;
  /** Starts digitizing one built-in template. */
  onTemplate?:(template:{name:string;svg:string})=>void;
};

const featuredIds=['expanded-curated-pink-floral-crest','expanded-curated-baseball-blue-bow','expanded-sayings-faith-walk-by-faith','expanded-curated-teddy-blue-bow',
  'expanded-quick-stitch-vol4-coastal-pelican','expanded-curated-green-tractor','expanded-premium-sayings-drafts-blessed-mama','expanded-solid-color-vol-3-boutique-ribbon-bow',
  'expanded-curated-woodland-fawn','expanded-sayings-southern-sweet-as-honey','expanded-curated-flying-mallard','expanded-quick-stitch-vol-1-12-birthday-train'];
const featured=featuredIds.map(id=>templateCatalog.find(t=>t.id===id)).filter((t):t is typeof templateCatalog[number]=>!!t&&!!t.svg);
const featuredCategories=['Sayings','Monograms & frames','Boutique & bows','Baby & children','Sports','Faith','Seasonal','Western & farm','Outdoors & hunting','Beach & ocean'];
const svgUrl=(svg:string)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);

const quickCreate = [
  {label:'Lettering',page:'Create lettering',Icon:Type},
  {label:'Monogram',page:'Create monogram',Icon:Shapes},
  {label:'Appliqué',page:'Create appliqué',Icon:Scissors},
  {label:'Patch',page:'Create patch',Icon:Shield},
] as const;
const resources = [
  {page:'Design Library',label:'Design Library',Icon:Library},
  {page:'Template Library',label:'Template Library',Icon:LayoutTemplate},
  {page:'Font Manager',label:'Fonts',Icon:Type},
  {page:'Thread Library',label:'Threads',Icon:Scissors},
  {page:'Machine Manager',label:'Machines & hoops',Icon:Settings},
  {page:'Help Center',label:'How-to guides',Icon:BookOpen},
] as const;

export function HomeWorkspace({navigate,studio,projects,onArtworkDrop,templates,onTemplate}:Props) {
  const [overview,setOverview]=useState<Overview>({current:null,recovery:false});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [dragging,setDragging]=useState(false);
  useEffect(()=>{
    let active=true;
    void invoke<Overview>('workspace_overview').then(status=>{if(active&&status)setOverview(status);}).catch(()=>{});
    return ()=>{active=false;};
  },[]);

  function resume(assistant=false){
    if(overview.current)sessionStorage.setItem('studio-resume-view','1');
    studio(assistant);
  }

  async function open(action:'blank'|'project'|'embroidery'|'recover'){
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      if(action==='blank'){
        if(overview.current){
          await invoke('change_workspace_tab',{action:{type:'new'}});
        }else{
          await invoke('new_blank_design');
        }
        studio();
        return;
      }
      if(overview.current&&!await confirmAction('Open another design? Save the design currently on the canvas if you want to keep it.'))return;
      if(action==='embroidery'){
        const result=await invoke('open_svg',{widthMm:80,colors:8,removeBackground:true,detail:60});
        if(result)studio();
        return;
      }
      const result=await invoke<ProjectSettings|null>(action==='project'?'open_project':'recovery_open');
      if(result){
        const {width,height,format,thread_assignments}=result;
        sessionStorage.setItem('studio-open-project-settings',JSON.stringify({width,height,format,thread_assignments}));
        studio();
      }else if(action==='recover'){
        setMessage('No recovery copy is available.');
      }
    }catch(error){setMessage(String(error));}
    finally{setBusy(false);}
  }

  return <div className="studio-home">
    <section className="studio-home-hero" aria-labelledby="studio-home-title" data-dragging={dragging||undefined}
      onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)setDragging(true);}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragging(false)}}
      onDrop={event=>{
        if(!event.dataTransfer.types.includes('Files'))return;
        setDragging(false);
        if(event.defaultPrevented)return;
        event.preventDefault();
        const file=event.dataTransfer.files[0];
        if(!busy&&file)onArtworkDrop(file);
      }}>
      <div className="studio-home-hero-content">
        <h1 id="studio-home-title">Start a design</h1>
        <p>{dragging?'Drop to preview your stitches.':'Drop an image here to digitize it, or start with a blank hoop.'}</p>
        <div className="studio-home-primary">
          <button className="primary" disabled={busy} onClick={()=>navigate('Digitize an image')}><ImagePlus size={19}/> Digitize artwork <ArrowRight size={16}/></button>
          <button disabled={busy} onClick={()=>void open('blank')}><Plus size={19}/> Blank design</button>
        </div>
        <div className="studio-home-open" aria-label="Open files">
          <button disabled={busy} onClick={()=>void open('project')}><FileText size={16}/> Open project</button>
          <button disabled={busy} onClick={()=>void open('embroidery')}><FolderOpen size={16}/> Open embroidery</button>
          <span className="studio-home-divider" aria-hidden="true"/>
          {quickCreate.map(({label,page,Icon})=><button key={page} aria-label={page} disabled={busy} onClick={()=>navigate(page)}><Icon size={16}/>{label}</button>)}
        </div>
      </div>
      <img className="studio-home-hero-photo" src={heroPhoto} width="800" height="800" alt="Lavender sprigs and a stitched ribbon in a wooden embroidery hoop"/>
    </section>

    {message&&<p className="studio-home-error" role="alert">{message}</p>}
    {!!featured.length&&<section className="studio-home-templates" aria-labelledby="studio-home-templates">
      <div className="studio-home-section-title">
        <h2 id="studio-home-templates">Start from a template</h2>
        <button disabled={busy} onClick={()=>templates?templates():navigate('Template Library')}>Browse all {templateCatalog.length} <ArrowRight size={15}/></button>
      </div>
      <div className="studio-home-chips" role="group" aria-label="Template categories">
        {featuredCategories.map(c=><button key={c} disabled={busy} onClick={()=>templates?templates(c):navigate('Template Library')}>{c}</button>)}
      </div>
      <div className="studio-home-template-row">
        {featured.map(t=><button key={t.id} className="studio-home-template" disabled={busy} title={'Digitize '+t.name}
          onClick={()=>onTemplate?onTemplate({name:t.name,svg:t.svg}):navigate('Template Library')}>
          <span><img src={svgUrl(t.svg)} alt="" loading="lazy" draggable={false}/></span>
          <strong>{t.name}</strong><small>{t.group}</small>
        </button>)}
      </div>
    </section>}
    <div className="studio-home-work">
      <section className="studio-home-recent" aria-labelledby="studio-home-recent">
        <div className="studio-home-section-title">
          <h2 id="studio-home-recent">Recent projects</h2>
          <button disabled={busy} onClick={projects}>View all <ArrowRight size={15}/></button>
        </div>
        <RecentProjects onOpen={()=>studio()} limit={4} disabled={busy}/>
      </section>
      <section className="studio-home-continue" aria-labelledby="studio-home-continue">
        <h2 id="studio-home-continue">Studio</h2>
        <button disabled={busy} onClick={()=>resume()}>
          <span className="studio-home-icon"><Layers3 size={19}/></span>
          <span><strong>{overview.current?'Continue current design':'Open Studio'}</strong>{overview.current&&<small title={overview.current}>{overview.current}</small>}</span>
          <ArrowRight size={16}/>
        </button>
        {overview.recovery&&<button disabled={busy} onClick={()=>void open('recover')}>
          <span className="studio-home-icon"><History size={19}/></span>
          <span><strong>Restore recovery copy</strong></span>
          <ArrowRight size={16}/>
        </button>}
      </section>
    </div>

    <div className="studio-home-tools studio-home-tools-single">
      <section aria-labelledby="studio-home-resources">
        <h2 id="studio-home-resources">Libraries and setup</h2>
        <div className="studio-home-link-list">
          {resources.map(({label,page,Icon})=><button key={page} disabled={busy} onClick={()=>navigate(page)}><Icon size={17}/>{label}</button>)}
        </div>
      </section>
    </div>
  </div>;
}
