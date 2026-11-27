import {useEffect,useRef,useState} from 'react';
import {Fonts} from './fonts';
import type {FontDrop} from './font-drop';

export function FontDropDialog({drop,onClose}: {drop:FontDrop;onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return <dialog ref={dialog} className="studio-modal font-drop-dialog" aria-label="Import fonts" onCancel={event=>{if(busy)event.preventDefault()}} onClose={onClose}>
    <div className="studio-modal-heading">
      <h2>Import fonts</h2>
      <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button>
    </div>
    <Fonts initialDrop={drop} onBusyChange={setBusy}/>
  </dialog>;
}
