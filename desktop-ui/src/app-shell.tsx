// App chrome: the left navigation sidebar and the slim top bar.
import {useEffect,useState,type ComponentType} from 'react';
import {
  Home,ImagePlus,Type,Shapes,Scissors,Shield,Files,Layers3,LayoutTemplate,FolderOpen,Palette,
  CaseSensitive,Monitor,Square,Calculator,Settings,HelpCircle,Compass,PanelLeftClose,PanelLeftOpen,Moon,Sun,ChevronDown,
} from 'lucide-react';

type Icon=ComponentType<{size?:number;'aria-hidden'?:boolean|'true'}>;
/** A navigation entry. `page` is the app's page key, `label` what people see. */
type Item={page:string;label:string;icon:Icon;aria?:string};
type Group={name:string;items:Item[]};

export const navGroups:Group[]=[
  {name:'Create',items:[
    {page:'Digitize an image',label:'Digitize',icon:ImagePlus},
    {page:'Create lettering',label:'Lettering',icon:Type,aria:'Create lettering'},
    {page:'Create monogram',label:'Monogram',icon:CaseSensitive},
    {page:'Create appliqué',label:'Appliqué',icon:Scissors},
    {page:'Create patch',label:'Patch',icon:Shield},
    {page:'Bulk Design Import',label:'Batch digitize',icon:Files},
  ]},
  {name:'Design',items:[
    {page:'Blank design',label:'Design studio',icon:Layers3},
    {page:'Template Library',label:'Templates',icon:LayoutTemplate},
    {page:'Design Library',label:'Design library',icon:FolderOpen},
  ]},
  {name:'Setup',items:[
    {page:'Thread Library',label:'Threads',icon:Palette},
    {page:'Font Manager',label:'Font manager',icon:Type},
    {page:'Machine Manager',label:'Machines',icon:Monitor},
    {page:'Hoop Manager',label:'Hoops',icon:Square},
    {page:'Job Pricing',label:'Job pricing',icon:Calculator},
  ]},
  {name:'Settings & Help',items:[
    {page:'Help Center',label:'Help Center',icon:HelpCircle},
    {page:'Settings',label:'Settings',icon:Settings},
    {page:'Quick tour',label:'Quick tour',icon:Compass},
  ]},
];

function read(key:string){try{return localStorage.getItem(key)}catch{return null}}
function write(key:string,value:string){try{localStorage.setItem(key,value)}catch{/* optional */}}

export function Sidebar({page,go,editor,open,onClose}:{page:string;go:(page:string)=>void;editor:boolean;open?:boolean;onClose?:()=>void}){
  const [collapsedPref,setCollapsedPref]=useState(()=>read('studio-sidebar-collapsed'));
  const [closed,setClosed]=useState<string[]>(()=>{try{return JSON.parse(read('studio-sidebar-closed')??'[]')}catch{return []}});
  // In the editor the sidebar is a drawer opened from the top bar, so the canvas keeps the space.
  const collapsed=editor?false:collapsedPref==='1';
  useEffect(()=>{document.documentElement.dataset.sidebar=editor?'drawer':collapsed?'rail':'full'},[collapsed,editor]);
  useEffect(()=>{if(!open)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose?.()};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k)},[open]);
  function toggle(){const next=!collapsed;setCollapsedPref(next?'1':'0');write('studio-sidebar-collapsed',next?'1':'0')}
  function toggleGroup(name:string){setClosed(c=>{const next=c.includes(name)?c.filter(n=>n!==name):[...c,name];write('studio-sidebar-closed',JSON.stringify(next));return next})}
  const current=(p:string)=>p===page||(p==='Blank design'&&page==='Open embroidery');
  const entry=(item:Item)=><button key={item.page} className="sidebar-item" aria-current={current(item.page)?'page':undefined}
    aria-label={item.aria} title={collapsed?item.label:undefined} onClick={()=>{go(item.page);onClose?.()}}>
    <item.icon size={17} aria-hidden="true"/><span>{item.label}</span></button>;
  return <>{editor&&open&&<div className="sidebar-backdrop" onClick={onClose} aria-hidden="true"/>}<nav className={'desktop-nav studio-sidebar'+(collapsed?' is-rail':'')+(editor?' is-drawer':'')+(editor&&open?' is-open':'')} aria-label="Main navigation">
    <div className="sidebar-brand">
      <span className="sidebar-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 18 C8 6 16 6 20 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2.4"/><circle cx="12" cy="9.2" r="2.1" fill="currentColor"/></svg></span>
      <span className="sidebar-brand-text"><strong>Stitch Studio</strong><small>Embroidery design</small></span>
    </div>
    <div className="sidebar-scroll">
      <button className="sidebar-item nav-home" aria-current={page==='Home'?'page':undefined} title={collapsed?'Home':undefined} onClick={()=>{go('Home');onClose?.()}}><Home size={17} aria-hidden="true"/><span>Home</span></button>
      {navGroups.map(g=><details key={g.name} className="sidebar-group" open={collapsed||!closed.includes(g.name)}>
        <summary onClick={e=>{e.preventDefault();if(!collapsed)toggleGroup(g.name)}}><span>{g.name.split(' & ').map((part,i)=><span key={part}>{i?' & ':''}<span>{part}</span></span>)}</span><ChevronDown size={13} aria-hidden="true"/></summary>
        <div>{g.items.map(entry)}</div>
      </details>)}
    </div>
    {!editor&&<button className="sidebar-collapse" onClick={toggle} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'}>
      {collapsed?<PanelLeftOpen size={17} aria-hidden="true"/>:<PanelLeftClose size={17} aria-hidden="true"/>}<span>Collapse</span>
    </button>}
  </nav></>;
}

export function ThemeToggle({theme,setTheme}:{theme:string;setTheme:(t:string)=>void}){
  const dark=document.documentElement.dataset.theme==='dark';
  return <button className="topbar-icon" onClick={()=>setTheme(dark?'light':'dark')} aria-label={dark?'Use light theme':'Use dark theme'} title={dark?'Light theme':'Dark theme'} data-theme-choice={theme}>
    {dark?<Sun size={17} aria-hidden="true"/>:<Moon size={17} aria-hidden="true"/>}
  </button>;
}

/** Editor-only: opens the navigation drawer and goes home. */
export function EditorNav({onMenu,onHome}:{onMenu:()=>void;onHome:()=>void}){
  return <div className="topbar-editor-nav">
    <button className="topbar-logo" onClick={onMenu} aria-label="Open navigation" title="Open navigation"><span className="sidebar-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 18 C8 6 16 6 20 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2.4"/><circle cx="12" cy="9.2" r="2.1" fill="currentColor"/></svg></span></button>
    <button className="topbar-icon topbar-home" onClick={onHome} aria-label="Home" title="Home"><Home size={16} aria-hidden="true"/></button>
  </div>;
}
