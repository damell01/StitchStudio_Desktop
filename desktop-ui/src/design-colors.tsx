// Canva-style color editing for embroidery: every thread color in the design is a swatch;
// pick one and change it everywhere, or only inside the current selection.
import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,Palette,MousePointerClick} from 'lucide-react';
import {readThreads} from './threads';
import './design-colors.css';

export type RGB=[number,number,number];
type Obj={uid:number;color:number[];hidden?:boolean;locked?:boolean};

const hex=(c:number[])=>'#'+c.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const rgb=(h:string):RGB|null=>/^#?[0-9a-f]{6}$/i.test(h)?[0,2,4].map(i=>parseInt(h.replace('#','').slice(i,i+2),16)) as RGB:null;
const key=(c:number[])=>c.slice(0,3).join(',');
/** Common embroidery thread shades, grouped light to dark per hue. */
const threadShades=['#ffffff','#f5efe3','#e8dcc4','#c9b48f','#8b6b4a','#5a3d2b','#2b211c','#111111',
 '#fbd3de','#f39ab5','#e0457b','#b8194f','#7a1035','#f7c9c0','#ef7b67','#d93a2b','#a3201b','#6b1410',
 '#ffe9a8','#ffd34d','#f5b400','#e88a1a','#c25e12','#d9f2c4','#9bd17a','#4caf50','#2e7d32','#1b4d2b',
 '#cfe8f7','#8cc8ec','#3d9ad1','#1f6fb2','#163f7a','#0d2347','#e4d7f5','#b79be6','#8a5cc9','#5e3596','#3b1f63',
 '#c7f0ea','#6fd1c3','#1f9e8f','#c0c0c0','#8c8c8c','#4d4d4d'];

function luminance(c:number[]){return (0.299*c[0]+0.587*c[1]+0.114*c[2])/255}

export type ColorScope='all'|'selection';
export function useDesignColors(blocks:{color:number[]}[]|undefined,objects:Obj[]){
  return useMemo(()=>{
    const map=new Map<string,{color:RGB;blocks:number;objects:number}>();
    for(const b of blocks??[]){const k=key(b.color);const e=map.get(k)??{color:b.color.slice(0,3) as RGB,blocks:0,objects:0};e.blocks++;map.set(k,e)}
    for(const o of objects){if(o.hidden)continue;const e=map.get(key(o.color));if(e)e.objects++}
    return [...map.values()];
  },[blocks,objects]);
}

/** Popover that recolors one design color. */
function ColorPicker({color,info,selectionCount,busy,onApply,onSelectAll,onClose,anchor}:{
  anchor:{left:number;top:number};color:RGB;info:{blocks:number;objects:number};selectionCount:number;busy:boolean;
  onApply:(next:RGB,scope:ColorScope)=>void;onSelectAll:()=>void;onClose:()=>void;
}){
  const [scope,setScope]=useState<ColorScope>(selectionCount?'selection':'all');
  const [custom,setCustom]=useState(hex(color));
  const ref=useRef<HTMLDivElement>(null);
  const threads=useMemo(()=>readThreads().slice(0,24),[]);
  useEffect(()=>{
    const down=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)&&!(e.target as HTMLElement).closest?.('.dc-swatch'))onClose()};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};
    document.addEventListener('pointerdown',down);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',down);document.removeEventListener('keydown',key)};
  },[onClose]);
  const pick=(h:string)=>{const next=rgb(h);if(next&&!busy)onApply(next,scope)};
  const current=hex(color);
  const left=Math.max(8,Math.min(anchor.left,window.innerWidth-292));
  return <div ref={ref} className="dc-popover" role="dialog" aria-label={'Change color '+current} style={{position:'fixed',left,top:anchor.top}}>
    <div className="dc-pop-head"><span className="dc-big" style={{background:current}}/><div><strong>{current.toUpperCase()}</strong>
      <small>{info.objects?info.objects+(info.objects===1?' object':' objects')+' · ':''}{info.blocks} sewing {info.blocks===1?'block':'blocks'}</small></div></div>
    {selectionCount>0&&<div className="dc-scope" role="group" aria-label="Where to change this color">
      <button aria-pressed={scope==='selection'} onClick={()=>setScope('selection')}>Selection only</button>
      <button aria-pressed={scope==='all'} onClick={()=>setScope('all')}>Whole design</button></div>}
    {threads.length>0&&<><h4>My threads</h4><div className="dc-grid">{threads.map(t=><button key={t.id} className="dc-chip" style={{background:t.color}} title={t.brand+' '+t.code+' · '+t.name} aria-label={'Use '+t.name} disabled={busy} onClick={()=>pick(t.color)}>{t.color.toLowerCase()===current&&<Check size={12}/>}</button>)}</div></>}
    <h4>Thread shades</h4>
    <div className="dc-grid">{threadShades.map(h=><button key={h} className="dc-chip" style={{background:h,color:luminance(rgb(h)!)>.6?'#222':'#fff'}} aria-label={'Use '+h} title={h} disabled={busy} onClick={()=>pick(h)}>{h===current&&<Check size={12}/>}</button>)}</div>
    <h4>Custom</h4>
    <div className="dc-custom"><input type="color" aria-label="Pick a custom color" value={rgb(custom)?custom:current} onChange={e=>setCustom(e.target.value)}/>
      <input aria-label="Hex color" value={custom} onChange={e=>setCustom(e.target.value.startsWith('#')?e.target.value:'#'+e.target.value)} spellCheck={false}/>
      <button className="primary" disabled={busy||!rgb(custom)||custom.toLowerCase()===current} onClick={()=>pick(custom)}>Apply</button></div>
    <button className="dc-link" disabled={busy} onClick={onSelectAll}><MousePointerClick size={14}/> Select everything this color</button>
  </div>;
}

/** Floating "design colors" bar (no selection) or swatches inside the selection toolbar. */
export function DesignColors({colors,selectionColors,selectionCount,busy,onApply,onSelectColor,compact}:{
  colors:{color:RGB;blocks:number;objects:number}[];selectionColors?:string[];selectionCount:number;busy:boolean;compact?:boolean;
  onApply:(previous:RGB,next:RGB,scope:ColorScope)=>void;onSelectColor:(color:RGB)=>void;
}){
  const [open,setOpen]=useState<string|null>(null),[anchor,setAnchor]=useState({left:0,top:0});
  const shown=selectionColors?colors.filter(c=>selectionColors.includes(key(c.color))):colors;
  if(!shown.length)return null;
  const active=shown.find(c=>key(c.color)===open);
  return <div className={'dc-bar'+(compact?' dc-compact':'')} role="group" aria-label={selectionColors?'Selection colors':'Design colors'}>
    {!compact&&<span className="dc-label"><Palette size={14}/> Colors</span>}
    {shown.slice(0,14).map(c=>{const h=hex(c.color);return <button key={h} className="dc-swatch" aria-pressed={open===key(c.color)} aria-label={'Change '+h} title={'Change '+h+' · '+c.blocks+' sewing blocks'}
      style={{background:h}} disabled={busy} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setAnchor({left:r.left-8,top:r.bottom+10});setOpen(o=>o===key(c.color)?null:key(c.color))}}/>})}
    {shown.length>14&&<span className="dc-more">+{shown.length-14}</span>}
    {active&&<ColorPicker anchor={anchor} color={active.color} info={active} selectionCount={selectionCount} busy={busy}
      onClose={()=>setOpen(null)} onSelectAll={()=>{onSelectColor(active.color);setOpen(null)}}
      onApply={(next,scope)=>{onApply(active.color,next,scope);setOpen(null)}}/>}
  </div>;
}
