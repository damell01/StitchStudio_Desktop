import {useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import './workspace-inspector.css';

export function InspectorDialog({label,title,children,disabled=false,className=''}:{
  label:ReactNode;
  title:string;
  children:ReactNode;
  disabled?:boolean;
  className?:string;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);

  return <>
    <button className={className} disabled={disabled} onClick={()=>{
      dialog.current?.showModal();
      setOpen(true);
    }}>{label}</button>
    <dialog className="studio-modal inspector-dialog" ref={dialog} aria-label={title} onClose={()=>setOpen(false)}>
      <div className="studio-modal-heading">
        <h2>{title}</h2>
        <button aria-label={`Close ${title.toLowerCase()}`} onClick={()=>dialog.current?.close()}>
          <X size={17} aria-hidden="true"/>
        </button>
      </div>
      {open&&<div className="inspector-dialog-content">{children}</div>}
    </dialog>
  </>;
}

export function StitchLengthReport({blocks,trims}:{blocks:{runs:number[][][]}[];trims:number}) {
  let short=0,long=0;
  for(const block of blocks)for(const run of block.runs){
    for(let index=1;index<run.length;index++){
      const distance=Math.hypot(run[index][0]-run[index-1][0],run[index][1]-run[index-1][1]);
      if(distance<.3)short++;
      if(distance>7)long++;
    }
  }
  return <>
    <dl className="inspector-diagnostics">
      <div><dt>Segments under 0.3 mm</dt><dd>{short.toLocaleString()}</dd></div>
      <div><dt>Segments over 7 mm</dt><dd>{long.toLocaleString()}</dd></div>
    </dl>
    {short>0&&<p>Inspect short stitches for thread buildup.</p>}
    {long>0&&<p>Inspect long spans for snagging. Export may subdivide them.</p>}
    {trims>50&&<p>Inspect dense groups of trims and check the sewing order.</p>}
    <p className="muted">These counts are based on the stitch plan. Test sew before production.</p>
  </>;
}
