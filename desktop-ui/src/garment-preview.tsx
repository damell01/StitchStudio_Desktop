import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Shirt, X} from 'lucide-react';
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
} satisfies Record<string, Garment>;
type GarmentName = keyof typeof garments;

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
    // Fine directional sheen on individual thread segments.
    for(const run of block.runs) for(let i=1;i<run.length;i++){
      const a=run[i-1],b=run[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const len=Math.hypot(dx,dy);if(len<.15)continue;
      context.beginPath();context.moveTo(a[0],a[1]-.09);context.lineTo(b[0],b[1]-.09);
      context.strokeStyle=`rgba(255,255,255,${.08+.22*Math.abs(dx/len)})`;
      context.lineWidth=.12;context.stroke();
    }
  }
  context.restore();
}

export function GarmentPreview({blocks}: {blocks:Block[]}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [open,setOpen] = useState(false);
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
  const drag=useRef<{id:number;x:number;y:number;ox:number;oy:number}|null>(null);
  const [dragging,setDragging]=useState(false);
  const [x,setX] = useState('');
  const [y,setY] = useState('');
  const is3d=garmentName==='hoodie'&&hoodieMode==='3d'&&!unavailable;
  const garment = garments[garmentName];
  const placement = garment.placements[placementIndex];
  const garmentSize = sizes[sizeName];
  const scale = garment.pxPerMm / garmentSize.ratio;
  const xOffset = (Number(x)||0)*25.4;
  const yOffset = (Number(y)||0)*25.4;
  const bounds=useMemo(()=>{
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const block of blocks)for(const run of block.runs)for(const p of run){
      left=Math.min(left,p[0]);right=Math.max(right,p[0]);top=Math.min(top,p[1]);bottom=Math.max(bottom,p[1]);
    }
    return {left,right,top,bottom};
  },[blocks]);
  const insideZone=!open||!Number.isFinite(bounds.left)||(
    bounds.left+xOffset>=-placement.widthMm*garmentSize.ratio/2 &&
    bounds.right+xOffset<=placement.widthMm*garmentSize.ratio/2 &&
    bounds.top+yOffset>=-placement.heightMm*garmentSize.ratio/2 &&
    bounds.bottom+yOffset<=placement.heightMm*garmentSize.ratio/2);
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

  return <>
    <button className="studio-tool-icon" aria-label="Garment mockup" title="Preview on a garment" disabled={!blocks.length}
      onClick={()=>{dialog.current?.showModal();setOpen(true);}}><Shirt size={18}/></button>
    <dialog ref={dialog} className="studio-modal garment-preview" aria-label="Garment mockup" onClose={()=>setOpen(false)}>
      {open&&<>
        <div className="studio-modal-heading"><h2>Garment mockup</h2>
          <button onClick={()=>dialog.current?.close()} aria-label="Close garment mockup"><X size={17} aria-hidden="true"/></button>
        </div>
        <div className="garment-preview-layout">
          <div className="garment-preview-stage" data-rotatable={is3d}
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
              <HoodieView angle={angle} color={color} blocks={blocks} placement={placementIndex}
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
          </div>
          <div className="garment-preview-options">
            <label>Garment<select aria-label="Garment" value={garmentName} onChange={event=>{
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
            <p className="muted">{is3d?'Drag to move the design or select Rotate garment. Hold Shift to rotate.':'Drag the design on the garment, or use arrow keys on the preview.'}</p>
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
          </div>
        </div>
      </>}
    </dialog>
  </>;
}
