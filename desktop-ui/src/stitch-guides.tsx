import {invoke} from '@tauri-apps/api/core';
import {useEffect,useRef,useState,type PointerEvent} from 'react';

type Point=[number,number];
type Handle='angle'|'entry'|'exit';
export type StitchControl={type:'angle';degrees:number}|{type:'entry'|'exit';point:Point|null}|
  {type:'reverse'|'outlines'|'restoreText'};
type Guides={
  order:[number,Point][];rails:[Point[],Point[]][];rungs:[Point,Point][];
  entry:Point|null;exit:Point|null;angle:number|null;center:Point|null;
  pinnedEntry:boolean;pinnedExit:boolean;textForm:'text'|'outlines'|null;reverses:boolean;
};

function degrees(center:Point,position:Point) {
  return Math.atan2(position[1]-center[1],position[0]-center[0])*180/Math.PI;
}

export function useStitchGuides(plan:object|null, uid:number|null, apply:(uid:number,action:StitchControl)=>void) {
  const [order,setOrder]=useState(false),[visible,setVisible]=useState(false);
  const [data,setData]=useState<Guides|null>(null);
  const [preview,setPreview]=useState<{handle:Handle;point:Point}|null>(null);
  const drag=useRef<{handle:Handle;id:number;uid:number;center:Point|null}|null>(null);
  useEffect(()=>{
    let active=true;
    setData(null);
    if(plan&&(order||uid!==null)){
      void invoke<Guides>('object_stitch_guides',{uid,order,rails:visible})
        .then(result=>{if(active)setData(result);}).catch(()=>{});
    }
    return ()=>{active=false;};
  },[plan,uid,order,visible]);

  function down(event:PointerEvent<SVGSVGElement>,point:Point) {
    const handle=event.target instanceof Element?event.target.closest('[data-stitch-handle]')?.getAttribute('data-stitch-handle'):null;
    if(!visible||!data||uid===null||event.button!==0||!['angle','entry','exit'].includes(handle??''))return false;
    const kind=handle as Handle;
    drag.current={handle:kind,id:event.pointerId,uid,center:data.center};
    setPreview({handle:kind,point});
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  }
  function move(event:PointerEvent<SVGSVGElement>,point:Point) {
    const active=drag.current;
    if(!active||event.pointerId!==active.id)return false;
    setPreview({handle:active.handle,point});
    return true;
  }
  function end(event:PointerEvent<SVGSVGElement>,point:Point|null) {
    const active=drag.current;
    if(!active||event.pointerId!==active.id)return false;
    drag.current=null;
    setPreview(null);
    if(!point||uid!==active.uid)return true;
    if(active.handle==='angle'){
      if(active.center)apply(uid,{type:'angle',degrees:degrees(active.center,point)});
    }else apply(uid,{type:active.handle,point});
    return true;
  }

  return {order,setOrder,visible,setVisible,data,preview,down,move,end};
}

export function StitchGuideOverlay({guides,zoom}:{guides:ReturnType<typeof useStitchGuides>;zoom:number}) {
  const {data,preview:drag,visible,order}=guides;
  if(!data)return null;
  const r=1.65*Math.max(.35,Math.min(2,100/zoom));
  const point=(key:'entry'|'exit')=>drag?.handle===key?drag.point:data[key];
  const rotation=data.center&&drag?.handle==='angle'?degrees(data.center,drag.point):data.angle;
  const rad=(rotation??0)*Math.PI/180;
  const handleAt=data.center?[data.center[0]+Math.cos(rad)*r*5,data.center[1]+Math.sin(rad)*r*5] as Point:null;
  return <g className="stitch-guides" pointerEvents="none">
    {order&&data.order.map(([number,[x,y]])=><g key={number} className="stitch-order-marker" aria-label={'Sewing object '+number}>
      <circle cx={x} cy={y} r={r*1.2}/><text x={x} y={y} fontSize={r*1.2} textAnchor="middle" dominantBaseline="central">{number}</text>
    </g>)}
    {visible&&data.rails.flatMap(([a,b],i)=>[a,b].map((line,j)=><polyline key={i+':'+j} className="satin-guide-rail" points={line.map(p=>p.join(',')).join(' ')} vectorEffect="non-scaling-stroke"/>))}
    {visible&&data.rungs.map(([[x1,y1],[x2,y2]],i)=><line key={i} className="satin-guide-rung" x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/>)}
    {visible&&data.center&&rotation!==null&&handleAt&&<g>
      <line className="stitch-angle-guide" x1={data.center[0]} y1={data.center[1]} x2={handleAt[0]} y2={handleAt[1]} vectorEffect="non-scaling-stroke"/>
      <circle className="stitch-guide-handle" data-stitch-handle="angle" cx={handleAt[0]} cy={handleAt[1]} r={r}>
        <title>Drag to change fill direction</title>
      </circle>
    </g>}
    {visible&&(['entry','exit'] as const).map(key=>{
      const p=point(key);
      const pinned=key==='entry'?data.pinnedEntry:data.pinnedExit;
      return p&&<g key={key}>
        <circle className={'stitch-guide-handle '+key} data-stitch-handle={key} data-pinned={pinned}
          cx={p[0]} cy={p[1]} r={r} aria-label={key==='entry'?'Sewing entry':'Sewing exit'}>
          <title>{key==='entry'?'Drag to set sewing entry':'Drag to set sewing exit'}{pinned?' · Pinned':''}</title>
        </circle>
        <text x={p[0]} y={p[1]} fontSize={r*1.05} textAnchor="middle" dominantBaseline="central">{key==='entry'?'IN':'OUT'}</text>
      </g>;
    })}
  </g>;
}
