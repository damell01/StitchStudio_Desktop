import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import {confirmAction,toast} from './dialogs';
import {Monitor,Square,Search,Plus,Pencil,Trash2,Info} from 'lucide-react';
import {useState,useRef} from 'react';
type Hoop={id:string;name:string;width:number;height:number;nominalWidth?:number;nominalHeight?:number};
type Machine={id:string;name:string;format:string;width:number;height:number};
// Nominal maximum fields in mm, not physical hoop dimensions. Verify orientation and usable area against the machine manual.
const MACHINE_CATALOG:[string,string,number,number,string][]=[
 [
  "Brother",
  "PE535",
  100,
  100,
  "PES"
 ],
 [
  "Brother",
  "PE545",
  100,
  100,
  "PES"
 ],
 [
  "Brother",
  "PE800",
  130,
  180,
  "PES"
 ],
 [
  "Brother",
  "PE900",
  130,
  180,
  "PES"
 ],
 [
  "Brother",
  "SE600",
  100,
  100,
  "PES"
 ],
 [
  "Brother",
  "SE625",
  100,
  100,
  "PES"
 ],
 [
  "Brother",
  "SE700",
  100,
  100,
  "PES"
 ],
 [
  "Brother",
  "SE1900",
  130,
  180,
  "PES"
 ],
 [
  "Brother",
  "SE2000",
  130,
  180,
  "PES"
 ],
 [
  "Brother",
  "Innov-is NQ1700E",
  160,
  260,
  "PES"
 ],
 [
  "Brother",
  "PR1X",
  300,
  200,
  "PES"
 ],
 [
  "Brother",
  "PR680W",
  300,
  200,
  "PES"
 ],
 [
  "Brother",
  "PR1055X",
  360,
  200,
  "PES"
 ],
 [
  "Brother",
  "PRS100",
  200,
  200,
  "PES"
 ],
 [
  "Brother",
  "PR600II",
  300,
  200,
  "PES"
 ],
 [
  "Poolin",
  "EOC03",
  100,
  235,
  "DST"
 ],
 [
  "Poolin",
  "EOC05",
  100,
  235,
  "DST"
 ],
 [
  "Poolin",
  "EOC06",
  280,
  200,
  "DST"
 ],
 [
  "Poolin",
  "EOM",
  360,
  240,
  "DST"
 ],
 [
  "Poolin",
  "EOX",
  500,
  350,
  "DST"
 ],
 [
  "Janome",
  "Memory Craft 230E",
  140,
  140,
  "JEF"
 ],
 [
  "Janome",
  "Memory Craft 400E",
  200,
  200,
  "JEF"
 ],
 [
  "Janome",
  "Memory Craft 500E",
  200,
  280,
  "JEF"
 ],
 [
  "Janome",
  "Memory Craft 550E",
  200,
  360,
  "JEF"
 ],
 [
  "Husqvarna Viking",
  "Designer Ruby 90",
  360,
  350,
  "VP3"
 ],
 [
  "Husqvarna Viking",
  "Designer Sapphire 85",
  360,
  350,
  "VP3"
 ],
 [
  "Husqvarna Viking",
  "Designer Topaz 65",
  360,
  200,
  "VP3"
 ],
 [
  "Husqvarna Viking",
  "Designer Topaz 50",
  360,
  200,
  "VP3"
 ],
 [
  "Husqvarna Viking",
  "Designer Topaz 40",
  240,
  150,
  "VP3"
 ],
 [
  "Husqvarna Viking",
  "Designer Quartz 29",
  170,
  100,
  "VP3"
 ],
 [
  "Pfaff",
  "creative icon 2",
  360,
  350,
  "VP3"
 ],
 [
  "Pfaff",
  "creative 4.5",
  360,
  350,
  "VP3"
 ],
 [
  "Pfaff",
  "creative 3.0",
  260,
  200,
  "VP3"
 ],
 [
  "Pfaff",
  "creative 1.5",
  240,
  150,
  "VP3"
 ],
 [
  "Singer",
  "SE9180",
  170,
  100,
  "VP3"
 ],
 [
  "Tajima",
  "SAI",
  300,
  200,
  "DST"
 ],
 [
  "HappyJapan",
  "HCH-701-30",
  285,
  290,
  "DST"
 ],
 [
  "Ricoma",
  "EM-1010",
  310,
  210,
  "DST"
 ],
 [
  "Baby Lock",
  "Altair",
  241.3,
  355.6,
  "PES"
 ],
 [
  "Baby Lock",
  "Altair 2",
  241.3,
  355.6,
  "PES"
 ],
 [
  "Baby Lock",
  "Alliance",
  203.2,
  203.2,
  "PES"
 ],
 [
  "Baby Lock",
  "Solaris Vision",
  269.875,
  406.4,
  "PES"
 ],
 [
  "Baby Lock",
  "Aerial",
  203.2,
  304.8,
  "PES"
 ],
 [
  "Baby Lock",
  "Bloom",
  127,
  177.8,
  "PES"
 ],
 [
  "Bernina",
  "790 PRO",
  400,
  210,
  "EXP"
 ],
 [
  "Bernina",
  "570 QE E",
  400,
  150,
  "EXP"
 ],
 [
  "Melco",
  "EMT16X",
  410,
  393,
  "EXP"
 ]
];
const MACHINE_BRANDS=Array.from(new Set(MACHINE_CATALOG.map(m=>m[0]))).sort();
const HOOP_CATALOG:[string,number,number,boolean][]=[
["Standard 4 × 4",100,100,false],["Standard 5 × 7",130,180,false],["Standard 6 × 10",160,260,false],["Standard 8 × 8",200,200,false],["Standard 8 × 12",200,300,false],["Standard 9.5 × 14",240,360,false],["Mighty Hoop 5.5 × 5.5",5.5*25.4,5.5*25.4,true],["Mighty Hoop 4.25 × 13",4.25*25.4,13*25.4,true],["Mighty Hoop 5 × 10",127,254,true],["Mighty Hoop 8 × 9",203.2,228.6,true],["Mighty Hoop 10 × 10",254,254,true],["Mighty Hoop 11 × 13",279.4,330.2,true],["Mighty Hoop 12 × 11",304.8,279.4,true],["Mighty Hoop 13 × 16",330.2,406.4,true]];
function stored<T,>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
export function Setup({machine=false}:{machine?:boolean}){const dialog=useRef<HTMLDialogElement>(null);const key=machine?'studio-machines':'studio-hoops';const [items,setItems]=useState<(Hoop|Machine)[]>(()=>stored(key,machine?[]:[{id:'100',name:'4 × 4 inch',width:100,height:100},{id:'130',name:'5 × 7 inch',width:130,height:180}]));const [unit,setUnit]=useState<'mm'|'in'>('in');const display=(n:number,u=unit)=>String(Number((u==='in'?n/25.4:n).toFixed(4)));const [name,setName]=useState(''),[width,setWidth]=useState('5.1181'),[height,setHeight]=useState('7.0866'),[format,setFormat]=useState('DST'),[edit,setEdit]=useState(''),[error,setError]=useState('');function save(next:(Hoop|Machine)[]){localStorage.setItem(key,JSON.stringify(next));setItems(next)}const [query,setQuery]=useState('');const [defaultId,setDefaultId]=useState(()=>localStorage.getItem(machine?'studio-default-machine':'studio-default-hoop')||'');const [nominal,setNominal]=useState<number[]|null>(null);function makeDefault(id:string){localStorage.setItem(machine?'studio-default-machine':'studio-default-hoop',id);setDefaultId(id);toast('Default profile updated')}
const [brand,setBrand]=useState(''),[modelQuery,setModelQuery]=useState(''),[preset,setPreset]=useState('');
const catalog=MACHINE_CATALOG.filter(m=>(!brand||m[0]===brand)&&matchesName(m[0]+' '+m[1],modelQuery));
function begin(){setNominal(null);setEdit('');setName('');setError('');setBrand('');setModelQuery('');setPreset('');setWidth(machine?'':display(130));setHeight(machine?'':display(180));setFormat('DST');dialog.current?.showModal()}
function chooseMachine(index:string){setPreset(index);if(index==='custom'){setName('');setWidth('');setHeight('');return}const m=MACHINE_CATALOG[Number(index)];if(!m)return;setName(m[0]+' '+m[1]);setWidth(display(m[2]));setHeight(display(m[3]));setFormat(m[4]);setError('')}

const page=usePagedList(items.filter(item=>matchesName(item.name,query)).sort((a,b)=>compareNames(a.name,b.name)),query,8);
return <section className="profile-manager profile-gallery"><div className="profile-summary"><div>{machine?<Monitor size={25}/>:<Square size={25}/>}<strong>{items.length}</strong><span>Saved {machine?'machines':'hoops'}</span></div><div><Info size={22}/><span>Profiles are available in the design editor and saved locally.</span></div></div><div className="profile-heading"><h2>{machine?'Machines':'Hoops'} ({items.length})</h2><button className="primary" onClick={begin}><Plus size={16}/> Add {machine?"machine":"hoop"}</button></div>{items.length===0&&<article className="profile-empty">{machine?<Monitor size={40}/>:<Square size={40}/>}<h2>No {machine?'machines':'hoops'} configured</h2><p>{machine?'Add a machine to save its usable embroidery field and preferred export format.':'Add a hoop using its actual usable embroidery dimensions.'}</p><button className="primary" onClick={begin}>Add your first {machine?'machine':'hoop'}</button></article>}<label className="profile-search"><Search size={16}/><input aria-label="Search profiles" placeholder="Search profiles" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="profile-list">{page.items.map(item=><article className="setup-row profile-card" key={item.id}><span className="profile-illustration">{machine?<Monitor size={32}/>:<svg viewBox="0 0 80 80" role="img" aria-label="Hoop proportions"><rect x={40-30*item.width/Math.max(item.width,item.height)} y={40-30*item.height/Math.max(item.width,item.height)} width={60*item.width/Math.max(item.width,item.height)} height={60*item.height/Math.max(item.width,item.height)} rx="5" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M40 12V68 M12 40H68" stroke="currentColor" strokeDasharray="2 4" opacity=".4"/></svg>}</span><div><strong>{item.name}{defaultId===item.id?' · Default':''}</strong><p>{(item.width/25.4).toFixed(2)} × {(item.height/25.4).toFixed(2)} in</p><small>{item.width.toFixed(1)} × {item.height.toFixed(1)} mm {'format' in item?` · ${item.format}`:''}</small></div><div className="profile-card-actions"><button disabled={defaultId===item.id} onClick={()=>makeDefault(item.id)}>Set default</button><button onClick={()=>{setEdit(item.id);setNominal('nominalWidth' in item&&item.nominalWidth&&item.nominalHeight?[item.nominalWidth,item.nominalHeight]:null);setName(item.name);setWidth(display(item.width));setHeight(display(item.height));if('format' in item)setFormat(item.format);setError('');dialog.current?.showModal()}}><Pencil size={14}/> Edit</button><button onClick={async()=>{if(await confirmAction("Delete this profile?"))save(items.filter(x=>x.id!==item.id))}}><Trash2 size={14}/> Delete</button></div></article>)}</div><ListNavigation {...page}/><dialog ref={dialog} className="profile-dialog"><h2>{edit?'Edit':'Create'} {machine?'machine':'hoop'}</h2><form className="setup-form" onSubmit={e=>{e.preventDefault();const w=Number(width)*(unit==='in'?25.4:1),h=Number(height)*(unit==='in'?25.4:1);if(!name.trim()||!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0){setError('Enter a name and positive dimensions.');return}const item={id:edit||crypto.randomUUID(),name:name.trim(),width:w,height:h,...(machine?{format}:nominal?{nominalWidth:nominal[0],nominalHeight:nominal[1]}:{})};save(edit?items.map(x=>x.id===edit?item:x):[...items,item]);if(!items.length)makeDefault(item.id);setEdit('');setName('');setError('');dialog.current?.close();toast('Profile saved')}}>{machine&&!edit&&<section className="machine-catalog-picker" style={{gridColumn:'1 / -1',display:'grid',gap:10}}><p className="muted">Choose your model to fill the name, maximum embroidery field and recommended format automatically.</p><label>Manufacturer<select value={brand} onChange={e=>{setBrand(e.target.value);setModelQuery('')}}><option value="">All manufacturers ({MACHINE_BRANDS.length})</option>{MACHINE_BRANDS.map(b=><option key={b}>{b}</option>)}</select></label><label>Search models<input type="search" placeholder="Poolin EOM, PE900, Janome…" value={modelQuery} onChange={e=>setModelQuery(e.target.value)}/></label><label>Machine model<select value={preset} onChange={e=>chooseMachine(e.target.value)}><option value="">Select a model ({catalog.length} matches)</option>{catalog.map(m=><option key={MACHINE_CATALOG.indexOf(m)} value={String(MACHINE_CATALOG.indexOf(m))}>{m[0]} {m[1]} · {m[2]} × {m[3]} mm · {m[4]}</option>)}<option value="custom">Other / custom machine</option></select></label>{preset&&preset!=='custom'&&<small>Preset loaded. Confirm the field orientation and dimensions in your manual; you can adjust the values below.</small>}</section>}{!machine&&!edit&&<section style={{gridColumn:'1 / -1',display:'grid',gap:8}}><label>Search hoop catalog<input type="search" placeholder="Mighty Hoop, 5 × 7…" value={modelQuery} onChange={e=>setModelQuery(e.target.value)}/></label><label>Hoop preset<select value={preset} onChange={e=>{const v=e.target.value;setPreset(v);const h=HOOP_CATALOG[Number(v)];if(!h||!v){setNominal(null);setName('');setWidth('');setHeight('');return}setName(h[0]);setNominal(h[3]?[h[1],h[2]]:null);setWidth(h[3]?'':display(h[1]));setHeight(h[3]?'':display(h[2]))}}><option value="">Custom / select a hoop</option>{HOOP_CATALOG.filter(h=>matchesName(h[0],modelQuery)).map(h=><option value={String(HOOP_CATALOG.indexOf(h))} key={h[0]}>{h[0]}</option>)}</select></label>{nominal&&<p className="muted">Nominal size: {(nominal[0]/25.4).toFixed(2)} × {(nominal[1]/25.4).toFixed(2)} in. Enter your machine-specific usable sewing field below; it is not the nominal hoop size.</p>}</section>}<label>Measurement units<select value={unit} onChange={e=>{const u=e.target.value as "mm"|"in";if(width.trim())setWidth(display(Number(width)*(unit==="in"?25.4:1),u));if(height.trim())setHeight(display(Number(height)*(unit==="in"?25.4:1),u));setUnit(u)}}><option value="mm">Millimeters (mm)</option><option value="in">Inches (in)</option></select></label><label>Name<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>{machine?"Maximum field width":"Usable width"} ({unit})<input type="number" min="0.0001" step="any" value={width} onChange={e=>setWidth(e.target.value)} required/></label><label>{machine?"Maximum field height":"Usable height"} ({unit})<input type="number" min="0.0001" step="any" value={height} onChange={e=>setHeight(e.target.value)} required/></label>{machine&&<label>Preferred format<select value={format} onChange={e=>setFormat(e.target.value)}>{['DST','PES','PEC','JEF','EXP','VP3','PEN'].map(f=><option key={f}>{f}</option>)}</select></label>}{error&&<p role="alert">{error}</p>}<div className="profile-footer"><button type="button" onClick={()=>dialog.current?.close()}>Cancel</button><button className="primary" type="submit">Save {machine?'machine':'hoop'}</button></div></form></dialog><p className="muted">Verify usable embroidery dimensions against your machine manual.</p></section>}
