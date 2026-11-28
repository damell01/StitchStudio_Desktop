// Canva-style "add to design" panel for the design studio: templates, text styles and uploads.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Search,X,Upload,Wand2,Type,MousePointerClick} from 'lucide-react';
import {templateCatalog,sortCategories,type TemplateEntry} from './template-catalog';
import './create-panel.css';

export type CreateTab='templates'|'text'|'elements'|'uploads';
export const ARTWORK_DRAG_TYPE='application/x-stitchstudio-artwork';
export type LetteringPreset={text:string;font:string;size:number;spacing:number;arc:number;bold:boolean;italic:boolean;color:[number,number,number];align:string;kind?:string};

const svgUrl=(svg:string)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
export function catalogEntry(id:string){return templateCatalog.find(t=>t.id===id)}

// ---------- Fonts ----------
const scriptFonts=['Great Vibes','Dancing Script','Pacifico','Segoe Script','Brush Script MT','Lucida Handwriting','Snell Roundhand','Apple Chancery','Zapfino','Lobster'];
const serifFonts=['Playfair Display','Georgia','Baskerville','Book Antiqua','Palatino Linotype','Times New Roman','DejaVu Serif','Liberation Serif'];
const blockFonts=['Arial Black','Impact','Franklin Gothic Medium','Arial','Helvetica','Segoe UI','DejaVu Sans','Liberation Sans'];
function pick(fonts:string[],wanted:string[],hint:RegExp){return wanted.find(f=>fonts.includes(f))??fonts.find(f=>hint.test(f))}

type Style={id:string;label:string;sample:string;family:'block'|'serif'|'script';size:number;arc?:number;bold?:boolean;italic?:boolean;kind?:string;color:[number,number,number];spacing?:number;note:string};
const headings:Style[]=[
 {id:'heading',label:'Add a heading',sample:'Add a heading',family:'block',size:18,bold:true,color:[45,34,70],note:'Satin · 18 mm tall'},
 {id:'subheading',label:'Add a subheading',sample:'Add a subheading',family:'block',size:11,bold:true,color:[45,34,70],note:'Satin · 11 mm tall'},
 {id:'body',label:'Add a little bit of text',sample:'Add a little bit of text',family:'block',size:7,color:[45,34,70],note:'Satin · 7 mm tall'},
];
const styles:Style[]=[
 {id:'script-name',label:'Script name',sample:'Emily',family:'script',size:22,color:[189,84,120],note:'Satin script'},
 {id:'varsity-arc',label:'Varsity arc',sample:'WILDCATS',family:'block',size:14,bold:true,arc:70,color:[30,58,110],spacing:1,note:'Arched satin'},
 {id:'monogram',label:'Classic monogram',sample:'ABC',family:'serif',size:30,color:[107,69,173],spacing:.8,note:'Serif satin'},
 {id:'outline',label:'Double outline',sample:'BRAVE',family:'block',size:20,bold:true,kind:'double_outline',color:[200,60,48],note:'Two-color border'},
 {id:'shadow',label:'Drop shadow',sample:'Hello',family:'serif',size:18,bold:true,kind:'shadow',color:[37,99,95],note:'Offset shadow'},
 {id:'puff',label:'3D puff',sample:'TEAM',family:'block',size:22,bold:true,kind:'puff',color:[20,20,24],note:'Needs puff foam'},
 {id:'bean',label:'Bean-stitch script',sample:'sweet pea',family:'script',size:16,kind:'bean',color:[110,140,90],note:'Triple run, light'},
 {id:'fill-block',label:'Filled block',sample:'ROAR',family:'block',size:26,bold:true,kind:'fill',color:[230,140,40],note:'Tatami fill for big letters'},
];

function TextTab({busy,hoop,onAddText,onTypeOnHoop}:{busy:boolean;hoop:{width:number;height:number};onAddText:(s:LetteringPreset)=>void;onTypeOnHoop:()=>void}){
 const [fonts,setFonts]=useState<string[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;invoke<string[]>('lettering_fonts').then(f=>{if(live)setFonts(Array.isArray(f)?f:[])}).catch(e=>{if(live){setFonts([]);setError(String(e))}});return()=>{live=false}},[]);
 const families=useMemo(()=>{
  const f=fonts??[];const any=f[0];
  const block=pick(f,blockFonts,/sans|gothic|grotesk|black/i)??any;
  return {block,serif:pick(f,serifFonts,/serif|roman|garamond/i)??block,script:pick(f,scriptFonts,/script|hand|brush|vibes|cursive/i)??block};
 },[fonts]);
 const maxSize=Math.max(5,Math.min(hoop.height*.35,hoop.width*.3));
 function add(s:Style,text=s.sample){
  const font=families[s.family];
  if(!font){setError('Install a font in Font manager to add lettering.');return}
  setError('');
  onAddText({text,font,size:Math.round(Math.min(s.size,maxSize)*10)/10,spacing:s.spacing??.4,arc:s.arc??0,bold:!!s.bold,italic:!!s.italic,color:s.color,align:'center',...(s.kind?{kind:s.kind}:{})});
 }
 const css=(s:Style)=>{const rgb=`rgb(${s.color.join(',')})`;return {fontFamily:`"${families[s.family]??'inherit'}", ${s.family==='script'?'cursive':s.family==='serif'?'serif':'sans-serif'}`,fontWeight:s.bold?800:400,
  ...(s.kind==='double_outline'?{color:'#fff',WebkitTextStroke:`1.6px ${rgb}`,textShadow:`0 0 0 ${rgb}, 2px 2px 0 ${rgb}`}:{color:rgb})}};
 return <div className="cp-body">
  <button className="cp-primary" disabled={busy} onClick={onTypeOnHoop}><Type size={16}/> Type on the hoop</button>
  <small className="cp-hint"><MousePointerClick size={13}/> Click a style to add it at the hoop center. Double-click lettering on the hoop to change the words.</small>
  {error&&<p className="cp-error" role="alert">{error}</p>}
  <h3>Default text styles</h3>
  <div className="cp-headings">{headings.map(s=><button key={s.id} disabled={busy||fonts===null} onClick={()=>add(s,s.id==='heading'?'Heading':s.id==='subheading'?'Subheading':'Your text here')} aria-label={s.label}>
   <span style={{...css(s),color:'var(--text)',fontSize:s.id==='heading'?22:s.id==='subheading'?16:13}}>{s.label}</span></button>)}</div>
  <h3>Embroidery lettering styles</h3>
  <div className="cp-styles">{styles.map(s=><button key={s.id} disabled={busy||fonts===null} onClick={()=>add(s)} aria-label={'Add '+s.label} title={s.note}>
   <span className={'cp-style-sample cp-style-'+s.id} style={css(s)}>{s.sample}</span>
   <span className="cp-style-label">{s.label}</span><small>{s.note}</small>
  </button>)}</div>
  {fonts!==null&&<small className="cp-hint">Using {Array.from(new Set(Object.values(families).filter(Boolean))).join(', ')||'no fonts found'}. Change fonts anytime in the lettering inspector.</small>}
 </div>;
}

// Lead with the richest artwork; simple classic shapes follow.
const collectionOrder=['Curated heirloom','New artwork','Quick Stitch Vol. 4','Premium sayings','Quick Stitch Vol. 3','Quick Stitch Vol. 1','Quick Stitch Vol. 2','Classic collection','Sports pack'];
function rank(t:TemplateEntry){const i=collectionOrder.indexOf(t.collection);return (i<0?collectionOrder.length:i)*2+(t.draft?1:0)}
function TemplatesTab({busy,onInsert}:{busy:boolean;onInsert:(t:TemplateEntry)=>void}){
 const [query,setQuery]=useState(''),[group,setGroup]=useState('All'),[limit,setLimit]=useState(40);
 const categories=useMemo(()=>sortCategories(Array.from(new Set(templateCatalog.map(t=>t.group)))),[]);
 const list=useMemo(()=>{
  const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return templateCatalog.filter(t=>t.svg&&(group==='All'||t.group===group)&&words.every(w=>(t.name+' '+t.group+' '+t.tags.join(' ')+' '+t.collection).toLowerCase().includes(w)))
   .map((t,i)=>({t,i})).sort((a,b)=>rank(a.t)-rank(b.t)||a.i-b.i).map(x=>x.t);
 },[query,group]);
 useEffect(()=>setLimit(40),[query,group]);
 return <div className="cp-body cp-templates">
  <label className="cp-search"><Search size={15} aria-hidden="true"/><input aria-label="Search templates" placeholder={'Search '+templateCatalog.length+' designs'} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
  <div className="cp-chips" role="group" aria-label="Template categories">{['All',...categories].map(c=><button key={c} aria-pressed={group===c} onClick={()=>setGroup(c)}>{c==='All'?'All':c}</button>)}</div>
  <small className="cp-hint"><MousePointerClick size={13}/> Click to add, or drag onto the hoop.</small>
  {!list.length?<p className="cp-empty">No designs match.</p>:<div className="cp-grid">{list.slice(0,limit).map(t=><button key={t.id} className="cp-card" disabled={busy} title={t.name+' · '+t.group} aria-label={'Add '+t.name}
   draggable={!busy} onDragStart={e=>{e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData(ARTWORK_DRAG_TYPE,t.id)}} onClick={()=>onInsert(t)}>
   <img src={svgUrl(t.svg)} alt="" loading="lazy" draggable={false}/>{t.draft&&<span className="cp-draft">Draft</span>}
  </button>)}</div>}
  {list.length>limit&&<button className="cp-more" onClick={()=>setLimit(l=>l+40)}>Show more ({list.length-limit})</button>}
 </div>;
}

function UploadsTab({busy,onUpload,onDigitize}:{busy:boolean;onUpload:()=>void;onDigitize:()=>void}){
 return <div className="cp-body">
  <button className="cp-drop" disabled={busy} onClick={onUpload}><Upload size={22}/><strong>Upload files</strong><small>DST, PES, JEF, EXP, VP3, SVG, PNG or JPEG. You can also drop files straight onto the hoop.</small></button>
  <button className="cp-secondary" disabled={busy} onClick={onDigitize}><Wand2 size={16}/> Digitize a photo or logo</button>
  <small className="cp-hint">Embroidery files open as stitches. Pictures are digitized automatically and added as editable artwork.</small>
 </div>;
}

export function CreatePanel({tab,busy,hoop,onClose,onInsertTemplate,onAddText,onTypeOnHoop,onUpload,onDigitize,elements}:{
 tab:CreateTab;busy:boolean;hoop:{width:number;height:number};onClose:()=>void;
 onInsertTemplate:(t:TemplateEntry)=>void;onAddText:(s:LetteringPreset)=>void;onTypeOnHoop:()=>void;onUpload:()=>void;onDigitize:()=>void;elements:ReactNode;
}){
 const title={templates:'Templates',text:'Text',elements:'Elements',uploads:'Uploads'}[tab];
 return <section className="create-panel" aria-label={title+' panel'} inert={busy||undefined}>
  <div className="cp-header"><h2>{title}</h2><button className="studio-tool-icon" aria-label={'Close '+title.toLowerCase()} title="Close panel" onClick={onClose}><X size={15}/></button></div>
  {tab==='templates'?<TemplatesTab busy={busy} onInsert={onInsertTemplate}/>
  :tab==='text'?<TextTab busy={busy} hoop={hoop} onAddText={onAddText} onTypeOnHoop={onTypeOnHoop}/>
  :tab==='uploads'?<UploadsTab busy={busy} onUpload={onUpload} onDigitize={onDigitize}/>
  :<div className="cp-body cp-elements">{elements}</div>}
 </section>;
}
