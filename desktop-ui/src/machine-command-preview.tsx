import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight, ListOrdered } from 'lucide-react';
import './machine-command-preview.css';

type RecordPage = {
  total: number;
  stitches: number;
  jumps: number;
  trimJumps: number;
  colorChanges: number;
  records: { command: string; x: number; y: number; thread: number }[];
};

export function MachineCommandPreview({ format, width, height, disabled = false }: {
  format: string;
  width: number;
  height: number;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<{ page?: RecordPage; error?: string } | null>(null);
  const available = format === 'dst' || format === 'pes';

  useEffect(() => {
    if (!open || !available) return;
    let active = true;
    setResponse(null);
    void invoke<RecordPage>('preview_machine_commands', { format, width, height, offset })
      .then(page => { if (active) setResponse({ page }); })
      .catch(error => { if (active) setResponse({ error: String(error) }); });
    return () => { active = false; };
  }, [open, available, format, width, height, offset]);

  if (!available) return null;

  const formatLabel = format.toUpperCase();
  const page = response?.page;
  const counts = page ? [
    ['Stitches', page.stitches],
    ['Jumps', page.jumps],
    ['Trim jumps', page.trimJumps],
    ['Color changes', page.colorChanges],
  ] as const : [];

  return <>
    <button type="button" disabled={disabled} onClick={() => {
      setOffset(0);
      setResponse(null);
      dialog.current?.showModal();
      setOpen(true);
    }}><ListOrdered size={16} aria-hidden="true" /> Review {formatLabel} commands</button>
    <dialog ref={dialog} className="studio-modal machine-command-dialog" aria-label={formatLabel + ' machine commands'} onClose={event => { event.stopPropagation(); setOpen(false); }}>
      <div className="studio-modal-heading">
        <h2>{formatLabel} machine commands</h2>
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <p className="muted">Records from the generated export. Positions are in millimeters from the machine origin.</p>
      {response?.error && <p role="alert">{response.error}</p>}
      {!response && <p role="status">Reading encoded commands…</p>}
      {page && <>
        <dl className="machine-command-counts">
          {counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>)}
        </dl>
        <table className="machine-command-table">
          <thead><tr><th scope="col">Record</th><th scope="col">Command</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Thread</th></tr></thead>
          <tbody>{page.records.map((record, index) => <tr key={offset + index}>
            <th scope="row">{(offset + index + 1).toLocaleString()}</th><td>{record.command}</td>
            <td>{record.x.toFixed(1)}</td><td>{record.y.toFixed(1)}</td><td>{record.thread}</td>
          </tr>)}</tbody>
        </table>
        <footer className="machine-command-pagination">
          <p role="status">{(offset + 1).toLocaleString()}–{(offset + page.records.length).toLocaleString()} of {page.total.toLocaleString()} records</p>
          <button type="button" aria-label="Previous command page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 10))}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next command page" disabled={offset + page.records.length >= page.total} onClick={() => setOffset(offset + page.records.length)}><ChevronRight size={16} /></button>
        </footer>
        <p className="muted">{format === 'dst'
          ? 'DST encodes trim requests as a pattern of three jumps. Machine settings determine how the pattern is handled.'
          : 'This view uses the PEC stitch records embedded in PES. A trim flag can be carried by a jump record.'}</p>
      </>}
    </dialog>
  </>;
}
