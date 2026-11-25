import {useRef} from 'react';
import {ListOrdered,X} from 'lucide-react';
import {ListNavigation,usePagedList} from './list-navigation';

export type ThreadAssignments=Record<number,string>;
type Block = {color:number[]; runs:number[][][]};

export function ThreadOrder({blocks,format,machine,assignments,onAssign}:{blocks:Block[];format:string;machine:string;assignments:ThreadAssignments;onAssign:(index:number,value:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const page=usePagedList(blocks,'thread-order',8);
  return <>
    <button className="studio-tool-icon" aria-label="Thread order" title="Thread order and machine color mapping" disabled={!blocks.length} onClick={()=>dialog.current?.showModal()}><ListOrdered size={18}/></button>
    <dialog className="studio-modal thread-order-dialog" ref={dialog} aria-label="Thread order">
      <div className="studio-modal-heading"><h2>Thread order</h2><button aria-label="Close thread order" onClick={()=>dialog.current?.close()}><X size={17}/></button></div>
      <p>{machine||'Manual machine setup'} · {format.toUpperCase()} · {blocks.length} {blocks.length===1?'color block':'color blocks'}</p>
      <p>Use the block numbers to match thread colors on your machine. Enter a needle number or spool label for reference.{format==='dst'?' DST carries color-change positions. Use these swatches to match the colors by hand.':''}</p>
      <table className="thread-order-table">
        <thead><tr><th scope="col">Block</th><th scope="col">Design color</th><th scope="col">Needle or spool</th></tr></thead>
        <tbody>{page.items.map((block,offset)=>{
          const index=page.start+offset;
          const color='#'+block.color.map(channel=>channel.toString(16).padStart(2,'0')).join('').toUpperCase();
          return <tr key={index}>
            <th scope="row">{index+1}</th>
            <td><span className="thread-order-swatch" style={{backgroundColor:color}}/>{color}</td>
            <td><input aria-label={`Needle or spool for block ${index+1}`} maxLength={40} placeholder="e.g. 3 or White" value={assignments[index]??''}
              onChange={event=>onAssign(index,event.target.value)}/></td>
          </tr>;
        })}</tbody>
      </table>
      <ListNavigation {...page}/>
      <p className="muted">Assignments are included in the export worksheet and companion files. Apply them on the machine; DST does not carry thread labels.</p>
    </dialog>
  </>;
}
