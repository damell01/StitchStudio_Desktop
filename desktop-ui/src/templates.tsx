import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, Search, Star, X } from 'lucide-react';
import studioCatalogue from './studio-templates.json';
import twemojiCatalogue from './twemoji-templates.json';

type Attribution = { credit: string; license: string; licenseUrl: string; sourceUrl: string };
export type Template = { id: string; name: string; category: string; art: string; tags?: string[]; collection?: string; attribution?: Attribution };

const isPremium = (template: Template) => template.collection === 'boutique';

const twemojiAssets = import.meta.glob<string>('./assets/twemoji/*.svg', {
  query: '?raw', import: 'default', eager: true,
});
const twemojiTemplates: Template[] = twemojiCatalogue.map(({id,name,category,tags,asset,...attribution}) => ({
  id, name, category, tags, attribution,
  art: twemojiAssets[`./assets/twemoji/${asset}.svg`],
}));

// Generated artwork is intentionally labeled draft until reviewed.
const curatedAssets = import.meta.glob<string>('./assets/curated/*.svg', {query:'?raw',import:'default',eager:true});
const curatedTemplates: Template[] = Object.entries(curatedAssets).map(([path,art])=>{
  const slug=path.split('/').pop()!.replace(/\.svg$/,'');
  const categories: [RegExp,string,string[]][] = [
    [/baseball|football|sports-ball|all-star|game-day/,'Sports',['game day','varsity','sports']],
    [/mallard|retriever|fawn/,'Animals',['wildlife','vintage','outdoors']],
    [/tractor|construction/,'Farm & construction',['vehicles','children']],
    [/coastal|sailboat/,'Coastal',['nautical','beach']],
    [/easter|bunny|pumpkin|autumn/,'Seasonal',['holiday','boutique']],
    [/teddy/,'Nursery',['baby','heirloom']],
    [/crest|monogram|nameplate/,'Frames',['personalization','heirloom']],
    [/western/,'Western',['cowboy','boutique']],
  ];
  const match=categories.find(([pattern])=>pattern.test(slug));
  return {id:'curated-'+slug,name:slug.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase()),category:match?.[1] ?? 'Curated drafts',tags:['curated','draft','review required',...slug.split('-'),...(match?.[2] ?? [])],art};
});
export const templates: Template[] = [
  ...curatedTemplates,
  ...studioCatalogue,
  ...twemojiTemplates,
];
type TemplatePlan = { stitches: number; trims: number; blocks: { color: number[]; runs: number[][][] }[] };

export function TemplateAttribution({template}: {template: Template}) {
  const attribution = template.attribution;
  if (!attribution) return null;
  return <small className="muted">
    <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">{attribution.credit}</a> ·{' '}
    <a href={attribution.licenseUrl} target="_blank" rel="noreferrer">{attribution.license}</a>
    {' '}· Stitch rendering adapts the source artwork.
  </small>;
}

function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberTemplate(id:string){
  const next=[id,...readIds('studio-design-recent').filter(previous=>previous!==id)].slice(0,20);
  localStorage.setItem('studio-design-recent',JSON.stringify(next));
  window.dispatchEvent(new Event('studio-template-used'));
  return next;
}
function TemplatePreview({ template, widthMm, insert, onCancel, onChoose }: {
  template: Template; widthMm: number; insert: boolean; onCancel: () => void; onChoose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    setPlan(null);
    setError('');
    let active = true;
    void invoke<TemplatePlan>('preview_template', { id: template.id, art: template.art, widthMm })
      .then(result => { if (active) setPlan(result); })
      .catch(err => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, [template, widthMm]);
  return <dialog ref={dialog} className="studio-modal template-preview-dialog" aria-label={template.name} onClose={onCancel}>
    <header className="studio-modal-heading">
      <div><small>{template.category}{isPremium(template)?' · Boutique collection':''}</small><h2>{template.name}</h2></div>
      <button title="Close preview" aria-label="Close preview" onClick={onCancel}><X size={18} /></button>
    </header>
    <div className="template-preview-grid">
      <section><h3>Artwork</h3><svg viewBox="0 0 100 100" dangerouslySetInnerHTML={{ __html: template.art }} /></section>
      <section><h3>Stitch preview</h3>
        {plan ? <svg aria-label="Generated template stitches" viewBox={`${-widthMm / 2} ${-widthMm / 2} ${widthMm} ${widthMm}`}>
          {plan.blocks.map((block, index) => <g key={index} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth=".28">
            {block.runs.map((run, runIndex) => <polyline key={runIndex} points={run.map(point => point.join(',')).join(' ')} />)}
          </g>)}
        </svg> : <p role={error ? 'alert' : 'status'}>{error || 'Generating stitches…'}</p>}
      </section>
    </div>
    {plan && <p>{plan.stitches.toLocaleString()} stitch points · {plan.blocks.length} color blocks · {plan.trims} planned trims · Approx. {Math.ceil(plan.stitches / 600 + plan.trims * 3 / 60)} min at 600 stitches/min</p>}
    <TemplateAttribution template={template} />
    <footer className="studio-modal-actions">
      <button onClick={onCancel}>Back to library</button>
      <button className="primary" disabled={!plan} onClick={onChoose}>
        {insert ? 'Insert design' : 'Open in design studio'} <ArrowRight size={15} />
      </button>
    </footer>
  </dialog>;
}

type TemplateLibraryProps = {
  selectedId?: string;
  quickInsert?: boolean;
} & ({ onChoose: (id: string) => void; insert?: boolean; widthMm?: number; onPreview?: never } |
     { onPreview: (template: Template) => void; onChoose?: never; insert?: never; widthMm?: never });

export function TemplateLibrary({ onChoose, insert = false, widthMm = 65, onPreview, selectedId, quickInsert=false }: TemplateLibraryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [favorites, setFavorites] = useState(() => readIds('studio-design-favorites'));
  const [recent, setRecent] = useState(() => readIds('studio-design-recent'));
  useEffect(()=>{const refresh=()=>setRecent(readIds('studio-design-recent'));window.addEventListener('studio-template-used',refresh);return()=>window.removeEventListener('studio-template-used',refresh)},[]);
  const [selected, setSelected] = useState<Template | null>(null);

  const premiumCount = templates.filter(isPremium).length;
  const results = templates.filter(template => (
    category === 'All' || category === template.category
    || (category === 'Premium artwork' && isPremium(template))
    || (category === 'Favorites' && favorites.includes(template.id))
    || (category === 'Recent' && recent.includes(template.id))
  ) && matchesName([template.name, template.category, ...(template.tags ?? [])].join(' '), query))
    .sort((a,b)=>category==='Recent'?recent.indexOf(a.id)-recent.indexOf(b.id):(category==='All' ? Number(isPremium(b))-Number(isPremium(a)) : 0)||compareNames(a.name,b.name));
  const page=usePagedList(results,JSON.stringify([query,category]));
  const [limit,setLimit]=useState(36);
  const shown = onPreview ? results.slice(0,limit) : page.items;

  function choose(id: string) {
    setRecent(rememberTemplate(id));
    setSelected(null);
    onChoose?.(id);
  }

  function favorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem('studio-design-favorites', JSON.stringify(next));
  }

  return <>
    {(!insert||onPreview)&&<div className="template-category-strip" role="group" aria-label="Featured categories">{['All',...(premiumCount?['Premium artwork']:[]),'Favorites','Recent',...new Set(templates.map(t=>t.category))].map(item=><button key={item} aria-pressed={category===item} onClick={()=>{setCategory(item);setLimit(36)}}>{item}</button>)}</div>}
    <div className="library-filters">
      <label className="library-search"><Search size={16} /><input aria-label="Search templates" placeholder="Search templates" value={query} onChange={event => {setQuery(event.target.value);setLimit(36);}} /></label>
      <label>Category <select value={category} onChange={event => {setCategory(event.target.value);setLimit(36);}}>
        {['All', ...(premiumCount?['Premium artwork']:[]), 'Favorites', 'Recent', ...new Set(templates.map(template => template.category))].map(item => <option key={item}>{item}</option>)}
      </select></label>
      <small>{results.length} {results.length === 1 ? 'design' : 'designs'}</small>
    </div>
    {results.length === 0 && <p role="status">No designs match your search.</p>}
    <section className={onPreview?"template-grid template-elements-grid":"template-grid"} aria-label="Template results">
      {shown.map(template => <article key={template.id} className={onPreview&&selectedId===template.id?'template-selected':undefined} draggable={!!onPreview} onDragStart={event=>{if(!onPreview)return;event.dataTransfer.setData("application/x-stitchstudio-template",template.id);event.dataTransfer.effectAllowed="copy";if(!quickInsert)onPreview(template)}}>
        <button className="design-favorite" title="Toggle favorite"
          aria-label={(favorites.includes(template.id) ? 'Remove favorite ' : 'Favorite ') + template.name}
          aria-pressed={favorites.includes(template.id)} onClick={() => favorite(template.id)}>
          <Star size={15} fill={favorites.includes(template.id) ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="template-art-select" aria-label={(quickInsert?'Insert ':'Select ')+template.name} aria-pressed={onPreview?selectedId===template.id:undefined} onClick={()=>onPreview?onPreview(template):setSelected(template)}><svg className="template-art" viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: template.art }} /></button>
        <small>{template.category}</small>
        <h3 title={template.name}>{template.name}</h3>
        {!onPreview&&<button onClick={() => setSelected(template)} aria-label={`Preview ${template.name}`}>
          Preview design <ArrowRight size={15} />
        </button>}
      </article>)}
    </section>
    {onPreview ? results.length>limit&&<button onClick={()=>setLimit(previous=>previous+36)}>Show more templates</button> : <ListNavigation {...page}/>}
    {selected && <TemplatePreview template={selected} insert={insert} widthMm={widthMm}
      onCancel={() => setSelected(null)} onChoose={() => choose(selected.id)} />}
  </>;
}
