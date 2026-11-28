// Shows what stitch type the selection uses and changes it in one click.
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Check} from 'lucide-react';
import {StitchIcon,stitchGuides} from './stitch-guide';
import './stitch-type-menu.css';

type Obj={uid:number;kind:string;fill_rule?:string};
/** Everyday choices first; specialty textures follow. */
const everyday=['auto','fill','satin','run'];
const specialty=['contour','ripple','meander','blanket','applique','cross'];
const names:Record<string,string>={auto:'Automatic',fill:'Fill',satin:'Satin',run:'Running',contour:'Contour',ripple:'Ripple',meander:'Meander',blanket:'Blanket',applique:'Appliqué',cross:'Cross-stitch',tartan:'Tartan',skip:'Not stitched',manual:'Fixed stitches'};

/** What the planner does with an object left on Automatic. */
export function stitchTypeLabel(o:Obj){
  if(o.kind!=='auto')return names[o.kind]??o.kind;
  return o.fill_rule?'Auto · Fill':'Auto · Running';
}

export function StitchTypeMenu({objects,busy,onChange}:{objects:Obj[];busy:boolean;onChange:(kind:string)=>void}){
  const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const down=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};
    document.addEventListener('pointerdown',down);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',down);document.removeEventListener('keydown',key)}},[open]);
  const editable=objects.filter(o=>o.kind!=='manual');
  if(!objects.length)return null;
  const kinds=Array.from(new Set(objects.map(o=>o.kind)));
  const current=kinds.length===1?kinds[0]:'';
  const label=kinds.length===1?stitchTypeLabel(objects[0]):'Mixed stitches';
  const fixed=!editable.length;
  return <div className="stm" ref={ref}>
    <button className="stm-chip" aria-haspopup="menu" aria-expanded={open} disabled={busy||fixed} title={fixed?'Imported machine stitches keep their stitch type':'Change stitch type'}
      aria-label={'Stitch type: '+label} onClick={()=>setOpen(o=>!o)}>
      <span className="stm-icon" aria-hidden="true"><StitchIcon kind={current&&current!=='manual'?current:'auto'}/></span>
      <span>{label}</span>{!fixed&&<ChevronDown size={14} aria-hidden="true"/>}
    </button>
    {open&&<div className="stm-menu" role="menu" aria-label="Stitch type">
      {[everyday,specialty].map((list,i)=><div key={i} className="stm-group">{i===1&&<small>Specialty</small>}
        {list.map(kind=>{const g=stitchGuides.find(s=>s.kind===kind);return <button key={kind} role="menuitemradio" aria-checked={current===kind} title={g?.tip}
          onClick={()=>{setOpen(false);if(kind!==current)onChange(kind)}}>
          <span className="stm-icon" aria-hidden="true"><StitchIcon kind={kind}/></span>
          <span className="stm-text"><strong>{names[kind]}</strong><small>{g?.tip}</small></span>
          {current===kind&&<Check size={15} aria-hidden="true"/>}
        </button>})}
      </div>)}
      {editable.length<objects.length&&<p className="stm-note">Imported machine stitches in the selection keep their stitches.</p>}
    </div>}
  </div>;
}
