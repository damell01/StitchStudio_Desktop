import {Circle, PenLine, Ruler, Spline, Square, X} from 'lucide-react';
import {useRef,useState,type PointerEvent} from 'react';

export type DrawingTool = 'pen'|'manual'|'satinBrush'|'rectangle'|'ellipse'|'measure';
type Point = [number,number];

const buttons = [
  {tool:'pen',label:'Pen path',icon:PenLine}, {tool:'manual',label:'Manual stitches',icon:Spline},
  {tool:'satinBrush',label:'Satin brush',icon:Spline}, {tool:'rectangle',label:'Rectangle',icon:Square},
  {tool:'ellipse',label:'Ellipse',icon:Circle}, {tool:'measure',label:'Measure',icon:Ruler},
] as const;

export function useCanvasDrawing(commit:(tool:Exclude<DrawingTool,'measure'>,points:Point[])=>void) {
  const [tool,setTool]=useState<DrawingTool|null>(null);
  const [points,setPoints]=useState<Point[]>([]);
  const [hover,setHover]=useState<Point|null>(null);
  const live=useRef<Point[]>([]);
  const pointer=useRef<number|null>(null);
  const clickTool=tool==='pen'||tool==='manual';
  function update(next:Point[]){live.current=next;setPoints(next);}
  function clear(){pointer.current=null;setHover(null);update([]);}
  function pick(next:DrawingTool|null){clear();setTool(next);}
  function finish(){
    if(tool&&tool!=='measure'&&live.current.length>=2){
      const path=live.current;clear();commit(tool,path);
    }
  }
  function down(event:PointerEvent<SVGSVGElement>,point:Point){
    if(!tool||event.button!==0)return false;
    if(clickTool){
      if(live.current.length<2048)update([...live.current,point]);
    }else{
      pointer.current=event.pointerId;
      update(tool==='satinBrush'?[point]:[point,point]);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    return true;
  }
  function move(event:PointerEvent<SVGSVGElement>,point:Point){
    if(!tool)return false;
    if(clickTool){setHover(point);return pointer.current===event.pointerId||event.buttons===0;}
    if(pointer.current!==event.pointerId)return false;
    if(tool==='satinBrush'){
      const last=live.current.at(-1)!;
      if(live.current.length<2048&&Math.hypot(last[0]-point[0],last[1]-point[1])>=.4)update([...live.current,point]);
    }else update([live.current[0],point]);
    return true;
  }
  function end(event:PointerEvent<SVGSVGElement>,point:Point|null,apply:boolean){
    if(pointer.current!==event.pointerId)return false;
    if(apply&&point)move(event,point);
    pointer.current=null;
    if(!apply)clear();
    else if(tool!=='measure')finish();
    return true;
  }
  return {tool,points,hover,clickTool,pick,finish,down,move,end};
}

type Drawing = ReturnType<typeof useCanvasDrawing>;

export function DrawingControls({drawing,disabled}:{drawing:Drawing;disabled:boolean}){
  const menu=useRef<HTMLDetailsElement>(null);
  const title=buttons.find(item=>item.tool===drawing.tool)?.label;
  return <div className="canvas-drawing-controls">
    <details ref={menu} className="canvas-drawing-menu">
      <summary title="Drawing and measurement tools"><PenLine size={17}/>{title??'Draw'}</summary>
      <div className="canvas-drawing-options">{buttons.map(({tool,label,icon:Icon})=><button
        key={tool} type="button" disabled={disabled} aria-pressed={drawing.tool===tool}
        onClick={()=>{drawing.pick(tool);if(menu.current)menu.current.open=false;}}><Icon size={16}/>{label}</button>)}</div>
    </details>
    {drawing.clickTool&&<button disabled={disabled||drawing.points.length<2} onClick={drawing.finish}>Finish path</button>}
    {drawing.tool&&<button className="studio-tool-icon" onClick={()=>drawing.pick(null)} aria-label="Exit drawing tool" title="Exit drawing tool"><X size={16}/></button>}
  </div>;
}

export function DrawingOverlay({drawing}:{drawing:Drawing}){
  const points=drawing.points;
  if(!points.length)return null;
  const [a,b=a]=points;
  const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(a[0]-b[0]),h=Math.abs(a[1]-b[1]);
  const line=[...points,...(drawing.hover&&drawing.clickTool?[drawing.hover]:[])];
  const color='#8054ae';
  return <g pointerEvents="none" stroke={color} fill="none" strokeWidth={1.6} className="canvas-drawing-overlay">
    {drawing.tool==='rectangle' ? <rect x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke"/> :
     drawing.tool==='ellipse' ? <ellipse cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} vectorEffect="non-scaling-stroke"/> :
     <polyline points={line.map(point=>point.join(',')).join(' ')} vectorEffect="non-scaling-stroke"/>}
    {drawing.tool==='measure'&&<text fill={color} stroke="none" x={b[0]} y={b[1]-2} fontSize="4">
      {(Math.hypot(w,h)/25.4).toFixed(3)} in · {Math.hypot(w,h).toFixed(2)} mm
    </text>}
  </g>;
}
