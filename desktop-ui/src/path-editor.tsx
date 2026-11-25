import {ChevronLeft, ChevronRight, GitCommitHorizontal, Spline, Trash2, X, ZoomIn, ZoomOut} from 'lucide-react';
import {invoke} from '@tauri-apps/api/core';
import {useId, useMemo, useRef, useState, type PointerEvent} from 'react';
import './path-editor.css';

type Point = [number, number];
type Node = {p: Point; incoming: Point; outgoing: Point};
type Path = {closed: boolean; nodes: Node[]};
type PathData = {revision: string; manual: boolean; paths: Path[]};
type ObjectInfo = {uid: number; label: string; kind: string; groups?: string[]};
type Selection = {path: number; node: number};
type Frame = [number, number, number, number];
type Target = 'p' | 'incoming' | 'outgoing';

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const corner = (p: Point): Node => ({p, incoming: p, outgoing: p});

function pathOutline({nodes, closed}: Path) {
  if (!nodes.length) return '';
  let outline = 'M ' + nodes[0].p.join(' ');
  const end = nodes.length - (closed ? 0 : 1);
  for (let index = 0; index < end; index++) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    outline += same(from.p, from.outgoing) && same(to.incoming, to.p)
      ? ' L ' + to.p.join(' ')
      : ' C ' + [...from.outgoing, ...to.incoming, ...to.p].join(' ');
  }
  return outline + (closed ? ' Z' : '');
}

function framePath(paths: Path[]): Frame {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const path of paths) for (const node of path.nodes) {
    for (const [x, y] of [node.p, node.incoming, node.outgoing]) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const padding = Math.max(.8, Math.max(right - left, bottom - top) * .09);
  return [left - padding, top - padding, right - left + 2 * padding, bottom - top + 2 * padding];
}

function moveNode(node: Node, target: Target, point: Point): Node {
  if (target !== 'p') return {...node, [target]: point};
  const delta: Point = [point[0] - node.p[0], point[1] - node.p[1]];
  const translate = ([x, y]: Point): Point => [x + delta[0], y + delta[1]];
  return {p: point, incoming: translate(node.incoming), outgoing: translate(node.outgoing)};
}

function insertAfter(nodes: Node[], index: number) {
  const next = (index + 1) % nodes.length;
  const from = nodes[index], to = nodes[next];
  const output = [...nodes];
  if (same(from.p, from.outgoing) && same(to.incoming, to.p)) {
    output.splice(index + 1, 0, corner(midpoint(from.p, to.p)));
    return output;
  }
  // Split the Bézier at its midpoint, preserving the original curve.
  const a = midpoint(from.p, from.outgoing);
  const b = midpoint(from.outgoing, to.incoming);
  const c = midpoint(to.incoming, to.p);
  const incoming = midpoint(a, b);
  const outgoing = midpoint(b, c);
  output[index] = {...from, outgoing: a};
  output[next] = {...to, incoming: c};
  output.splice(index + 1, 0, {p: midpoint(incoming, outgoing), incoming, outgoing});
  return output;
}

export function PathEditor<Plan>({object, disabled, onApply}: {
  object: ObjectInfo;
  disabled: boolean;
  onApply: (plan: Plan) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ticket = useRef(0);
  const id = useId();
  const [loaded, setLoaded] = useState<PathData>();
  const [paths, setPaths] = useState<Path[]>([]);
  const [selection, select] = useState<Selection>({path: 0, node: 0});
  const [frame, setFrame] = useState<Frame>([0, 0, 100, 100]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const active = paths[selection.path];
  const selected = active?.nodes[selection.node];
  const count = paths.reduce((sum, path) => sum + path.nodes.length, 0);
  const isStitch = object.kind === 'manual';
  const title = isStitch ? 'Edit stitch points' : 'Edit artwork nodes';
  const textObject = object.groups?.some(group => group.startsWith('tl-lettering-'));
  const drag = useRef<{id: number; selection: Selection; target: Target; original: Node; start: Point} | null>(null);
  const hitRadius = Math.max(.08, Math.max(frame[2], frame[3]) / 85);
  const nodeMarks = useMemo(() => paths.map(path => path.nodes.map(({p}) =>
    `M ${p[0]} ${p[1]}h0.001`).join(' ')).join(' '), [paths]);

  async function open() {
    const current = ++ticket.current;
    setError('');
    setLoaded(undefined);
    setPaths([]);
    setDirty(false);
    setLoading(true);
    dialog.current?.showModal();
    try {
      const result = await invoke<PathData>('artwork_path', {uid: object.uid});
      if (current !== ticket.current) return;
      setLoaded(result);
      setPaths(result.paths);
      setFrame(framePath(result.paths));
      select({path: 0, node: 0});
    } catch (reason) {
      if (current === ticket.current) setError(String(reason));
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }

  function close() {
    if (saving) return;
    ++ticket.current;
    dialog.current?.close();
  }

  async function save() {
    if (!loaded || !dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await invoke<Plan>('update_artwork_path', {uid: object.uid, revision: loaded.revision, paths});
      dialog.current?.close();
      onApply(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  function changeNode(at: Selection, replacement: Node) {
    setPaths(current => current.map((part, path) => path === at.path
      ? {...part, nodes: part.nodes.map((node, index) => index === at.node ? replacement : node)}
      : part));
    setDirty(true);
  }

  function position(event: PointerEvent<SVGSVGElement>): Point | undefined {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  }

  function startDrag(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || saving || !active) return;
    const start = position(event);
    if (!start) return;
    const hit = (event.target as Element).getAttribute('data-handle');
    if ((hit === 'incoming' || hit === 'outgoing') && selected) {
      drag.current = {id: event.pointerId, selection, target: hit, original: selected, start};
    } else {
      let found: Selection | undefined;
      let distance = hitRadius * 1.8;
      paths.forEach((part, path) => part.nodes.forEach(({p}, node) => {
        const next = Math.hypot(p[0] - start[0], p[1] - start[1]);
        if (next < distance) {
          distance = next;
          found = {path, node};
        }
      }));
      if (!found) return;
      select(found);
      drag.current = {id: event.pointerId, selection: found, target: 'p', original: paths[found.path].nodes[found.node], start};
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    const move = drag.current;
    const end = position(event);
    if (!move || move.id !== event.pointerId || !end) return;
    const from = move.original[move.target];
    const next: Point = [from[0] + end[0] - move.start[0], from[1] + end[1] - move.start[1]];
    if (!same(from, next)) changeNode(move.selection, moveNode(move.original, move.target, next));
  }

  function stopDrag(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function modifySection(nodes: Node[], node: number) {
    setPaths(parts => parts.map((part, index) => index === selection.path ? {...part, nodes} : part));
    select({...selection, node});
    setDirty(true);
  }

  function adjacent(delta: number) {
    let path = selection.path;
    let node = selection.node + delta;
    if (node < 0 && path > 0) {
      path--;
      node = paths[path].nodes.length - 1;
    }
    if (node >= paths[path].nodes.length && path < paths.length - 1) {
      path++;
      node = 0;
    }
    if (node >= 0 && node < paths[path].nodes.length) select({path, node});
  }

  function zoom(factor: number) {
    if (!selected) return;
    const [x, y] = selected.p;
    setFrame([x - frame[2] * factor / 2, y - frame[3] * factor / 2, frame[2] * factor, frame[3] * factor]);
  }

  return <>
    <button type="button" ref={trigger} className="studio-tool-icon" title={textObject ? 'Use Edit lettering for text' : title}
      aria-label={title} disabled={disabled || textObject} onClick={() => void open()}>
      {isStitch ? <GitCommitHorizontal size={16} aria-hidden="true"/> : <Spline size={16} aria-hidden="true"/>}
    </button>
    <dialog className="path-editor" ref={dialog} aria-labelledby={id}
      onCancel={event => {event.preventDefault(); close();}} onClose={() => trigger.current?.focus()}>
      <header>
        <div><h2 id={id}>{title}</h2><p>{object.label || 'Selected object'}</p></div>
        <button type="button" className="studio-tool-icon" aria-label="Close point editor" disabled={saving} onClick={close}>
          <X size={17} aria-hidden="true"/>
        </button>
      </header>
      {loading && <p className="path-editor-status" role="status">Loading point geometry…</p>}
      {loaded && active && selected && <div className="path-editor-content">
        <div className="path-editor-work">
          <div className="path-editor-view" role="group" aria-label="Point editor view">
            <button type="button" onClick={() => setFrame(framePath(paths))}>Fit path</button>
            <button type="button" className="studio-tool-icon" title="Zoom in on point" aria-label="Zoom in on point" disabled={Math.max(frame[2], frame[3]) < 1} onClick={() => zoom(.65)}><ZoomIn size={16}/></button>
            <button type="button" className="studio-tool-icon" title="Zoom out on point" aria-label="Zoom out on point" disabled={Math.max(frame[2], frame[3]) > 2_000} onClick={() => zoom(1 / .65)}><ZoomOut size={16}/></button>
          </div>
          <svg aria-label="Point editing canvas" className="path-editor-canvas" viewBox={frame.join(' ')}
            onPointerDown={startDrag} onPointerMove={updateDrag} onPointerUp={stopDrag}
            onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
            {paths.map((path, index) => <path key={index} className="path-editor-outline" d={pathOutline(path)} vectorEffect="non-scaling-stroke"/>)}
            <path className="path-editor-node-marks" d={nodeMarks} vectorEffect="non-scaling-stroke"/>
            {!isStitch && (['incoming', 'outgoing'] as const).map(handle => !same(selected.p, selected[handle]) && <g key={handle}>
              <line className="path-editor-handle-line" x1={selected.p[0]} y1={selected.p[1]} x2={selected[handle][0]} y2={selected[handle][1]} vectorEffect="non-scaling-stroke"/>
              <circle className="path-editor-handle" cx={selected[handle][0]} cy={selected[handle][1]} r={hitRadius}
                data-handle={handle} vectorEffect="non-scaling-stroke"><title>Drag the {handle} Bézier handle</title></circle>
            </g>)}
            <circle className="path-editor-active-node" cx={selected.p[0]} cy={selected.p[1]} r={hitRadius}
              vectorEffect="non-scaling-stroke" data-active-node><title>Drag selected point</title></circle>
          </svg>
        </div>
        <section className="path-editor-options">
          <div className="path-editor-pager">
            <button type="button" className="studio-tool-icon" aria-label="Previous point" disabled={saving || (selection.path === 0 && selection.node === 0)} onClick={() => adjacent(-1)}><ChevronLeft size={16}/></button>
            <span>Point {selection.node + 1} / {active.nodes.length}
              {paths.length > 1 && <small>Path {selection.path + 1} / {paths.length}</small>}</span>
            <button type="button" className="studio-tool-icon" aria-label="Next point" disabled={saving || (selection.path === paths.length - 1 && selection.node === active.nodes.length - 1)} onClick={() => adjacent(1)}><ChevronRight size={16}/></button>
          </div>
          <div className="path-editor-fields">
            {(['X', 'Y'] as const).map((axis, index) => <label key={axis}>{axis} (mm)
              <input type="number" step={isStitch ? '.1' : '.01'} min="-5000" max="5000" disabled={saving}
                value={Number(selected.p[index].toFixed(3))} onChange={event => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  const point: Point = [...selected.p];
                  point[index] = value;
                  changeNode(selection, moveNode(selected, 'p', point));
                }}/>
            </label>)}
          </div>
          <button type="button" disabled={saving || count >= 12_000 || (!active.closed && selection.node === active.nodes.length - 1)}
            onClick={() => modifySection(insertAfter(active.nodes, selection.node), selection.node + 1)}>Insert after point</button>
          <button type="button" disabled={saving || active.nodes.length <= (active.closed ? 3 : 2)}
            onClick={() => modifySection(active.nodes.filter((_, index) => index !== selection.node), Math.min(selection.node, active.nodes.length - 2))}>
            <Trash2 size={15} aria-hidden="true"/> Erase point
          </button>
          <p>{isStitch ? 'Move, insert or erase individual needle positions. Nearby stitch lengths may change.'
            : 'Drag a node or its Bézier handles. Applying changes regenerates stitches from the outline.'}</p>
        </section>
      </div>}
      {error && <p className="path-editor-status" role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={close} disabled={saving}>Cancel</button>
        {loaded && <button type="button" disabled={!dirty || saving} onClick={() => {
          setPaths(loaded.paths); setFrame(framePath(loaded.paths)); select({path: 0, node: 0}); setDirty(false); setError('');
        }}>Reset points</button>}
        <button type="button" className="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Applying…' : 'Apply changes'}
        </button>
      </footer>
    </dialog>
  </>;
}
