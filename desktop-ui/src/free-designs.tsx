import {invoke} from '@tauri-apps/api/core';
import {useState} from 'react';
const sources=[
['Net Digitizing','Machine-tested sample designs; bows, flowers, appliqué','https://www.netdigitizing.co.uk/free-designs','No account; check usage terms'],
['MotifGrove','Seasonal, animals, lettering and characters','https://motifgrove.com/embroidery-designs/','Browser verification; character designs personal use'],
['Embrizo','Animals, flowers, holidays and baby designs','https://www.embrizo.com/free-embroidery-designs/dst','Free account; finished goods permitted, no file redistribution'],
['Creative Fabrica','Boutique, bows, floral and seasonal designs','https://www.creativefabrica.com/freebies/free-embroidery-designs/','Check individual license'],
['Embroidery Allsorts','Appliqué, alphabets and seasonal designs','https://embroidery-allsorts.com/Free-machine-embroidery-designs','Free account and checkout'],
['EmbroidAI','Flowers, children and illustrations','https://www.embroidai.com/free-embroidery-designs','Free account; check usage terms']
];
export function FreeDesigns(){const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);async function add(){setBusy(true);try{const result=await invoke('import_personal_designs',{folder:true});setStatus('Import finished: '+JSON.stringify(result));}catch(e){setStatus(String(e))}finally{setBusy(false)}}return <section className="free-designs"><h2>Free machine embroidery</h2><p>Download DST, PES or another supported format from the original designer. Extract ZIP files, then import the folder into My Designs. Designs remain on your computer.</p><button className="primary" disabled={busy} onClick={add}>{busy?'Importing…':'Import downloaded designs folder'}</button>{status&&<p role="status">{status}</p>}<div className="free-source-grid">{sources.map(([name,description,url,terms])=><article key={name}><h3>{name}</h3><p>{description}</p><small>{terms}</small><p><a href={url} target="_blank" rel="noreferrer">Browse free designs</a></p></article>)}</div></section>}
