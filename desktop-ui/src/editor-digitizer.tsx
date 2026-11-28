import {useEffect, useRef, useState} from 'react';
import {ImagePlus} from 'lucide-react';
import {Digitizer} from './digitizer';
import './ui-polish.css';

export function EditorDigitizer({active, disabled, onOpen, onClose, onInsert}: {
  active: {file: File | null} | null;
  disabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  onInsert: (id: number, strength: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [inserting, setInserting] = useState(false);
  const open = active !== null;
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  async function insert(id: number, strength: number) {
    setInserting(true);
    try {
      await onInsert(id, strength);
      onClose();
    } finally {
      setInserting(false);
    }
  }

  return <>
    <button type="button" className="studio-tool-icon" title="Import image and digitize" aria-label="Import image and digitize"
      aria-haspopup="dialog" disabled={disabled} onClick={onOpen}><ImagePlus size={18} aria-hidden="true"/></button>
    <dialog ref={dialog} className="studio-modal editor-digitizer expanded-digitizer" aria-label="Digitize an image"
      onCancel={event => {event.preventDefault(); if (!inserting) onClose();}}>
      <div className="studio-modal-heading">
        <h2>Digitize an image</h2>
        <button type="button" disabled={inserting} onClick={onClose}>Close</button>
      </div>
      {active && <Digitizer initialFile={active.file} onInsert={insert}/>}
    </dialog>
  </>;
}
