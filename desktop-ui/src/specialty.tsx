import { ArrowUpRight, Download } from 'lucide-react';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirmAction, toast } from './dialogs';
import './specialty.css';

const shapes = [
  ['circle', 'Circle', 'M50 5 A45 45 0 0 1 50 95 A45 45 0 0 1 50 5 Z'],
  ['shield', 'Shield', 'M10 10 H90 V48 Q90 75 50 95 Q10 75 10 48 Z'],
  ['heart', 'Heart', 'M50 90 C-20 45 10 -10 50 25 C90 -10 120 45 50 90 Z'],
  ['rounded', 'Rounded square', 'M15 5 H85 Q95 5 95 15 V85 Q95 95 85 95 H15 Q5 95 5 85 V15 Q5 5 15 5 Z'],
] as const;

const appliqueSequence = [
  ['Placement', 'Stitch the outline on the base fabric.'],
  ['Tack-down', 'At the first stop, place the fabric and stitch it down.'],
  ['Finishing border', 'At the next stop, trim excess fabric if needed, then sew the border.'],
] as const;

const patchSequence = [
  ['Backing', 'Hoop backing suitable for the patch.'],
  ['Fill and border', 'Preview the fill and check edge coverage on a test sew.'],
  ['Finish', 'Finish or cut the patch using a suitable method.'],
] as const;

export function Specialty({ applique, onDone }: { applique: boolean; onDone: () => void }) {
  const [previewStage,setPreviewStage]=useState(2);
  const [shape, setShape] = useState<(typeof shapes)[number]>(shapes[0]);
  const [inches, setInches] = useState(String(Number((65 / 25.4).toFixed(3))));
  const [busy, setBusy] = useState<'design' | 'export' | null>(null);
  const [error, setError] = useState('');
  const width = Number(inches) * 25.4;
  const validWidth = inches.trim() !== '' && width >= 20 && width <= 200;

  async function create() {
    if (!await confirmAction('Replace the current design? Save any existing work first.')) return;
    setBusy('design');
    setError('');
    try {
      await invoke('create_specialty', { shape: shape[0], style: applique ? 'applique' : 'patch', width });
      toast('Design created');
      onDone();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  }

  async function exportOutline() {
    setBusy('export');
    setError('');
    try {
      if (await invoke<boolean>('export_applique_cut_svg', { shape: shape[0], width })) {
        toast('Cutting outline saved');
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(null);
    }
  }

  return <div className="specialty-workspace">
    <article className="specialty-preview">
      <div className="specialty-preview-heading"><h2>Design preview</h2><span>Illustrative stitch finish</span></div><div className="specialty-stage-tabs" role="group" aria-label="Preview sewing stage">{(applique?appliqueSequence:patchSequence).map(([label],i)=><button key={label} aria-pressed={previewStage===i} onClick={()=>setPreviewStage(i)}>{i+1}. {label}</button>)}</div><div className="specialty-figure">
        <svg viewBox="0 0 120 120" role="img" aria-label={shape[1] + ' artwork outline'}>
          <defs><pattern id="specialty-fabric" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#f9f4ff"/><path d="M0 2H8 M2 0V8" stroke="#b89ad9" strokeWidth="3" opacity=".4"/></pattern></defs><path transform="translate(10 10)" d={shape[2]} fill={previewStage===0?"none":"url(#specialty-fabric)"} stroke="var(--specialty-accent)" strokeWidth={previewStage===2?"4":"1.3"} strokeDasharray={previewStage===2?undefined:"2 1.5"}/>{previewStage===2&&<path transform="translate(10 10)" d={shape[2]} fill="none" stroke="#e3d0f7" strokeWidth="2.6" strokeDasharray=".35 .8"/>}
        </svg>
      </div>
      <div className="specialty-figure-caption">
        <strong>{shape[1]}</strong>
        {validWidth && <span>{Number(inches).toFixed(2)} in · {width.toFixed(1)} mm wide</span>}
      </div>
      <div className="specialty-sequence">
        <h2>Sewing sequence</h2>
        <ol>
          {(applique ? appliqueSequence : patchSequence).map(([label, note]) =>
            <li key={label}><strong>{label}</strong><p>{note}</p></li>
          )}
        </ol>
        {applique && <p className="muted">Check that your machine stops at the placement and tack-down changes during a test sew.</p>}
      </div>
    </article>
    <article className="specialty-controls">
      <h2>Shape</h2>
      <div className="specialty-shapes" role="group" aria-label="Choose a shape">
        {shapes.map((preset) => <button
          type="button" key={preset[0]} aria-pressed={shape === preset} disabled={busy !== null}
          onClick={() => setShape(preset)}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true"><path d={preset[2]} fill="currentColor" /></svg>
          {preset[1]}
        </button>)}
      </div>
      <div className="specialty-size">
        <label htmlFor="specialty-width">Artwork width</label>
        <div className="specialty-size-input">
          <input id="specialty-width" type="number" step="any" min={20 / 25.4} max={200 / 25.4}
            value={inches} onChange={event => setInches(event.target.value)} disabled={busy !== null}
            aria-describedby="specialty-dimensions" />
          <span>in</span>
        </div>
        <p id="specialty-dimensions" aria-live="polite">{validWidth ? width.toFixed(1) + ' mm' : 'Enter a width between 20 and 200 mm.'}</p>
      </div>
      <div className="specialty-actions">
        <button className="primary" disabled={busy !== null || !validWidth} onClick={() => void create()}>
          <ArrowUpRight size={17} /> {busy === 'design' ? 'Generating…' : 'Create in Design Studio'}
        </button>
        {applique && <>
          <button disabled={busy !== null || !validWidth} onClick={() => void exportOutline()}>
            <Download size={16} /> {busy === 'export' ? 'Saving outline…' : 'Export cutting SVG'}
          </button>
          <p>The SVG follows the placement outline at the current size, with zero fabric allowance.</p>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  </div>;
}
