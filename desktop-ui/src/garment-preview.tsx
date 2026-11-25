import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Download, Shirt, X} from 'lucide-react';
import type {HoodieCapture} from './hoodie-view';
import './garment-preview.css';

const HoodieView=lazy(()=>import('./hoodie-view'));

type Block = {color:number[]; runs:number[][][]};
type Placement = {label:string; x:number; y:number; widthMm:number; heightMm:number};
type Garment = {
  label:string; outline:string; zone:string; seams:string; pxPerMm:number; placements:Placement[];
};

const size = {width:600, height:440};
const sizes = {adult:{label:'Adult', ratio:1}, kids:{label:'Kids', ratio:.78}, toddler:{label:'Toddler', ratio:.58}};
type SizeName = keyof typeof sizes;
const garments = {
  shirt: {
    label:'T-shirt',
    outline:'M224 42 172 65 88 144 147 216 195 185 183 405 Q300 423 417 405 L405 185 453 216 512 144 428 65 376 42 Q360 100 300 103 Q240 100 224 42Z',
    zone:'M198 106 Q300 132 402 106 L413 397 Q300 412 187 397Z',
    seams:'M224 46 Q240 108 300 111 Q360 108 376 46 M94 139 L151 208 M506 139 L449 208 M187 398 Q300 414 413 398',
    pxPerMm:.48,
    placements:[
      {label:'Left chest (wearer)',x:354,y:153,widthMm:120,heightMm:120},
      {label:'Right chest (wearer)',x:246,y:153,widthMm:120,heightMm:120},
      {label:'Center front',x:300,y:209,widthMm:300,heightMm:300},
    ],
  },
  hoodie: {
    label:'Hoodie',
    outline:'M232 79 Q221 39 248 24 Q300 -4 352 24 Q379 39 368 79 L419 102 Q474 122 493 247 L513 371 L460 384 L412 252 L423 410 Q300 423 177 410 L188 252 L140 384 L87 371 L107 247 Q126 122 181 102Z',
    zone:'M195 123 Q300 150 405 123 L416 395 Q300 409 184 395Z',
    seams:'M232 79 Q275 129 300 119 Q325 129 368 79 M250 45 Q300 20 350 45 Q341 88 300 112 Q259 88 250 45Z M274 109 L263 153 M326 109 L337 153 M92 357 L136 369 M508 357 L464 369 M185 398 Q300 412 415 398 M255 311 H345 L367 367 H233Z',
    pxPerMm:.47,
    placements:[
      {label:'Left chest (wearer)',x:355,y:169,widthMm:123,heightMm:115},
      {label:'Right chest (wearer)',x:245,y:169,widthMm:123,heightMm:115},
      {label:'Center front',x:300,y:226,widthMm:285,heightMm:210},
    ],
  },
  cap: {
    label:'Cap',
    outline:'M144 252 C135 143 193 78 278 71 C383 59 466 142 458 247 L448 269 C492 286 509 308 476 328 C430 361 232 379 131 337 C93 320 107 278 154 262Z',
    zone:'M159 250 C152 153 210 91 288 87 C378 82 442 153 442 244 Q310 297 159 250Z',
    seams:'M153 256 Q303 306 451 253 M275 78 Q218 129 228 268 M317 77 Q387 125 378 264 M121 310 Q234 370 482 317 M125 319 Q250 371 464 331',
    pxPerMm:1.18,
    placements:[{label:'Cap front',x:300,y:194,widthMm:125,heightMm:55}],
  },
  shorts: {
    label:'Shorts',
    outline:'M156 83 Q300 63 444 83 L469 356 Q397 385 327 366 L300 230 273 366 Q203 385 131 356Z',
    zone:'M159 103 Q300 85 441 103 L463 348 Q397 378 334 358 L300 215 266 358 Q203 378 137 348Z',
    seams:'M156 99 Q300 79 444 99 M154 109 Q300 89 446 109 M202 111 Q195 143 154 160 M398 111 Q405 143 446 160 M136 345 Q203 372 274 357 M326 357 Q397 372 464 345 M300 111 V230',
    pxPerMm:.66,
    placements:[
      {label:'Left leg (wearer)',x:391,y:294,widthMm:125,heightMm:112},
      {label:'Right leg (wearer)',x:209,y:294,widthMm:125,heightMm:112},
    ],
  },

  polo:{label:'Collared polo',outline:'M220 43 L172 65 88 144 147 216 195 185 183 405 Q300 423 417 405 L405 185 453 216 512 144 428 65 380 43 Q300 85 220 43Z',zone:'M198 120 H402 L415 395 H185Z',seams:'M220 43 L264 115 300 80 336 115 380 43 M300 80 V158 H315 V100 M94 139 L151 208 M506 139 L449 208 M187 398 Q300 414 413 398',pxPerMm:.48,placements:[{label:'Left chest (wearer)',x:354,y:168,widthMm:100,heightMm:100},{label:'Right chest (wearer)',x:246,y:168,widthMm:100,heightMm:100},{label:'Center front',x:300,y:245,widthMm:270,heightMm:235}]},
  sweatshirt:{label:'Crewneck sweatshirt',outline:'M230 40 L174 65 Q125 83 104 180 L72 354 132 375 190 222 182 406 Q300 423 418 406 L410 222 468 375 528 354 496 180 Q475 83 426 65 L370 40 Q300 110 230 40Z',zone:'M196 114 H404 L416 390 H184Z',seams:'M230 46 Q300 120 370 46 M80 334 L139 355 M520 334 L461 355 M185 383 Q300 400 415 383',pxPerMm:.46,placements:[{label:'Center front',x:300,y:220,widthMm:280,heightMm:260},{label:'Left chest (wearer)',x:354,y:155,widthMm:105,heightMm:105}]},
  bubble:{label:'Bubble romper',outline:'M230 45 L174 68 119 127 157 185 192 160 Q155 244 173 330 Q185 390 238 390 L269 414 H331 L362 390 Q415 390 427 330 Q445 244 408 160 L443 185 481 127 426 68 370 45 Q300 100 230 45Z',zone:'M203 110 Q300 130 397 110 L414 300 Q300 342 186 300Z',seams:'M230 49 Q300 110 370 49 M122 126 L160 177 M478 126 L440 177 M180 315 Q240 325 270 410 M420 315 Q360 325 330 410 M280 398 H320 M290 405 h1 M310 405 h1',pxPerMm:.98,placements:[{label:'Center front',x:300,y:205,widthMm:120,heightMm:110},{label:'Upper chest',x:300,y:140,widthMm:100,heightMm:60}]},
  onesie:{label:'Infant bodysuit',outline:'M230 40 L175 64 112 124 153 190 195 160 194 305 Q218 312 245 375 L265 409 H335 L355 375 Q382 312 406 305 L405 160 447 190 488 124 425 64 370 40 Q300 95 230 40Z',zone:'M205 112 H395 V302 H205Z',seams:'M230 44 Q300 105 370 44 M175 65 Q190 95 224 102 M425 65 Q410 95 376 102 M195 305 Q238 315 265 399 M405 305 Q362 315 335 399 M275 397 H325',pxPerMm:.94,placements:[{label:'Center front',x:300,y:195,widthMm:140,heightMm:150}]},
  smocked:{label:'Smocked dress',outline:'M232 40 L178 58 120 112 Q115 154 161 178 L192 150 211 180 133 400 Q300 438 467 400 L389 180 408 150 439 178 Q485 154 480 112 L422 58 368 40 Q300 95 232 40Z',zone:'M215 185 H385 L443 385 Q300 415 157 385Z',seams:'M232 44 Q300 105 368 44 M192 148 Q300 191 408 148 M211 180 Q300 208 389 180 M205 155 L215 172 225 161 235 181 245 167 255 187 265 172 275 190 285 174 295 193 305 174 315 190 325 172 335 187 345 167 355 181 365 161 375 172 385 155 M235 208 L214 385 M275 216 L267 400 M325 216 L333 400 M365 208 L386 385',pxPerMm:.78,placements:[{label:'Front below smocking',x:300,y:260,widthMm:155,heightMm:120}]},
  bishop:{label:'Smocked bishop gown',outline:'M232 42 Q300 92 368 42 L432 63 Q490 112 465 170 L411 180 486 403 Q300 440 114 403 L189 180 135 170 Q110 112 168 63Z',zone:'M207 192 H393 L459 392 Q300 418 141 392Z',seams:'M232 46 Q300 103 368 46 M170 100 Q300 204 430 100 M184 120 Q300 216 416 120 M198 140 Q300 226 402 140 M220 200 L193 389 M270 215 L258 400 M330 215 L342 400 M380 200 L407 389',pxPerMm:.72,placements:[{label:'Front below smocking',x:300,y:275,widthMm:165,heightMm:140}]},
  dress:{label:'Sleeveless dress',outline:'M225 40 L190 50 180 120 Q205 155 214 165 L132 402 Q300 438 468 402 L386 165 Q395 155 420 120 L410 50 375 40 Q300 105 225 40Z',zone:'M220 128 H380 L450 390 H150Z',seams:'M225 45 Q300 112 375 45 M214 165 Q300 190 386 165 M234 186 L215 395 M366 186 L385 395',pxPerMm:.75,placements:[{label:'Center chest',x:300,y:142,widthMm:120,heightMm:65},{label:'Skirt front',x:300,y:265,widthMm:175,heightMm:140}]},
  zip:{label:'Zip hoodie',outline:'M232 79 Q221 39 248 24 Q300 -4 352 24 Q379 39 368 79 L419 102 Q474 122 493 247 L513 371 L460 384 L412 252 L423 410 Q300 423 177 410 L188 252 L140 384 L87 371 L107 247 Q126 122 181 102Z',zone:'M195 123 H405 L416 395 H184Z',seams:'M232 79 Q300 155 368 79 M300 119 V410 M185 398 Q300 412 415 398 M210 310 L280 300 V366 H200Z M390 310 L320 300 V366 H400Z',pxPerMm:.47,placements:[{label:'Left chest (wearer)',x:355,y:169,widthMm:105,heightMm:105},{label:'Right chest (wearer)',x:245,y:169,widthMm:105,heightMm:105}]},
  longSleeve:{label:'Long-sleeve shirt',outline:'M224 42 L172 65 118 96 65 350 128 366 190 205 183 405 Q300 423 417 405 L410 205 472 366 535 350 482 96 428 65 376 42 Q300 128 224 42Z',zone:'M198 110 H402 L413 395 H187Z',seams:'M224 46 Q300 134 376 46 M172 65 L190 205 M428 65 L410 205 M70 332 L135 350 M530 332 L465 350 M187 398 Q300 414 413 398',pxPerMm:.48,placements:[{label:'Center front',x:300,y:220,widthMm:280,heightMm:270},{label:'Left chest (wearer)',x:354,y:153,widthMm:105,heightMm:105}]},
  raglan:{label:'Raglan shirt',outline:'M224 42 L172 65 88 144 147 216 195 185 183 405 Q300 423 417 405 L405 185 453 216 512 144 428 65 376 42 Q300 128 224 42Z',zone:'M211 115 H389 L413 395 H187Z',seams:'M224 46 Q300 134 376 46 M224 42 L195 185 M376 42 L405 185 M187 398 Q300 414 413 398',pxPerMm:.48,placements:[{label:'Center front',x:300,y:220,widthMm:250,heightMm:270}]},
  bib:{label:'Baby bib',outline:'M218 40 Q170 44 167 105 L156 230 Q140 390 300 409 Q460 390 444 230 L433 105 Q430 44 382 40 L355 95 Q300 174 245 95Z',zone:'M184 185 Q300 160 416 185 L424 292 Q400 384 300 384 Q200 384 176 292Z',seams:'M218 52 Q178 55 178 110 L169 235 Q155 380 300 396 Q445 380 431 235 L422 110 Q422 55 382 52 M355 105 Q300 185 245 105',pxPerMm:1.1,placements:[{label:'Center front',x:300,y:270,widthMm:130,heightMm:100}]},
  towel:{label:'Hand towel',outline:'M165 35 H435 V405 H165Z',zone:'M185 55 H415 V385 H185Z',seams:'M175 45 H425 V395 H175Z M175 345 H425 M175 354 H425 M175 363 H425',pxPerMm:.75,placements:[{label:'Lower center',x:300,y:290,widthMm:220,heightMm:105},{label:'Center',x:300,y:210,widthMm:250,heightMm:250}]},
  blanket:{label:'Baby blanket',outline:'M95 38 Q90 38 90 48 V392 Q90 402 100 402 H500 Q510 402 510 392 V48 Q510 38 500 38Z',zone:'M110 58 H490 V382 H110Z',seams:'M108 56 H492 V384 H108Z M118 66 H482 V374 H118Z',pxPerMm:.43,placements:[{label:'Lower corner',x:405,y:315,widthMm:200,heightMm:200},{label:'Center',x:300,y:220,widthMm:350,heightMm:300}]},
} satisfies Record<string, Garment>;
type GarmentName = keyof typeof garments;
const catalog: {id:GarmentName;label:string;group:string;size:SizeName;color:string}[]=[{id:'shirt',label:'Adult T-shirt',group:'Adult',size:'adult',color:'#f9f8f5'},{id:'shirt',label:'Youth T-shirt',group:'Kids',size:'kids',color:'#b4d4ee'},{id:'shirt',label:'Toddler T-shirt',group:'Kids',size:'toddler',color:'#d9c4ef'},{id:'polo',label:'Collared polo',group:'Kids',size:'kids',color:'#344967'},{id:'sweatshirt',label:'Sweatshirt',group:'Adult',size:'adult',color:'#c7c7cc'},{id:'hoodie',label:'Hoodie',group:'Adult',size:'adult',color:'#c9b3e6'},{id:'zip',label:'Zip hoodie',group:'Adult',size:'adult',color:'#9ebbd6'},{id:'bubble',label:'Bubble romper',group:'Infant',size:'toddler',color:'#b4d4ee'},{id:'onesie',label:'Onesie',group:'Infant',size:'toddler',color:'#f9f8f5'},{id:'smocked',label:'Smocked dress',group:'Infant',size:'toddler',color:'#ebadc8'},{id:'bishop',label:'Bishop gown',group:'Infant',size:'toddler',color:'#f2e4db'},{id:'dress',label:'Dress',group:'Kids',size:'kids',color:'#c9b3e6'},{id:'shorts',label:'Shorts',group:'Kids',size:'kids',color:'#a6bca8'},{id:'cap',label:'Cap',group:'Accessories',size:'adult',color:'#344967'},{id:'longSleeve',label:'Long-sleeve shirt',group:'Kids',size:'kids',color:'#b4d4ee'},{id:'raglan',label:'Raglan shirt',group:'Kids',size:'kids',color:'#f9f8f5'},{id:'bib',label:'Baby bib',group:'Infant',size:'toddler',color:'#ebadc8'},{id:'towel',label:'Hand towel',group:'Accessories',size:'adult',color:'#f2e4db'},{id:'blanket',label:'Baby blanket',group:'Infant',size:'adult',color:'#d9c4ef'}];

function paintMockup(
  canvas: HTMLCanvasElement, garment: Garment, placement: Placement, blocks: Block[],
  fabric: string, xOffset: number, yOffset: number, scale: number,
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = canvas.width / size.width;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  const outline = new Path2D(garment.outline);

  context.save();
  context.shadowColor = '#21113136';
  context.shadowOffsetY = 10;
  context.shadowBlur = 22;
  context.fillStyle = fabric;
  context.fill(outline);
  context.restore();

  context.save();
  context.clip(outline);
  const shade = context.createLinearGradient(90, 75, 495, 380);
  shade.addColorStop(0, '#ffffff46');
  shade.addColorStop(.39, '#ffffff00');
  shade.addColorStop(.65, '#21132e18');
  shade.addColorStop(1, '#1a102d46');
  context.fillStyle = shade;
  context.fillRect(0, 0, size.width, size.height);
  context.strokeStyle = '#432c580c';
  context.lineWidth = .45;
  context.beginPath();
  for (let x = -440; x < size.width; x += 4) {
    context.moveTo(x, 0);
    context.lineTo(x + 440, 440);
  }
  context.stroke();
  context.lineWidth = 1.4;
  context.strokeStyle = '#22183259';
  context.stroke(new Path2D(garment.seams));
  context.restore();

  context.save();
  context.clip(new Path2D(garment.zone));
  // The placement anchor is the hoop origin so edits to a design's hoop
  // position appear on the garment at the same scale.
  context.translate(placement.x + xOffset * scale, placement.y + yOffset * scale);
  context.scale(scale, scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const block of blocks) {
    context.beginPath();
    for (const run of block.runs) {
      if (run.length < 2) continue;
      context.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) context.lineTo(run[i][0], run[i][1]);
    }
    context.save();
    context.translate(.18,.22);
    context.strokeStyle = '#1a112b65';
    context.lineWidth = .58;
    context.stroke();
    context.restore();
    context.strokeStyle = `rgb(${block.color.join(',')})`;
    context.lineWidth = .42;
    context.stroke();
    // Batch highlights by direction instead of issuing a draw per stitch.
    const highlights=Array.from({length:4},()=>new Path2D());
    for(const run of block.runs) for(let i=1;i<run.length;i++){
      const a=run[i-1],b=run[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(len<.15)continue;
      const p=highlights[Math.min(3,Math.floor(Math.abs(dx/len)*4))];
      p.moveTo(a[0],a[1]-.09);p.lineTo(b[0],b[1]-.09);
    }
    context.lineWidth=.12;
    highlights.forEach((p,i)=>{context.strokeStyle=`rgba(255,255,255,${.08+i*.07})`;context.stroke(p)});
  }
  context.restore();
}

export function GarmentPreview({blocks}: {blocks:Block[]}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hoodieCapture=useRef<HoodieCapture>(null);
  const [open,setOpen] = useState(false);
  const [query,setQuery]=useState(''),[category,setCategory]=useState('All');
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [garmentName,setGarment] = useState<GarmentName>('shirt');
  const [sizeName,setSizeName] = useState<SizeName>('adult');
  const [angle,setAngle]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [interaction,setInteraction]=useState<'move'|'rotate'>('move');
  const [hoodieMode,setHoodieMode]=useState<'3d'|'flat'>('3d');
  const [unavailable,setUnavailable]=useState(false);
  const turn=useRef<{id:number;x:number;angle:number}|null>(null);
  const [placementIndex,setPlacement] = useState(0);
  const [color,setColor] = useState('#e6dced');
  const [showGuide,setShowGuide]=useState(false);
  const drag=useRef<{id:number;x:number;y:number;ox:number;oy:number}|null>(null);
  const [dragging,setDragging]=useState(false);
  const [x,setX] = useState('');
  const [y,setY] = useState('');
  const is3d=garmentName==='hoodie'&&hoodieMode==='3d'&&!unavailable;
  const garment = garments[garmentName];
  const placement = garment.placements[placementIndex];
  const garmentSize = sizes[sizeName];
  const scale = garment.pxPerMm / (['bubble','onesie','smocked','bishop','bib','blanket','towel'].includes(garmentName)?1:garmentSize.ratio);
  const xOffset = (Number(x)||0)*25.4;
  const yOffset = (Number(y)||0)*25.4;
  const bounds=useMemo(()=>{
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const block of blocks)for(const run of block.runs)for(const p of run){
      left=Math.min(left,p[0]);right=Math.max(right,p[0]);top=Math.min(top,p[1]);bottom=Math.max(bottom,p[1]);
    }
    return {left,right,top,bottom};
  },[blocks]);
  const placementRatio=['bubble','onesie','smocked','bishop','bib','blanket','towel'].includes(garmentName)?1:garmentSize.ratio;
  const insideZone=!open||!Number.isFinite(bounds.left)||(
    bounds.left+xOffset>=-placement.widthMm*placementRatio/2 &&
    bounds.right+xOffset<=placement.widthMm*placementRatio/2 &&
    bounds.top+yOffset>=-placement.heightMm*placementRatio/2 &&
    bounds.bottom+yOffset<=placement.heightMm*placementRatio/2);
  function centerDesign(){
    if(!Number.isFinite(bounds.left))return;
    setX((-(bounds.left+bounds.right)/2/25.4).toFixed(3));
    setY((-(bounds.top+bounds.bottom)/2/25.4).toFixed(3));
  }


  useEffect(()=>{
    if(!open || !canvas.current)return;
    const surface=canvas.current;
    const frame=requestAnimationFrame(()=>paintMockup(surface,garment,placement,blocks,color,xOffset,yOffset,scale));
    return ()=>cancelAnimationFrame(frame);
  },[open,garment,placement,blocks,color,xOffset,yOffset,scale,is3d]);

  async function saveProof() {
    setSaveError('');
    setSaving(true);
    try {
      const proof=document.createElement('canvas');
      proof.width=size.width*2;
      proof.height=size.height*2;
      const context=proof.getContext('2d');
      if(!context)throw new Error('Image export is unavailable.');
      if(is3d){
        if(!hoodieCapture.current?.drawOnto(context))throw new Error('Wait for the 3D hoodie to load, then try again.');
      }else{
        paintMockup(proof,garment,placement,blocks,color,xOffset,yOffset,scale);
      }
      context.setTransform(1,0,0,1,0,0);
      context.globalCompositeOperation='destination-over';
      const background=context.createLinearGradient(0,0,0,proof.height);
      background.addColorStop(0,'#fbf9ff');
      background.addColorStop(1,'#efebf6');
      context.fillStyle=background;
      context.fillRect(0,0,proof.width,proof.height);
      const image=await new Promise<Blob>((resolve,reject)=>proof.toBlob(blob=>{
        if(blob)resolve(blob);
        else reject(new Error('Could not create the PNG.'));
      },'image/png'));
      const url=URL.createObjectURL(image);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download=`stitch-studio-${garmentName}-${sizeName}-mockup.png`;
      anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){
      setSaveError(error instanceof Error?error.message:'Could not save the mockup.');
    }finally{
      setSaving(false);
    }
  }

  return <>
    <button className="studio-tool-icon" aria-label="Garment mockup" title="Preview on a garment" disabled={!blocks.length}
      onClick={()=>{setSaveError('');dialog.current?.showModal();setOpen(true);}}><Shirt size={18}/></button>
    <dialog ref={dialog} className="studio-modal garment-preview" aria-label="Garment mockup" onClose={()=>setOpen(false)}>
      {open&&<>
        <div className="studio-modal-heading"><h2>Garment Preview Studio</h2>
          <button onClick={()=>dialog.current?.close()} aria-label="Close garment mockup"><X size={17} aria-hidden="true"/></button>
        </div>
        <div className="garment-preview-layout"><aside className="garment-catalog"><h3>Garment catalog</h3><input type="search" aria-label="Search garments" placeholder="Search garments…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="garment-categories">{["All","Infant","Kids","Adult","Accessories"].map(g=><button key={g} aria-pressed={category===g} onClick={()=>setCategory(g)}>{g}</button>)}</div><div className="garment-card-grid">{catalog.filter(g=>(category==="All"||category===g.group)&&g.label.toLowerCase().includes(query.toLowerCase())).map(g=><button key={g.label} aria-pressed={garmentName===g.id&&sizeName===g.size} onClick={()=>{setGarment(g.id);setSizeName(g.size);setColor(g.color);setPlacement(0);setX("");setY("");setAngle(0);setZoom(1)}}><svg viewBox="65 0 470 440" aria-hidden="true"><path d={garments[g.id].outline} fill={g.color} stroke="#6a587e" strokeWidth="2"/><path d={garments[g.id].seams} fill="none" stroke="#6a587e" strokeOpacity=".55" strokeWidth="2"/></svg><strong>{g.label}</strong></button>)}</div></aside>
          <div className="garment-preview-display"><div className="garment-stage-heading"><strong>{garment.label} · {garmentSize.label}</strong><small>{is3d?'3D fabric preview':'Stitched garment preview'}</small></div><div className="garment-preview-stage" data-rotatable={is3d}
            onPointerDown={event=>{
              if(!is3d||event.button!==0)return;
              if(interaction==='move'&&!event.shiftKey){
                drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,ox:xOffset,oy:yOffset};
                event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);return;
              }
              turn.current={id:event.pointerId,x:event.clientX,angle};
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
              const d=drag.current;
              if(is3d&&d?.id===event.pointerId){const factor=event.currentTarget.clientHeight*zoom/(1000*garmentSize.ratio);if(factor>0){const clamp=(v:number)=>Math.max(-8,Math.min(8,v/25.4)).toFixed(3);setX(clamp(d.ox+(event.clientX-d.x)/factor));setY(clamp(d.oy+(event.clientY-d.y)/factor));}return;}
              const start=turn.current;
              if(start?.id===event.pointerId)setAngle((((start.angle+(event.clientX-start.x)*.5)+180)%360+360)%360-180);
            }}
            onLostPointerCapture={()=>{turn.current=null;drag.current=null;setDragging(false);}}>
            {is3d?<Suspense fallback={<p role="status">Loading hoodie…</p>}>
              <HoodieView ref={hoodieCapture} angle={angle} color={color} blocks={blocks} placement={placementIndex}
                xMm={xOffset} yMm={yOffset} sizeRatio={garmentSize.ratio} zoom={zoom} onUnavailable={()=>setUnavailable(true)}/>
            </Suspense>:<canvas ref={canvas} width={size.width*2} height={size.height*2} role="img" tabIndex={0} style={{cursor:dragging?'grabbing':'grab',touchAction:'none'}}
              onPointerDown={event=>{
                if(event.button!==0)return;
                drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,ox:xOffset,oy:yOffset};
                event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
              }}
              onPointerMove={event=>{
                const d=drag.current;if(!d||d.id!==event.pointerId)return;
                const rect=event.currentTarget.getBoundingClientRect();
                const factor=Math.min(rect.width/size.width,rect.height/size.height)*scale;
                if(factor<=0)return;
                const clamp=(v:number)=>Math.max(-8,Math.min(8,v/25.4)).toFixed(3);
                setX(clamp(d.ox+(event.clientX-d.x)/factor));
                setY(clamp(d.oy+(event.clientY-d.y)/factor));
              }}
              onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
              onKeyDown={event=>{
                const delta:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
                const d=delta[event.key];if(!d)return;event.preventDefault();
                const step=event.shiftKey?5:1;
                setX(((xOffset+d[0]*step)/25.4).toFixed(3));setY(((yOffset+d[1]*step)/25.4).toFixed(3));
              }}
              aria-label={`Design on ${garmentSize.label.toLowerCase()} ${garment.label}, ${placement.label.toLowerCase()}`}/>}
          </div><div className="garment-stage-footer"><span>{placement.label}</span><span>{insideZone?'Within suggested placement':'Outside suggested placement'}</span></div></div>
          <div className="garment-preview-options"><h3>Selected garment</h3>
            <label>Style<select aria-label="Garment" value={garmentName} onChange={event=>{
              setGarment(event.target.value as GarmentName);setPlacement(0);setX('');setY('');
            }}>
              {Object.entries(garments).map(([name,item])=><option key={name} value={name}>{item.label}</option>)}
            </select></label>
            <label>Garment size<select aria-label="Garment size" value={sizeName} onChange={event=>setSizeName(event.target.value as SizeName)}>
              {Object.entries(sizes).map(([name,item])=><option key={name} value={name}>{item.label}</option>)}
            </select></label>
            <label>Placement<select aria-label="Placement" value={placementIndex} onChange={event=>{setPlacement(Number(event.target.value));setX('');setY('');}}>
              {garment.placements.map((item,index)=><option key={item.label} value={index}>{item.label}</option>)}
            </select></label>
            {garmentName==='hoodie'&&!unavailable&&<>
              <div className="garment-view-switch" role="group" aria-label="Hoodie view">
                <button aria-pressed={is3d} onClick={()=>setHoodieMode('3d')}>3D view</button>
                <button aria-pressed={!is3d} onClick={()=>setHoodieMode('flat')}>Flat view</button>
              </div>
              {is3d&&<><div className="garment-view-switch" role="group" aria-label="Preview interaction"><button aria-pressed={interaction==='move'} onClick={()=>setInteraction('move')}>Move design</button><button aria-pressed={interaction==='rotate'} onClick={()=>setInteraction('rotate')}>Rotate garment</button></div><label>Zoom · {Math.round(zoom*100)}%<input type="range" min=".7" max="2.5" step=".05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><button onClick={()=>{setZoom(1);setAngle(0)}}>Reset view</button></>}
              {is3d&&<label>Rotate hoodie <input type="range" min="-180" max="180" value={angle}
                onChange={event=>setAngle(Number(event.target.value))}/></label>}
            </>}
            {garmentName==='hoodie'&&unavailable&&<p role="status">3D is unavailable here. Showing the flat mockup.</p>}
            <label className="garment-color">Fabric color<input type="color" value={color} onChange={event=>setColor(event.target.value)}/></label>
            <div className="garment-fabric-swatches" role="group" aria-label="Fabric presets">{[["Lavender","#e6dced"],["White","#f9f8f5"],["Black","#24232a"],["Navy","#263953"],["Sage","#a4b4a0"],["Rose","#d9a1ad"]].map(([name,value])=><button key={name} title={name} aria-label={name} aria-pressed={color===value} style={{backgroundColor:value}} onClick={()=>setColor(value)}/>)}</div><button aria-expanded={showGuide} onClick={()=>setShowGuide(v=>!v)}>{showGuide?"Hide controls guide":"How to move the design"}</button>{showGuide&&<p className="muted">{is3d?'Drag to move the design or select Rotate garment. Hold Shift to rotate.':'Drag the design on the garment, or use arrow keys on the preview.'}</p>}
            <div className="garment-view-switch"><button onClick={centerDesign}>Center design</button><button onClick={()=>{setX('');setY('');}}>Reset placement</button></div>
            {Number.isFinite(bounds.left)&&<small>Design: {(bounds.right-bounds.left).toFixed(1)} × {(bounds.bottom-bounds.top).toFixed(1)} mm</small>}
            <details><summary>Precise placement (optional)</summary><fieldset>
              <legend>Adjust placement (in)</legend>
              <label>Horizontal<input type="number" min="-8" max="8" step=".25" value={x}
                placeholder="0" onChange={event=>setX(event.target.value)}/></label>
              <label>Vertical<input type="number" min="-8" max="8" step=".25" value={y}
                placeholder="0" onChange={event=>setY(event.target.value)}/></label>
            </fieldset></details>
            {!insideZone&&<p role="status">This design extends beyond the suggested area for this placement.</p>}
            <p className="muted">Garment scale is approximate. Mockup adjustments affect only this preview.</p>
            <button type="button" className="primary" disabled={saving} onClick={()=>void saveProof()}>
              <Download size={16} aria-hidden="true"/>{saving?'Saving mockup…':'Save mockup PNG'}
            </button>
            {saveError&&<p role="alert">{saveError}</p>}
          </div>
        </div>
      </>}
    </dialog>
  </>;
}
