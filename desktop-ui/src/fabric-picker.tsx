import {useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ChevronDown, Search, X} from 'lucide-react';
import {compareNames, ListNavigation, matchesName, usePagedList} from './list-navigation';
import './fabric-picker.css';

type Fabric = {
  id: string; name: string; group: string; about: string; stabilizer: string; needle: string;
};

export function FabricPicker({value, onChange, disabled = false}: {
  value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const [profiles, setProfiles] = useState<Fabric[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    void invoke<Fabric[]>('fabric_catalog')
      .then(list => {
        if (!active) return;
        if (Array.isArray(list)) setProfiles(list);
        else setError('The fabric catalog is unavailable.');
      })
      .catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [attempt]);
  const selected = profiles.find(profile => profile.id === value);
  const results = profiles
    .filter(profile => matchesName([profile.name, profile.group, profile.id].join(' '), query))
    .sort((a, b) => compareNames(a.name, b.name));
  const page = usePagedList(results, query, 6);
  const name = selected?.name || (value === 'standard' ? 'Stable woven' : value);
  return <div className="fabric-picker">
    <span className="fabric-label">Fabric</span>
    <button className="fabric-trigger" aria-label={`Choose fabric, current fabric ${name}`} disabled={disabled}
      onClick={() => { setQuery(''); dialog.current?.showModal(); }}>
      {name}<ChevronDown size={15}/>
    </button>
    {selected && <details className="fabric-guide">
      <summary>Fabric and needle guidance</summary>
      <p>{selected.about}</p><p>{selected.stabilizer}</p><p>{selected.needle}</p>
      <p>Test these starting settings on a scrap of the same fabric and backing.</p>
    </details>}
    <dialog ref={dialog} className="studio-modal fabric-dialog" aria-label="Choose fabric"
      onClose={event => event.stopPropagation()}>
      <div className="studio-modal-heading"><h2>Choose fabric</h2>
        <button aria-label="Close fabric picker" onClick={() => dialog.current?.close()}><X size={17}/></button>
      </div>
      <label className="fabric-search"><Search size={16}/>
        <input autoFocus aria-label="Search fabrics" placeholder="Search fabric or garment" value={query}
          onChange={event => setQuery(event.target.value)}/>
      </label>
      {error ? <div><p role="alert">{error}</p><button onClick={() => setAttempt(previous => previous + 1)}>Retry</button></div>
        : !profiles.length ? <p role="status">Loading fabrics…</p> : !page.total && <p>No fabrics match your search.</p>}
      <div className="fabric-results">{page.items.map(profile =>
        <button key={profile.id} aria-pressed={value === profile.id} onClick={() => {
          dialog.current?.close();
          if (profile.id !== value) onChange(profile.id);
        }}>
          <span>{profile.name}</span><small>{profile.group}</small>
        </button>
      )}</div>
      <ListNavigation {...page}/>
    </dialog>
  </div>;
}
