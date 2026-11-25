import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { ListNavigation, matchesName, usePagedList } from './list-navigation';

export type Command = { label: string; group: string; run: () => void; disabled?: boolean };

export function CommandPalette({ commands }: { commands: Command[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const filtered = commands.filter(command => !command.disabled && matchesName(command.label + ' ' + command.group, query));
  const page = usePagedList(filtered, query, 8);

  function show() {
    if (!dialog.current || dialog.current.open) return;
    setQuery('');
    dialog.current.showModal();
    input.current?.focus();
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || event.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      show();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  function activate(command: Command) {
    dialog.current?.close();
    command.run();
  }

  return <>
    <button className="studio-tool-icon command-launch" aria-label="Search commands" title="Search commands (Ctrl+K or Cmd+K)" onClick={show}><Search size={17}/><span className="command-launch-label">Search tools and pages…</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="studio-modal command-dialog" aria-label="Search commands">
      <div className="studio-modal-heading"><h2>Search commands</h2><button onClick={()=>dialog.current?.close()}>Close</button></div>
      <label className="library-search"><Search size={17}/><input ref={input} value={query} placeholder="Find an action or page…" aria-label="Find an action or page"
        onChange={event=>setQuery(event.target.value)}
        onKeyDown={event=>{if(event.key==='Enter'&&page.items[0]){event.preventDefault();activate(page.items[0]);}}}/></label>
      {!filtered.length&&<p role="status">No matching commands.</p>}
      <div className="command-results">{page.items.map(command=><button key={command.group+command.label} onClick={()=>activate(command)}>
        <span>{command.label}</span><small>{command.group}</small>
      </button>)}</div>
      <ListNavigation {...page}/>
    </dialog>
  </>;
}
