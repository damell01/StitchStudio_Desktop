import {useRef,useState,type ReactNode} from 'react';
import {BookOpen,Search,X} from 'lucide-react';
import {ListNavigation,matchesName,usePagedList} from './list-navigation';
import './layer-dock.css';

export function LayerDialog({label,title,icon,children,iconOnly=false,disabled=false,onOpen}:{
  label:string;
  title:string;
  icon:ReactNode;
  children:(close:()=>void)=>ReactNode;
  iconOnly?:boolean;
  disabled?:boolean;
  onOpen?:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
  function close(){dialog.current?.close()}
  return <>
    <button type="button" className={iconOnly?'layer-row-action':'layer-option-button'}
      title={label} aria-label={label} aria-haspopup="dialog" disabled={disabled} onClick={()=>{
        onOpen?.();
        dialog.current?.showModal();
        setOpen(true);
      }}>{icon}{!iconOnly&&<span>{label}</span>}</button>
    <dialog ref={dialog} className="studio-modal layer-dialog" aria-label={title} onClose={()=>setOpen(false)}>
      <div className="studio-modal-heading">
        <h2>{title}</h2>
        <button type="button" aria-label="Close" onClick={close}><X size={16} aria-hidden="true"/></button>
      </div>
      {open&&children(close)}
    </dialog>
  </>;
}

type SavedThread={id:string;brand:string;code:string;name:string;color:string};

function SavedThreadList({threads,onChoose}:{threads:SavedThread[];onChoose:(thread:SavedThread)=>void}) {
  const [query,setQuery]=useState('');
  const page=usePagedList(threads.filter(thread=>
    matchesName(`${thread.brand} ${thread.code} ${thread.name} ${thread.color}`,query)),query,5);
  return <div className="layer-thread-picker">
    <label className="layers-search"><Search size={15} aria-hidden="true"/>
      <input autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)}
        aria-label="Search saved threads" placeholder="Search brand, name, or color"/>
    </label>
    {!page.total&&<p className="workspace-helper">No saved threads match your search.</p>}
    {page.items.map(thread=><button type="button" key={thread.id} className="layer-thread-choice" onClick={()=>onChoose(thread)}>
      <span className="layers-swatch" style={{backgroundColor:thread.color}} aria-hidden="true"/>
      <span className="layers-row-text"><strong>{thread.name}</strong><small>{thread.brand} {thread.code} · {thread.color.toUpperCase()}</small></span>
    </button>)}
    <ListNavigation {...page}/>
  </div>;
}

export function SavedThreadDialog({index,threads,onChoose,disabled}:{
  index:number;threads:SavedThread[];onChoose:(thread:SavedThread)=>void;disabled:boolean;
}) {
  return <LayerDialog label={`Assign saved thread ${index+1}`} title={`Choose saved thread for color ${index+1}`} iconOnly
    icon={<BookOpen size={14} aria-hidden="true"/>} disabled={disabled}>
    {close=><SavedThreadList threads={threads} onChoose={thread=>{onChoose(thread);close()}}/>}
  </LayerDialog>;
}
