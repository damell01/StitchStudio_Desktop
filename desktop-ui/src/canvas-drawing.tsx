import {Circle, PenLine, Ruler, Spline, Square, Star, Hexagon, Triangle, X} from 'lucide-react';
import {useRef,useState,type PointerEvent} from 'react';

export type DrawingTool = 'pen'|'freehand'|'star'|'hexagon'|'triangle'|'manual'|'satinBrush'|'satinColumn'|'rectangle'|'ellipse'|'measure';
type Point = [number,number];

export const drawingTools = [
  {tool:'pen',label:'Pen path',icon:PenLine,shortcut:'P'}, {tool:'freehand',label:'Freehand running stitch',icon:PenLine}, {tool:'star',label:'Star',icon:Star}, {tool:'hexagon',label:'Hexagon',icon:Hexagon}, {tool:'triangle',label:'Triangle',icon:Triangle}, {tool:'manual',label:'Manual stitches',icon:Spline},
  {tool:'satinBrush',label:'Satin brush',icon:Spline}, {tool:'satinColumn',label:'Satin column',icon:Spline}, {tool:'rectangle',label:'Rectangle',icon:Square},
  {tool:'ellipse',label:'Ellipse',icon:Circle}, {tool:'measure',label:'Measure',icon:Ruler,shortcut:'M'},
] satisfies {tool:DrawingTool;label:string;icon:typeof PenLine;shortcut?:string}[];

export function useCanvasDrawing(commit:(tool:Exclude<DrawingTool,'measure'>,points:Point[],subpaths?:Point[][],settings?:{color:number[];satinWidth:number})=>void) {
  const [tool,setTool]=useState<DrawingTool|null>(null);
  const [unit,setUnit]=useState<'both'|'mm'|'in'|'cm'>(()=>{const v=localStorage.getItem('studio-measure-unit');return v==='mm'||v==='in'||v==='cm'?v:'both'});
  function changeUnit(value:'both'|'mm'|'in'|'cm'){setUnit(value);localStorage.setItem('studio-measure-unit',value);}
  const [threadColor,setThreadColor]=useState('#6945a2');
  const [satinWidth,setSatinWidth]=useState(2.5);
  const settings=()=>({color:[1,3,5].map(i=>parseInt(threadColor.slice(i,i+2),16)),satinWidth});
  const [points,setPoints]=useState<Point[]>([]);
  const [column,setColumn]=useState<Point[][]>([]);
  const [hover,setHover]=useState<Point|null>(null);
  const live=useRef<Point[]>([]);
  const pointer=useRef<number|null>(null);
  const clickTool=tool==='pen'||tool==='manual';
  function update(next:Point[]){live.current=next;setPoints(next);}
  function clear(){pointer.current=null;setHover(null);update([]);}
  function pick(next:DrawingTool|null){clear();setColumn([]);setTool(next);}
  function finish(){
    if(tool==='satinColumn'){
      if(column.length>=2){commit(tool,[],column,settings());clear();setColumn([]);}
      return;
    }
    if(tool&&tool!=='measure'&&live.current.length>=2){
      const path=live.current;clear();commit(tool,path,undefined,settings());
    }
  }
  function down(event:PointerEvent<SVGSVGElement>,point:Point){
    if(!tool||event.button!==0)return false;
    if(tool==='satinColumn'&&column.length>=10)return true;
    if(clickTool){
      if(live.current.length<2048)update([...live.current,point]);
    }else{
      pointer.current=event.pointerId;
      update(tool==='freehand'||tool==='satinBrush'||tool==='satinColumn'&&column.length<2?[point]:[point,point]);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    return true;
  }
  function move(event:PointerEvent<SVGSVGElement>,point:Point){
    if(!tool)return false;
    if(clickTool){setHover(point);return pointer.current===event.pointerId||event.buttons===0;}
    if(pointer.current!==event.pointerId)return false;
    if(tool==='freehand'||tool==='satinBrush'||tool==='satinColumn'&&column.length<2){
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
    else if(tool==='satinColumn'){
      const line=live.current;
      if(line.length>=2&&line.some(([x,y])=>Math.hypot(x-line[0][0],y-line[0][1])>=.4)){
        setColumn(previous=>[...previous,line]);
      }
      update([]);
    }
    else if(tool!=='measure')finish();
    return true;
  }
  return {tool,points,column,hover,clickTool,pick,finish,down,move,end,unit,changeUnit,threadColor,setThreadColor,satinWidth,setSatinWidth};
}

type Drawing = ReturnType<typeof useCanvasDrawing>;

export function DrawingControls({drawing,disabled}:{drawing:Drawing;disabled:boolean}){
  const menu=useRef<HTMLDetailsElement>(null);
  const title=drawingTools.find(item=>item.tool===drawing.tool)?.label;
  return <div className="canvas-drawing-controls">
    <details ref={menu} className="canvas-drawing-menu">
      <summary title="Drawing and measurement tools"><PenLine size={17}/>{title??'Draw'}</summary>
      <div className="canvas-drawing-options">{drawingTools.map(({tool,label,icon:Icon,shortcut})=><button
        key={tool} type="button" title={shortcut?label+' ('+shortcut+')':label} disabled={disabled} aria-pressed={drawing.tool===tool}
        onClick={()=>{drawing.pick(tool);if(menu.current)menu.current.open=false;}}><Icon size={16}/>{label}</button>)}</div>
    </details>
    {drawing.tool==='satinColumn'&&<button disabled={disabled||drawing.column.length<2}
      aria-label="Finish satin column" onClick={drawing.finish}>
      {drawing.column.length<2?'Draw rail '+(drawing.column.length+1):'Finish column'}
    </button>}
    {drawing.clickTool&&<button disabled={disabled||drawing.points.length<2} onClick={drawing.finish}>Finish path</button>}
    {drawing.tool&&drawing.tool!=='measure'&&<input type="color" aria-label="Drawing thread color" title="Drawing thread color" value={drawing.threadColor} onChange={e=>drawing.setThreadColor(e.target.value)}/>}
    {drawing.tool==='satinBrush'&&<label>Width (mm)<input type="number" min=".5" max="10" step=".1" value={drawing.satinWidth} onChange={e=>drawing.setSatinWidth(Number(e.target.value))}/></label>}
    {drawing.tool==='measure'&&<select aria-label="Measurement units" value={drawing.unit} onChange={e=>drawing.changeUnit(e.target.value as 'both'|'mm'|'in'|'cm')}><option value="both">mm + in</option><option value="mm">mm</option><option value="in">in</option><option value="cm">cm</option></select>}
    {drawing.tool&&<button className="studio-tool-icon" onClick={()=>drawing.pick(null)} aria-label="Exit drawing tool" title="Exit drawing tool"><X size={16}/></button>}
  </div>;
}

export function DrawingOverlay({drawing}:{drawing:Drawing}){
  const points=drawing.points;
  if(!points.length&&!drawing.column.length)return null;
  const [a=[0,0],b=a]=points;
  const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(a[0]-b[0]),h=Math.abs(a[1]-b[1]);
  const line=[...points,...(drawing.hover&&drawing.clickTool?[drawing.hover]:[])];
  const color=drawing.tool==='measure'?'#8054ae':drawing.threadColor;
  return <g pointerEvents="none" stroke={color} fill="none" strokeWidth={1.6} className="canvas-drawing-overlay">
    {drawing.column.map((line,index)=><polyline key={index} points={line.map(p=>p.join(',')).join(' ')}
      strokeDasharray={index>1?'3 2':undefined} vectorEffect="non-scaling-stroke"/>)}
    {drawing.tool==='rectangle' ? <rect x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke"/> :
     drawing.tool==='ellipse' ? <ellipse cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} vectorEffect="non-scaling-stroke"/> :
     drawing.tool==='star'||drawing.tool==='hexagon'||drawing.tool==='triangle' ? <polygon points={Array.from({length:drawing.tool==='star'?10:drawing.tool==='triangle'?3:6},(_,i)=>{const n=drawing.tool==='star'?10:drawing.tool==='triangle'?3:6;const angle=2*Math.PI*i/n-Math.PI/2;const r=drawing.tool==='star'&&i%2===1 ? .45 : 1;return [x+w/2+w/2*r*Math.cos(angle),y+h/2+h/2*r*Math.sin(angle)].join(',')}).join(' ')} vectorEffect="non-scaling-stroke"/> :
     <polyline points={line.map(point=>point.join(',')).join(' ')} vectorEffect="non-scaling-stroke"/>}
    {drawing.tool==='measure'&&<g><path d={`M${a[0]} ${a[1]} H${b[0]} V${b[1]}`} strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/><text fill={color} stroke="none" x={(a[0]+b[0])/2} y={a[1]-2} fontSize="3.5" textAnchor="middle">{drawing.unit==='in'?(w/25.4).toFixed(3)+' in':drawing.unit==='cm'?(w/10).toFixed(2)+' cm':w.toFixed(2)+' mm'}</text><text fill={color} stroke="none" x={b[0]+2} y={(a[1]+b[1])/2} fontSize="3.5">{drawing.unit==='in'?(h/25.4).toFixed(3)+' in':drawing.unit==='cm'?(h/10).toFixed(2)+' cm':h.toFixed(2)+' mm'}</text><text fill={color} stroke="none" x={b[0]} y={b[1]-2} fontSize="4">
      {drawing.unit==='cm'?(Math.hypot(w,h)/10).toFixed(3)+' cm':drawing.unit==='mm'?Math.hypot(w,h).toFixed(2)+' mm':drawing.unit==='in'?(Math.hypot(w,h)/25.4).toFixed(3)+' in':(Math.hypot(w,h)/25.4).toFixed(3)+' in · '+Math.hypot(w,h).toFixed(2)+' mm'}
    </text></g>}
  </g>;
}
