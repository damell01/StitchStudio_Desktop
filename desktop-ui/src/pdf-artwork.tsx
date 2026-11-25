import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Art = { name: string; mime: string; bytes: number[] };

async function openPdf(file: File) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = worker;
  return getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    maxImageSize: 16_000_000,
  }).promise;
}

async function renderPage(doc: PDFDocumentProxy, file: File, page: number): Promise<Art> {
  const source = await doc.getPage(page);
  const base = source.getViewport({ scale: 1 });
  if (!(base.width > 0 && base.height > 0 && Number.isFinite(base.width) && Number.isFinite(base.height))) {
    throw Error('PDF page dimensions are invalid');
  }
  const viewport = source.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw Error('Canvas unavailable');
  await source.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(result => result ? resolve(result) : reject(Error('PDF conversion failed')), 'image/png'));
  return {
    name: doc.numPages === 1 ? file.name : file.name + ' · page ' + page,
    mime: 'image/png',
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  };
}

export function PdfArtwork({ onArt, droppedFile }: { onArt: (art: Art) => void; droppedFile?: File | null }) {
  const [selected, setSelected] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (droppedFile) setSelected(droppedFile); }, [droppedFile]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setFile(null);
    setCount(0);
    setError('');
    setBusy(true);
    void (async () => {
      try {
        if (!selected.size || selected.size > 20_000_000) throw Error('PDF must be between 1 byte and 20 MB');
        const doc = await openPdf(selected);
        try {
          if (!active) return;
          if (doc.numPages === 1) {
            const art = await renderPage(doc, selected, 1);
            if (active) onArt(art);
          } else {
            setCount(doc.numPages);
            setPage(1);
            setFile(selected);
          }
        } finally {
          await doc.destroy();
        }
      } catch (err) {
        if (active) setError(String(err));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [selected, onArt]);

  async function render() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const doc = await openPdf(file);
      try { onArt(await renderPage(doc, file, page)); }
      finally { await doc.destroy(); }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return <section className="pdf-import">
    <label>Import PDF<input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => {
      setSelected(event.target.files?.[0] ?? null);
      event.target.value = '';
    }} /></label>
    {count > 1 && <>
      <label>Page (1–{count})<input type="number" min="1" max={count} value={page} disabled={busy} onChange={event => setPage(Number(event.target.value))} /></label>
      <button disabled={busy || !Number.isInteger(page) || page < 1 || page > count} onClick={render}>Use selected page</button>
    </>}
    {busy && <p role="status">Reading PDF locally…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
