import {ArrowDownUp, ArrowRight, Check, CircleHelp, Clock3, Scan, Scissors, Sparkles, X} from 'lucide-react';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import './assistant-chat.css';

type StitchPreview = {
  stitches: number;
  trims: number;
  blocks: {color: number[]; runs: number[][][]}[];
};

type Comparison = {
  before: StitchPreview;
  after: StitchPreview;
  beforeMinutes: number;
  afterMinutes: number;
};

export type AssistantProposal = {
  title: string;
  detail: string;
  comparison?: Comparison;
  apply: () => Promise<string>;
};

type Entry = {
  id: number;
  speaker: 'You' | 'Assistant';
  text: string;
};

const actions = [
  {label: 'Review stitches', prompt: 'Review design', Icon: Scissors},
  {label: 'Center in hoop', prompt: 'Center design', Icon: Scan},
  {label: 'Compare simpler stitches', prompt: 'Simplify design', Icon: Sparkles},
  {label: 'Recommend a hoop', prompt: 'Recommend a hoop', Icon: ArrowDownUp},
  {label: 'Explain underlay', prompt: 'Explain underlay', Icon: CircleHelp},
];

function PlanComparison({before, after, beforeMinutes, afterMinutes}: Comparison) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const plan of [before, after]) {
    for (const block of plan.blocks) {
      for (const run of block.runs) {
        for (const [x, y] of run) {
          left = Math.min(x, left); right = Math.max(x, right);
          top = Math.min(y, top); bottom = Math.max(y, bottom);
        }
      }
    }
  }
  const viewBox = Number.isFinite(left) ? [left - 2, top - 2, right - left + 4, bottom - top + 4].join(' ') : '0 0 10 10';
  const sides = [
    {label: 'Current', plan: before, minutes: beforeMinutes},
    {label: 'Proposed', plan: after, minutes: afterMinutes},
  ];
  return <div className="assistant-comparison" aria-label="Stitch plan comparison">
    {sides.map(({label, plan, minutes}) => <figure key={label}>
      <svg viewBox={viewBox} role="img" aria-label={label + ' stitch paths'}>
        {plan.blocks.map((block, i) => <g key={i} fill="none" stroke={'rgb('+block.color.join(' ')+')'}
          strokeWidth=".35" strokeLinecap="round" strokeLinejoin="round">
          {block.runs.map((run, j) => <polyline key={j} points={run.map(point => point.join(',')).join(' ')}/>)}
        </g>)}
      </svg>
      <figcaption><strong>{label}</strong><span>{plan.stitches.toLocaleString()} points · {plan.trims} trims</span>
        <span><Clock3 size={12} aria-hidden="true"/> Est. {minutes.toFixed(1)} min</span></figcaption>
    </figure>)}
  </div>;
}

export function AssistantChat({open, busy, onClose, onRequest}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRequest: (prompt: string) => Promise<string | AssistantProposal>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const processing = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [inputValue, setInput] = useState('');
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [operation, setOperation] = useState<'thinking' | 'applying' | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    input.current?.focus();
    return () => { if (element.open) element.close(); };
  }, [open]);

  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [entries, proposal, operation]);

  useEffect(() => {
    if (open && !operation && !busy) (proposal ? skip.current : input.current)?.focus();
  }, [open, operation, proposal, busy]);

  function append(speaker: Entry['speaker'], text: string) {
    const id = ++sequence.current;
    setEntries(previous => [...previous.slice(-29), {id, speaker, text}]);
  }

  async function request(prompt: string) {
    const text = prompt.trim();
    if (!text || processing.current || busy || proposal) return;
    processing.current = true;
    setInput('');
    append('You', text);
    setOperation('thinking');
    try {
      const result = await onRequest(text);
      if (typeof result === 'string') append('Assistant', result);
      else setProposal(result);
    } catch (error) {
      append('Assistant', error instanceof Error ? error.message : String(error));
    } finally {
      processing.current = false;
      setOperation(null);
    }
  }

  async function apply() {
    if (!proposal || processing.current || busy) return;
    processing.current = true;
    setOperation('applying');
    try {
      append('Assistant', await proposal.apply());
    } catch (error) {
      append('Assistant', error instanceof Error ? error.message : String(error));
    } finally {
      processing.current = false;
      setOperation(null);
      setProposal(null);
    }
  }

  function close() {
    if (processing.current) return;
    if (proposal) {
      setProposal(null);
      append('Assistant', 'Change skipped.');
    }
    onClose();
  }

  const disabled = busy || !!operation;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request(inputValue);
  }

  return <dialog ref={dialog} className="assistant-chat" aria-labelledby="assistant-chat-title"
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }}
    onCancel={event => {event.preventDefault(); close();}}>
    <header className="assistant-chat-heading">
      <span className="assistant-icon"><Sparkles size={21} aria-hidden="true"/></span>
      <div><h2 id="assistant-chat-title">Design assistant</h2><p><span/> Runs offline</p></div>
      <button className="studio-tool-icon" aria-label="Close design assistant" onClick={close} disabled={!!operation}>
        <X size={18} aria-hidden="true"/>
      </button>
    </header>
    <div className="assistant-chat-feed" role="log" aria-label="Assistant conversation" ref={feed}>
      {!entries.length && <div className="assistant-intro">
        <p>Describe an edit or choose a quick action. Review changes before applying them.</p>
        <small>Try “Rotate 90 degrees” or “Replace black with navy blue.”</small>
      </div>}
      {entries.map(entry => <div key={entry.id} className="assistant-msg" data-speaker={entry.speaker}>
        <span>{entry.speaker}</span><p>{entry.text}</p>
      </div>)}
      {proposal && <section className="assistant-proposal" aria-label="Proposed change">
        <div className="assistant-proposal-heading"><Sparkles size={17} aria-hidden="true"/><strong>{proposal.title}</strong></div>
        <p>{proposal.detail}</p>
        {proposal.comparison && <PlanComparison {...proposal.comparison}/>}
        <div className="assistant-proposal-actions">
          <button ref={skip} type="button" disabled={disabled} onClick={() => {
            setProposal(null);
            append('Assistant', 'Change skipped.');
          }}>Skip</button>
          <button type="button" className="primary" disabled={disabled} onClick={() => void apply()}>
            <Check size={16} aria-hidden="true"/> Apply change
          </button>
        </div>
      </section>}
      {operation && <p className="assistant-working" role="status">{operation==='applying'?'Applying change…':'Checking your request…'}</p>}
    </div>
    <footer className="assistant-controls">
      <div className="assistant-quick-actions" role="group" aria-label="Quick actions">
        {actions.map(({label, prompt, Icon}) => <button key={label} type="button" disabled={disabled||!!proposal}
          onClick={() => void request(prompt)}><Icon size={14} aria-hidden="true"/>{label}</button>)}
      </div>
      <form onSubmit={submit}>
        <label className="screen-reader-only" htmlFor="assistant-prompt">Ask the design assistant</label>
        <input id="assistant-prompt" ref={input} maxLength={160} value={inputValue} disabled={disabled||!!proposal}
          placeholder="Ask for a design edit…" onChange={event => setInput(event.target.value)}/>
        <button className="primary" aria-label="Send request" disabled={disabled||!!proposal||!inputValue.trim()}>
          <ArrowRight size={18} aria-hidden="true"/>
        </button>
      </form>
    </footer>
  </dialog>;
}
