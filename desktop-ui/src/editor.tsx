import {rememberProject,thumbnailOf,type Project} from './library';
import {Lettering} from './lettering';
import {Type} from 'lucide-react';
import {GarmentPreview} from './garment-preview';
import {ThreadOrder} from './thread-order';
import {FabricPicker} from './fabric-picker';
import {ListNavigation,matchesName,usePagedList} from './list-navigation';
import {CommandPalette,type Command} from './command-palette';
import {InsertDesignDialog} from './insert-design-dialog';
import {confirmAction,toast} from './dialogs';
import {ExportCenter} from './export-center';
import {readThreads} from './threads';
import {StitchPicker} from './stitch-guide';
import {useState,useEffect,useRef,useMemo,type PointerEvent as ReactPointerEvent} from 'react';
import {Save,Undo2,Redo2,FolderOpen,Download,RotateCw,Move,Maximize,Play,Pause,Eye,EyeOff,PanelLeft,PanelRight,ZoomIn,ZoomOut,Grid,Scan,FlipHorizontal,FlipVertical,FilePlus,Layers3,SquareDashed,Scissors,RotateCcw,Minimize,Menu,StepBack,StepForward,MousePointer2,Hand,Copy,Trash2,GripHorizontal,Search,X,Waypoints,Group} from 'lucide-react';
import {invoke,isTauri} from '@tauri-apps/api/core';
type Plan={name:string;stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type EditableObject={uid:number;label:string;color:number[];kind:string;bounds?:[number,number,number,number];path?:string;fill_rule?:'evenodd'|'nonzero';stroke_width?:number};
type ObjectOperation={kind:'move';dx:number;dy:number}|{kind:'scale';factor:number}|{kind:'rotate'|'duplicate'|'delete'}|ResizeOperation;
type ResizeOperation={kind:'resize';sx:number;sy:number;x:number;y:number};
type ResizeHandle={x:number;y:number;dx:number;dy:number;cursor:string};
type Profile={id:string;name:string;width:number;height:number;format?:string};
function profiles(key:string,fallback:Profile[]):Profile[]{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
function panelWidth(key: string, fallback: number, min: number, max: number) {
  const value = Number(localStorage.getItem(key));
  return value >= min && value <= max ? value : fallback;
}
export function Editor({beginner=true,navigation=[]}:{beginner?:boolean;navigation?:Command[]}){const insertDialog=useRef<HTMLDialogElement>(null);const textDialog=useRef<HTMLDialogElement>(null);const [focusCanvas,setFocusCanvas]=useState(false);
const fullscreenRequested=useRef(false);
useEffect(()=>()=>{if(fullscreenRequested.current&&isTauri())void invoke('set_canvas_fullscreen',{fullscreen:false}).catch(()=>{});},[]);
const panelsBeforeFocus=useRef<{left:boolean;right:boolean}|null>(null);
const [left,setLeft]=useState(true),[right,setRight]=useState(true),[leftWidth,setLeftWidth]=useState(()=>panelWidth("studio-layers-width",220,160,340)),[rightWidth,setRightWidth]=useState(()=>panelWidth("studio-properties-width",260,180,360));useEffect(()=>{localStorage.setItem("studio-layers-width",String(leftWidth));localStorage.setItem("studio-properties-width",String(rightWidth))},[leftWidth,rightWidth]);const [zoom,setZoom]=useState(100),[pan,setPan]=useState([0,0]),[drag,setDrag]=useState<{x:number;y:number;px:number;py:number}|null>(null),[grid,setGrid]=useState(true),[realistic,setRealistic]=useState(false);const [exportOpen,setExportOpen]=useState(false);const [threadLibrary]=useState(readThreads);const [recoveryStatus,setRecoveryStatus]=useState('');const [scope,setScope]=useState('all');const [fabric,setFabric]=useState('standard'),[spacing,setSpacing]=useState(.35),[length,setLength]=useState(3),[angle,setAngle]=useState(0),[pull,setPull]=useState(.15),[underlay,setUnderlay]=useState(true);const [objects,setObjects]=useState<EditableObject[]>([]),[objectQuery,setObjectQuery]=useState(''),[selectedObject,setSelectedObject]=useState<number|null>(null),[objectKind,setObjectKind]=useState('auto');const [layerTab,setLayerTab]=useState<'objects'|'threads'>('objects');
const [cameraTop,setCameraTop]=useState(()=>localStorage.getItem('studio-camera-top')!=='0');
useEffect(()=>localStorage.setItem('studio-camera-top',cameraTop?'1':'0'),[cameraTop]);
const cameraDrag=useRef<number|null>(null);
const [canvasMode,setCanvasMode]=useState<'pan'|'select'|'design'>('select');
const [objectOffset,setObjectOffset]=useState<[number,number]>([0,0]);
const [resizePreview,setResizePreview]=useState<ResizeOperation|null>(null);
const [designOffset,setDesignOffset]=useState<[number,number]>([0,0]);
const designGesture=useRef<{pointer:number;x:number;y:number}|null>(null);
const resizeGesture=useRef<{uid:number;pointer:number;handle:ResizeHandle;anchorX:number;anchorY:number}|null>(null);
const objectGesture=useRef<{uid:number;x:number;y:number;pointerId:number}|null>(null);
const selected=objects.find(object=>object.uid===selectedObject);
const objectPage=usePagedList(objects.filter(object=>matchesName(object.label,objectQuery)),objectQuery,6);
const [inspectorTab,setInspectorTab]=useState<'hoop'|'stitches'|'transform'|'sequence'>('hoop');
const [advanced,setAdvanced]=useState(!beginner);const [hoops]=useState(()=>profiles('studio-hoops',[{id:'100',name:'4 × 4 inch',width:100,height:100},{id:'130',name:'5 × 7 inch',width:130,height:180}])),[machines]=useState(()=>profiles('studio-machines',[])),[machine,setMachine]=useState(''),[hoop,setHoop]=useState('');const [plan,setPlan]=useState<Plan|null>(null),[format,setFormat]=useState('dst'),[width,setWidth]=useState(130),[height,setHeight]=useState(180),[playhead,setPlayhead]=useState<number|null>(null),[playbackSpeed,setPlaybackSpeed]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[artWidth,setArtWidth]=useState(80),[colors,setColors]=useState(0),[removeBackground,setRemoveBackground]=useState(true),[detail,setDetail]=useState(60),[playing,setPlaying]=useState(false),[scale,setScale]=useState(100),[rotation,setRotation]=useState(0),[dx,setDx]=useState(0),[dy,setDy]=useState(0),[hidden,setHidden]=useState<number[]>([]);
async function audit(){try{const a=await invoke<{short:number;long:number;zero:number;segments:number}>('audit_stitches');setMessage('Stitch audit: '+a.segments+' segments · '+a.short+' short · '+a.long+' long · '+a.zero+' near-zero. Review before production.')}catch(e){setMessage(String(e))}}
async function edit(command:string,args:Record<string,unknown>){setBusy(true);setMessage('');try{setPlan(await invoke<Plan>(command,args));setPlayhead(null)}catch(e){setMessage(String(e))}finally{setBusy(false)}}
useEffect(()=>{if(!plan||busy)return;const save=()=>{invoke('recovery_save',{width,height,format}).then(()=>setRecoveryStatus('Recovery copy saved')).catch(e=>setRecoveryStatus('Recovery save failed: '+String(e)))};const timer=setTimeout(save,1500);return()=>clearTimeout(timer)},[plan,width,height,format,busy]);
async function recover(){if(plan&&!await confirmAction('Replace the current design with the recovery copy?'))return;setBusy(true);try{const p=await invoke<{plan:Plan;width:number;height:number;format:string}|null>('recovery_open');if(p){setPlan(p.plan);setWidth(p.width);setHeight(p.height);setFormat(p.format);setMachine('');setHoop('');setHidden([]);setPlayhead(null);setMessage('Recovery copy opened. Save as a project to keep it.')}else setMessage('No recovery copy found.')}catch(e){setMessage(String(e))}finally{setBusy(false)}}
function transform(s:number,r:number,x:number,y:number){return edit('transform_design',{scale:s,rotation:r,dx:x,dy:y})}
function fit(){if(!points.length)return;const maxX=points.reduce((m,p)=>Math.max(m,Math.abs(p[0])),0),maxY=points.reduce((m,p)=>Math.max(m,Math.abs(p[1])),0);const s=Math.min(width*.45/Math.max(maxX,.01),height*.45/Math.max(maxY,.01),10);if(s>=.1)void transform(s,0,0,0);else setMessage('Design is too large for a single fit operation.')}
useEffect(()=>{try{const raw=sessionStorage.getItem('studio-open-project-settings');if(raw){const p=JSON.parse(raw);setWidth(p.width);setHeight(p.height);setFormat(p.format);sessionStorage.removeItem('studio-open-project-settings')}}catch{}let active=true;invoke<Plan|null>('current_preview').then(p=>{if(active&&p)setPlan(p)}).catch(()=>{});return ()=>{active=false}},[]);
useEffect(()=>{let active=true;invoke<EditableObject[]>('editable_objects').then(items=>{if(active){setObjects(items);setLayerTab(items.length?'objects':'threads');setSelectedObject(old=>items.some(o=>o.uid===old)?old:null)}}).catch(()=>{if(active){setObjects([]);if(plan)setLayerTab('threads')}});return()=>{active=false}},[plan]);
useEffect(()=>{
  let active=true;
  if(plan)void invoke<string|null>('current_fabric').then(value=>{if(active&&value)setFabric(value);}).catch(()=>{});
  return ()=>{active=false;};
},[plan]);
const threadPage=usePagedList(plan?.blocks??[],'layer-threads',6);
const resizeHandles:ResizeHandle[]=selected?.bounds&&selected.kind!=='manual'
  &&selected.bounds[2]>.001&&selected.bounds[3]>.001
  ? [[-1,-1,'nwse-resize'],[0,-1,'ns-resize'],[1,-1,'nesw-resize'],[1,0,'ew-resize'],
    [1,1,'nwse-resize'],[0,1,'ns-resize'],[-1,1,'nesw-resize'],[-1,0,'ew-resize']].map(([dx,dy,cursor])=>{
      const [x,y,width,height]=selected.bounds!;
      return {x:x+width*(Number(dx)+1)/2,y:y+height*(Number(dy)+1)/2,dx:Number(dx),dy:Number(dy),cursor:String(cursor)};
    }) : [];
const selectionTransform=resizePreview
  ? `translate(${resizePreview.x} ${resizePreview.y}) scale(${resizePreview.sx} ${resizePreview.sy}) translate(${-resizePreview.x} ${-resizePreview.y})`
  : `translate(${objectOffset.join(' ')})`;
const points=useMemo(()=>plan?.blocks.flatMap(block=>block.runs.flat())??[],[plan]);
const designBounds=useMemo(()=>{
  if(!points.length)return null;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {left,top,width:right-left,height:bottom-top};
},[points]);
const outside=points.some(point=>Math.abs(point[0])>width/2||Math.abs(point[1])>height/2);
const stitchIndex=Math.min(points.length,playhead??points.length);
let remaining=stitchIndex;
useEffect(()=>{
  if(!playing)return;
  const interval=window.setInterval(()=>{
    setPlayhead(previous=>Math.min(points.length,(previous??0)+playbackSpeed));
  },100);
  return()=>window.clearInterval(interval);
},[playing,playbackSpeed,points.length]);
useEffect(()=>{if(stitchIndex>=points.length)setPlaying(false);},[stitchIndex,points.length]);

function selectObject(object:EditableObject|null) {
  setSelectedObject(object?.uid??null);
  if(object){setObjectKind(object.kind);setRight(true);setInspectorTab(object.kind==="manual"?"transform":"stitches");}
}

function editSelection(operation:ObjectOperation,uid=selectedObject) {
  if(uid!==null&&!busy)void edit('edit_artwork_object',{uid,operation});
}

function pointerPosition(event:ReactPointerEvent<SVGSVGElement>) {
  const matrix=event.currentTarget.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()) : null;
}

function resizeAt(position:DOMPoint) {
  const gesture=resizeGesture.current;
  if(!gesture)return null;
  const {handle,anchorX:x,anchorY:y}=gesture;
  let sx=handle.dx?(position.x-x)/(handle.x-x):1;
  let sy=handle.dy?(position.y-y)/(handle.y-y):1;
  if(handle.dx&&handle.dy){
    const width=handle.x-x,height=handle.y-y;
    sx=((position.x-x)*width+(position.y-y)*height)/(width*width+height*height);
    sy=sx;
  }
  const clamp=(factor:number)=>Math.min(10,Math.max(.1,factor));
  return {kind:'resize' as const,sx:clamp(sx),sy:clamp(sy),x,y};
}

function startCanvasGesture(event:ReactPointerEvent<SVGSVGElement>) {
  if(busy||event.button!==0&&event.button!==1)return;
  const target=event.target instanceof Element?event.target.closest('[data-artwork-uid]'):null;
  const object=target?objects.find(item=>item.uid===Number(target.getAttribute('data-artwork-uid'))):undefined;
  const position=pointerPosition(event);
  if(canvasMode==='design'&&event.button===0&&position&&event.target instanceof Element&&event.target.hasAttribute('data-design-group')){
    designGesture.current={pointer:event.pointerId,x:position.x,y:position.y};
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  const handleIndex=event.target instanceof Element?event.target.getAttribute('data-resize-handle'):null;
  if(canvasMode==='select'&&event.button===0&&handleIndex!==null&&selected?.bounds){
    const handle=resizeHandles[Number(handleIndex)];
    const [x,y,width,height]=selected.bounds;
    resizeGesture.current={uid:selected.uid,pointer:event.pointerId,handle,
      anchorX:x+width*(handle.dx>0?0:handle.dx<0?1:.5),
      anchorY:y+height*(handle.dy>0?0:handle.dy<0?1:.5)};
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  if(canvasMode==='select'&&event.button===0&&object&&position){
    selectObject(object);
    objectGesture.current={uid:object.uid,x:position.x,y:position.y,pointerId:event.pointerId};
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  if(canvasMode==='select'&&event.button===0)selectObject(null);
  event.currentTarget.setPointerCapture(event.pointerId);
  setDrag({x:event.clientX,y:event.clientY,px:pan[0],py:pan[1]});
}

function moveCanvasGesture(event:ReactPointerEvent<SVGSVGElement>) {
  const position=pointerPosition(event);
  if(!position)return;
  if(designGesture.current?.pointer===event.pointerId){
    setDesignOffset([position.x-designGesture.current.x,position.y-designGesture.current.y]);
    return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    setResizePreview(resizeAt(position));
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId===event.pointerId){
    setObjectOffset([position.x-gesture.x,position.y-gesture.y]);
  }else if(drag){
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const start=new DOMPoint(drag.x,drag.y).matrixTransform(matrix.inverse());
    setPan([drag.px-(position.x-start.x),drag.py-(position.y-start.y)]);
  }
}

function finishCanvasGesture(event:ReactPointerEvent<SVGSVGElement>,commit:boolean) {
  if(designGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const start=designGesture.current;
    designGesture.current=null;
    setDesignOffset([0,0]);
    if(position){
      const dx=position.x-start.x,dy=position.y-start.y;
      if(Math.hypot(dx,dy)>=.05)void transform(1,0,dx,dy);
    }
    return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const result=position?resizeAt(position):null;
    const uid=resizeGesture.current.uid;
    resizeGesture.current=null;
    setResizePreview(null);
    if(result&&(Math.abs(result.sx-1)>.007||Math.abs(result.sy-1)>.007))editSelection(result,uid);
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId!==event.pointerId)return;
  const position=commit&&gesture?pointerPosition(event):null;
  objectGesture.current=null;
  setObjectOffset([0,0]);
  setDrag(null);
  if(gesture&&position){
    const dx=position.x-gesture.x,dy=position.y-gesture.y;
    if(Math.hypot(dx,dy)>=0.05)editSelection({kind:'move',dx,dy},gesture.uid);
  }
}

function stepStitch(delta:number) {
  setPlaying(false);
  setPlayhead(Math.max(0,Math.min(points.length,stitchIndex+delta)));
}

function fitArtwork() {
  if (!points.length) return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const [x,y] of points) {
    minX=Math.min(minX,x); minY=Math.min(minY,y);
    maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  }
  setZoom(Math.max(25,Math.min(400,Math.min(width/Math.max(1,maxX-minX),height/Math.max(1,maxY-minY))*88)));
  setPan([(minX+maxX)/2,(minY+maxY)/2]);
}

function changeFocus(next: boolean) {
  fullscreenRequested.current=next;
  setFocusCanvas(next);
  if (isTauri()) void invoke('set_canvas_fullscreen',{fullscreen:next}).catch(()=>{});
  if(next){
    panelsBeforeFocus.current={left,right};
    setLeft(false);
    setRight(false);
  }else if(panelsBeforeFocus.current){
    setLeft(panelsBeforeFocus.current.left);
    setRight(panelsBeforeFocus.current.right);
    panelsBeforeFocus.current=null;
  }
}

function toggleFocus() {
  changeFocus(!focusCanvas);
}

function openInsertDialog() {
  if(busy)return;
  insertDialog.current?.showModal();
}

async function open(){if(plan&&!await confirmAction('Replace the current design? Save your project first if needed.'))return;setBusy(true);setMessage('');try{const p=await invoke<Plan|null>('open_svg',{widthMm:artWidth,colors,removeBackground,detail});if(p){setPlan(p);setHidden([]);setPlayhead(null)}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
async function projectSave(){setBusy(true);try{const project=await invoke<Project|null>('save_project',{width,height,format});if(project){rememberProject({...project,thumbnail:plan?thumbnailOf(plan):undefined});toast('Project saved.')}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
async function projectOpen(){if(plan&&!await confirmAction('Replace the current design? Save your project first if needed.'))return;setBusy(true);try{const p=await invoke<{plan:Plan;width:number;height:number;format:string}|null>('open_project');if(p){setPlan(p.plan);setWidth(p.width);setHeight(p.height);setFormat(p.format);setMachine('');setHoop('');setHidden([]);setPlayhead(null)}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
async function save(){setBusy(true);try{if(await invoke<boolean>('export_design',{format,width,height}))toast('Embroidery file saved. Test sew before production.')}catch(e){setMessage(String(e))}finally{setBusy(false)}}
useEffect(()=>{const key=(e:KeyboardEvent)=>{if (document.querySelector('dialog[open]')||busy) return;
if(e.key==='Escape'&&focusCanvas){changeFocus(false);return;}
if((e.target as HTMLElement)?.closest("input,select,textarea")||e.repeat)return;
if(e.key==='F11'){e.preventDefault();toggleFocus();return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='i'){e.preventDefault();openInsertDialog();return;}
if(selectedObject!==null&&e.key==='Delete'){e.preventDefault();editSelection({kind:'delete'});return;}
if(selectedObject!==null&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();editSelection({kind:'duplicate'});return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if(plan)void projectSave()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();if(plan)void edit("history_step",{redo:e.shiftKey})}else if(e.key==="Escape"){setExportOpen(false);setDrag(null)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[plan,busy,width,height,format,focusCanvas,selectedObject,left,right]);return <><dialog ref={textDialog} className="studio-modal editor-lettering-modal" aria-label="Add text"><div className="studio-modal-heading"><h2>Add text</h2><button onClick={()=>textDialog.current?.close()}>Close</button></div><Lettering monogram={false} onDone={()=>{textDialog.current?.close();void invoke<Plan|null>("current_preview").then(p=>{if(p){setPlan(p);setPlayhead(null);setPlaying(false);setHidden([])}}).catch(e=>setMessage(String(e)))}}/></dialog><InsertDesignDialog<Plan> dialogRef={insertDialog} onInsert={result=>{
  setPlan(result);setPlayhead(null);setPlaying(false);setHidden([]);setMessage('');
}}/><div className={`studio-edit-bar ${focusCanvas?'studio-focus-active':''}`} role="group" aria-label="Design commands">
  <div className="studio-document">
    <Layers3 size={17} aria-hidden="true"/>
    <h1 title={plan?.name || 'Untitled design'}>{plan?.name || 'Untitled design'}</h1>
  </div>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title="Open artwork" aria-label="Open artwork" disabled={busy} onClick={open}><FolderOpen size={18}/></button>
    <button className="studio-insert-action" title="Insert design (Ctrl+I or Cmd+I)" aria-label="Insert design" disabled={busy} onClick={openInsertDialog}><FilePlus size={18}/><span>Insert design</span></button>
    <button className="studio-tool-icon" title="Save project (Ctrl+S or Cmd+S)" aria-label="Save project" disabled={!plan||busy} onClick={projectSave}><Save size={17}/></button>
  </div>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title="Undo" aria-label="Undo" disabled={!plan||busy} onClick={()=>edit('history_step',{redo:false})}><Undo2 size={17}/></button>
    <button className="studio-tool-icon" title="Redo" aria-label="Redo" disabled={!plan||busy} onClick={()=>edit('history_step',{redo:true})}><Redo2 size={17}/></button>
  </div>
  <div className="studio-command-group studio-design-tools"><button className="studio-add-text" disabled={busy} onClick={()=>textDialog.current?.showModal()}><Type size={17}/> Add Text</button>
    <button className="studio-tool-icon" title="Center design in hoop" aria-label="Center design" disabled={!plan||busy} onClick={()=>edit('center_design',{})}><Scan size={18}/></button>
    <button className="studio-tool-icon" title="Transform design" aria-label="Transform design" disabled={!plan} onClick={()=>{setRight(true);setInspectorTab('transform')}}><Move size={17}/></button>
    <button className="studio-tool-icon" title="Stitch tools" aria-label="Stitch tools" disabled={!plan} onClick={()=>{setRight(true);setInspectorTab('stitches')}}><Scissors size={17}/></button>
  </div>
  <div className="studio-command-group studio-view-tools">
    <button className="studio-tool-icon" title="Layers" aria-label="Layers" aria-pressed={left} onClick={()=>setLeft(value=>!value)}><PanelLeft size={18}/></button>
    <button className="studio-tool-icon" title="Inspector" aria-label="Inspector" aria-pressed={right} onClick={()=>setRight(value=>!value)}><PanelRight size={18}/></button>
    <button className="studio-tool-icon" title={focusCanvas?'Exit focus view (Esc)':'Full-screen canvas (F11)'} aria-label={focusCanvas?'Exit focus view':'Focus canvas'} aria-pressed={focusCanvas} onClick={toggleFocus}>{focusCanvas?<Minimize size={18}/>:<Maximize size={18}/>}</button>
  </div>
  <CommandPalette commands={[
    {label:'Move whole design',group:'Edit',run:()=>setCanvasMode('design'),disabled:!plan},
    {label:'Fit artwork',group:'View',run:fitArtwork,disabled:!plan},
    {label:'Fit hoop',group:'View',run:()=>{setZoom(100);setPan([0,0])}},
    {label:focusCanvas?'Exit focus view':'Focus canvas',group:'View',run:toggleFocus},
    {label:'Layers',group:'View',run:()=>setLeft(value=>!value)},
    {label:'Hoop and machine',group:'Inspector',run:()=>{setRight(true);setInspectorTab('hoop')}},
    {label:'Transform and resize',group:'Inspector',run:()=>{setRight(true);setInspectorTab('transform')},disabled:!plan},
    {label:'Stitch tools and quality',group:'Inspector',run:()=>{setRight(true);setInspectorTab('stitches')},disabled:!plan},
    {label:'Add Text',group:'Create',run:()=>textDialog.current?.showModal(),disabled:busy},
    {label:'Insert design',group:'File',run:openInsertDialog,disabled:busy},
    {label:'Duplicate selection',group:'Edit',run:()=>editSelection({kind:'duplicate'}),disabled:busy||!selected},
    {label:'Delete selection',group:'Edit',run:()=>editSelection({kind:'delete'}),disabled:busy||!selected},
    {label:'Rotate selection',group:'Edit',run:()=>editSelection({kind:'rotate'}),disabled:busy||!selected},
    {label:'Open artwork',group:'File',run:()=>void open(),disabled:busy},
    {label:'Open project',group:'File',run:()=>void projectOpen(),disabled:busy},
    {label:'Save project',group:'File',run:()=>void projectSave(),disabled:busy||!plan},
    {label:'Recover last design',group:'File',run:()=>void recover(),disabled:busy},
    {label:'Next stitch',group:'Playback',run:()=>stepStitch(1),disabled:stitchIndex===points.length},
    {label:'Previous stitch',group:'Playback',run:()=>stepStitch(-1),disabled:stitchIndex===0},
    {label:'Center design',group:'Edit',run:()=>void edit('center_design',{}),disabled:busy||!plan},
    ...navigation,
  ]}/>
  <details className="workspace-options">
    <summary title="Workspace options" aria-label="Workspace options"><Menu size={18}/></summary>
    <div className="workspace-options-panel">
      <button disabled={busy} onClick={projectOpen}>Open project</button>
      <button disabled={busy} onClick={recover}>Recover last design</button>
      <label><span>Layers panel width</span><input aria-label="Left panel width" type="range" min="160" max="340" value={leftWidth} onChange={e=>setLeftWidth(Number(e.target.value))}/></label>
      <label><span>Inspector width</span><input aria-label="Right panel width" type="range" min="180" max="360" value={rightWidth} onChange={e=>setRightWidth(Number(e.target.value))}/></label>
    </div>
  </details>
  {plan&&<GarmentPreview blocks={plan.blocks}/>}
  {plan&&<ThreadOrder blocks={plan.blocks} format={format} machine={machines.find(profile=>profile.id===machine)?.name??''}/>}
  <button className="primary studio-export" disabled={!plan||outside||busy||machines.some(m=>m.id===machine&&(width>m.width||height>m.height))} onClick={()=>setExportOpen(true)}><Download size={16}/> Export design</button>
</div>
{busy&&<div className="processing-overlay"><section className="processing-card" role="status"><div className="studio-spinner"/><h2>Working on your design</h2><progress aria-label="Processing"/></section></div>}<div className={`editor-grid studio-canvas-layout ${left?'':'hide-left'} ${right?'':'hide-right'}`} style={{gridTemplateColumns:`48px ${left?`min(${leftWidth}px, 24vw)`:'0px'} minmax(0,1fr) ${right?`min(${rightWidth}px, 28vw)`:'0px'}`}}>
<div className="editor-toolrail" role="group" aria-label="Editor tools"><button aria-pressed={canvasMode==='select'} onClick={()=>setCanvasMode('select')}><MousePointer2 size={19}/><small>Select</small></button><button aria-pressed={canvasMode==='pan'} onClick={()=>setCanvasMode('pan')}><Hand size={19}/><small>Pan</small></button><button disabled={busy} onClick={openInsertDialog}><FilePlus size={19}/><small>Insert</small></button><button disabled={busy} onClick={()=>textDialog.current?.showModal()}><Type size={19}/><small>Text</small></button><button onClick={()=>{setRight(true);setInspectorTab('transform')}}><Move size={19}/><small>Size</small></button><button onClick={()=>{setRight(true);setInspectorTab('stitches')}}><Scissors size={19}/><small>Stitch</small></button><button onClick={()=>{setLeft(true);setLayerTab('threads')}}><Layers3 size={19}/><small>Colors</small></button><button aria-pressed={realistic} onClick={()=>setRealistic(v=>!v)}><Eye size={19}/><small>Thread</small></button></div>
<article className="workspace-sidebar studio-layers-dock" style={{width:`min(${leftWidth}px, 28vw)`}}>
  <div className="layers-dock-header">
    <div className="layers-dock-title"><Layers3 size={17} aria-hidden="true"/><h2>Layers</h2>
      <button className="studio-tool-icon" title="Close layers" aria-label="Close layers" onClick={()=>setLeft(false)}><X size={15}/></button>
    </div>
    <div className="workspace-segments" role="group" aria-label="Layers">
      <button aria-pressed={layerTab==='objects'} onClick={()=>setLayerTab('objects')}>Objects <span>{objects.length}</span></button>
      <button aria-pressed={layerTab==='threads'} onClick={()=>setLayerTab('threads')}>Threads <span>{plan?.blocks.length??0}</span></button>
    </div>
  </div>
  {layerTab==='objects' && (objects.length ? <section className="workspace-object-list">
    <label className="layers-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search objects"
      placeholder="Find an object" value={objectQuery} onChange={event=>setObjectQuery(event.target.value)}/></label>
    {!objectPage.total&&<p className="workspace-helper">No objects match your search.</p>}
    <div className="layers-object-rows">
      {objectPage.items.map(object=>{
        const name=object.label||`Object ${object.uid+1}`;
        return <button key={object.uid} aria-pressed={selectedObject===object.uid} onClick={()=>selectObject(object)} className="object-layer-row" title={name}>
          <span className="layers-swatch" style={{backgroundColor:`rgb(${object.color.join(',')})`}}/>
          <span className="layers-row-text"><strong>{name}</strong><small>{object.kind==='manual'?'Fixed stitch path':object.kind==='auto'?'Automatic stitch type':object.kind}</small></span>
        </button>;
      })}
    </div>
    <ListNavigation {...objectPage}/>
    {selected?.kind==='manual'&&<p className="workspace-helper"><Waypoints size={14} aria-hidden="true"/> This stitched path can be moved. Use the Size inspector for resizing.</p>}
    {selected&&selected.kind!=='manual'&&<div className="layers-object-properties">
      <h3>Selected object stitch type</h3><StitchPicker value={objectKind} onChange={setObjectKind}/>
      <button disabled={busy||objectKind==='manual'} onClick={()=>edit('set_object_kind',{uid:selected.uid,kind:objectKind})}>Apply to selected object</button>
    </div>}
  </section> : <p className="workspace-helper">{plan ? 'This design has stitch paths. Open Threads to inspect the color blocks.' : 'Open artwork or insert a design to see its objects.'}</p>)}
  {layerTab==='threads' && (plan ? <section className="workspace-thread-list">
    {threadPage.items.map((block,offset)=>{
      const index=threadPage.start+offset;
      const color='#'+block.color.map(value=>value.toString(16).padStart(2,'0')).join('');
      const concealed=hidden.includes(index);
      function recolor(value:string) {
        void edit('recolor_block',{index,color:[1,3,5].map(position=>parseInt(value.slice(position,position+2),16))});
      }
      return <div className="thread-row layers-thread-row" key={index}>
        <input aria-label={`Thread ${index+1} color`} type="color" disabled={busy} value={color} onChange={event=>recolor(event.target.value)}/>
        <div className="layers-row-text"><strong>Thread {index+1}</strong><small>{color.toUpperCase()}</small></div>
        <button title={concealed?'Show this thread in the preview':'Hide this thread in the preview'} aria-label={concealed?'Show thread preview':'Hide thread preview'}
          onClick={()=>setHidden(items=>concealed?items.filter(item=>item!==index):[...items,index])}>{concealed?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        {!!threadLibrary.length&&<select aria-label={`Assign saved thread ${index+1}`} value="" disabled={busy} onChange={event=>{
          const thread=threadLibrary.find(item=>item.id===event.target.value);
          if(thread)recolor(thread.color);
        }}><option value="">Saved thread…</option>{threadLibrary.map(thread=><option key={thread.id} value={thread.id}>{thread.brand} {thread.code} {thread.name}</option>)}</select>}
      </div>;
    })}
    <ListNavigation {...threadPage}/>
  </section> : <p className="workspace-helper">Open a design to see its thread order.</p>)}
  <details className="workspace-disclosure">
    <summary>Artwork import settings</summary>
    <label>Artwork width (in) <small>({artWidth.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((artWidth/25.4).toFixed(3))} onChange={e=>{setArtWidth(Number(e.target.value)*25.4)}}/></label><label>Thread colors<select value={colors} onChange={e=>setColors(Number(e.target.value))}><option value="0">Automatic</option>{[2,3,4,5,6,7,8,9,10].map(n=><option key={n}>{n}</option>)}</select></label><label><input type="checkbox" checked={removeBackground} onChange={e=>setRemoveBackground(e.target.checked)}/> Remove white background</label><label>Detail<input type="range" min="0" max="100" value={detail} onChange={e=>setDetail(Number(e.target.value))}/></label>
  </details>
</article>
<article className="canvas-panel">
<div className="workspace-canvas">
<svg aria-label="Stitch preview; drag the background to pan" data-mode={canvasMode}
 onPointerDown={startCanvasGesture} onPointerMove={moveCanvasGesture}
 onPointerUp={event=>finishCanvasGesture(event,true)}
 onPointerCancel={event=>finishCanvasGesture(event,false)}
 onLostPointerCapture={event=>finishCanvasGesture(event,false)} viewBox={[pan[0]-width*.6*100/zoom,pan[1]-height*.6*100/zoom,width*1.2*100/zoom,height*1.2*100/zoom].join(' ')} className="design-canvas" onWheel={e=>{const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const anchor=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());const next=Math.max(25,Math.min(400,zoom*(e.deltaY<0?1.1:1/1.1)));if(next===zoom)return;const ratio=zoom/next;setPan([anchor.x+(pan[0]-anchor.x)*ratio,anchor.y+(pan[1]-anchor.y)*ratio]);setZoom(next)}} style={{width:'100%',background:'var(--lav-bg,var(--canvas,#edf1ed))'}}><defs><pattern id="hoop-fabric" width="1.4" height="1.4" patternUnits="userSpaceOnUse"><path d="M0 .2H1.4 M.2 0V1.4" fill="none" stroke="#967a68" strokeWidth=".075" opacity=".18"/></pattern><pattern id="hoop-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#d8cce6" strokeWidth=".75" vectorEffect="non-scaling-stroke"/></pattern></defs><rect x={-width/2} y={-height/2} width={width} height={height} fill="#fffdf5" stroke="#aa90b1" strokeWidth="1.6" rx={2} vectorEffect="non-scaling-stroke" className="studio-hoop"/><rect x={-width/2} y={-height/2} width={width} height={height} fill="url(#hoop-fabric)" rx={2}/><rect x={-width/2} y={-height/2} width={width} height={height} fill={grid?"url(#hoop-grid)":"none"}/>{grid&&<g stroke="#896d98" opacity=".6" pointerEvents="none">
<path d={`M ${-width/2} 0 H ${width/2} M 0 ${-height/2} V ${height/2}`} strokeDasharray="4 5" strokeWidth=".6" vectorEffect="non-scaling-stroke"/>
</g>}<g transform={`translate(${designOffset.join(' ')})`}>{plan?.blocks.map((b,i)=><g key={i} opacity={hidden.includes(i)?0:1} stroke={'rgb('+b.color.join(',')+')'} fill="none" strokeWidth={realistic?".48":".3"} strokeLinecap={realistic?"round":"butt"} strokeLinejoin="round">{b.runs.map((r,j)=>{const visible=r.slice(0,Math.max(0,remaining));remaining-=visible.length;return <polyline key={j} points={visible.map(p=>p.join(',')).join(' ')} vectorEffect={realistic?undefined:"non-scaling-stroke"} strokeWidth={realistic ? .42 : 1} className={realistic?'studio-thread-path':undefined}/>})}</g>)}{canvasMode==='design'&&designBounds&&<rect
  data-design-group x={designBounds.left-2} y={designBounds.top-2}
  width={designBounds.width+4} height={designBounds.height+4} rx={1}
  fill="transparent" pointerEvents="all" stroke="#8543aa" strokeWidth="1.5"
  vectorEffect="non-scaling-stroke" strokeDasharray="5 4"><title>Drag to move the whole design</title></rect>}</g>
{canvasMode==='select'&&stitchIndex===points.length&&<g className="studio-hit-targets">
 {objects.filter(object=>object.path).map(object=><path key={object.uid} d={object.path}
   data-artwork-uid={object.uid} fill={object.fill_rule?'transparent':'none'}
   fillRule={object.fill_rule} stroke={object.fill_rule?'none':'transparent'}
   strokeWidth={object.stroke_width} pointerEvents={object.fill_rule?'fill':'stroke'}/>)}
</g>}
{selected?.bounds&&canvasMode==='select'&&<g className="studio-selection" pointerEvents="none" transform={selectionTransform}>
 {(objectGesture.current||resizePreview)&&<path d={selected.path} fill={selected.fill_rule?'#8d53a333':'none'} fillRule={selected.fill_rule}
   stroke="#8d53a3" strokeWidth={selected.stroke_width||.3}/>}
 <rect x={selected.bounds[0]-.6} y={selected.bounds[1]-.6} width={selected.bounds[2]+1.2} height={selected.bounds[3]+1.2}
   fill="none" stroke="#8543aa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4 3"/>
 {resizeHandles.map((handle,index)=><circle key={index} cx={handle.x} cy={handle.y}
   r={Math.max(.65,1.2*100/zoom)} fill="#fff" stroke="#6945a2" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
   data-resize-handle={index} pointerEvents={busy?'none':'all'} style={{cursor:handle.cursor}}>
   <title>{handle.dx&&handle.dy?'Drag corner to resize':'Drag side to resize'}</title>
 </circle>)}
</g>}</svg>{selected&&canvasMode==='select'&&<div className="studio-selection-actions" role="group" aria-label="Selected object actions">
  <span>{selected.label||'Object '+selected.uid}</span>
  <button className="studio-tool-icon" title="Rotate selection 90°" aria-label="Rotate selection 90 degrees" disabled={busy} onClick={()=>editSelection({kind:'rotate'})}><RotateCw size={16}/></button>
  <button className="studio-tool-icon" title="Duplicate selection" aria-label="Duplicate selection" disabled={busy} onClick={()=>editSelection({kind:'duplicate'})}><Copy size={16}/></button>
  <button className="studio-tool-icon" title="Delete selection" aria-label="Delete selection" disabled={busy||objects.length<=1} onClick={()=>editSelection({kind:'delete'})}><Trash2 size={16}/></button>
</div>}
<div className={`studio-camera ${cameraTop?'studio-camera-top':''}`} role="group" aria-label="Canvas view">
  <button className="studio-tool-icon studio-camera-grip" title="Move camera controls to the top or bottom"
    aria-label={cameraTop?'Move camera controls to bottom':'Move camera controls to top'}
    onClick={event=>{if(event.detail===0)setCameraTop(value=>!value)}}
    onPointerDown={event=>{
      cameraDrag.current=event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerCancel={()=>{cameraDrag.current=null}}
    onPointerUp={event=>{
      if(cameraDrag.current===null)return;
      const moved=event.clientY-cameraDrag.current;
      cameraDrag.current=null;
      const box=event.currentTarget.closest('.workspace-canvas')?.getBoundingClientRect();
      if(Math.abs(moved)>7&&box)setCameraTop(event.clientY<box.top+box.height/2);
      else setCameraTop(value=>!value);
    }}><GripHorizontal size={16}/></button>
  <button className="studio-tool-icon" title="Select editable objects" aria-label="Select objects" aria-pressed={canvasMode==='select'} onClick={()=>setCanvasMode('select')}><MousePointer2 size={17}/></button>
  <button className="studio-tool-icon" title="Move whole design" aria-label="Move whole design" disabled={!points.length}
    aria-pressed={canvasMode==='design'} onClick={()=>{setCanvasMode('design');setPlaying(false);setPlayhead(null);}}><Group size={17}/></button>
  <button className="studio-tool-icon" title="Pan canvas" aria-label="Pan canvas" aria-pressed={canvasMode==='pan'} onClick={()=>setCanvasMode('pan')}><Hand size={17}/></button>
  <button className="studio-tool-icon" title="Zoom out" aria-label="Zoom out" disabled={zoom<=25} onClick={()=>setZoom(value=>Math.max(25,value-25))}><ZoomOut size={17}/></button>
  <span>{Math.round(zoom)}%</span>
  <button className="studio-tool-icon" title="Zoom in" aria-label="Zoom in" disabled={zoom>=400} onClick={()=>setZoom(value=>Math.min(400,value+25))}><ZoomIn size={17}/></button>
  <button title="Fit artwork" disabled={!points.length} onClick={fitArtwork}>Fit artwork</button>
  <button title="Fit hoop view" onClick={()=>{setZoom(100);setPan([0,0])}}>Hoop</button>
  <button className="studio-tool-icon" title="Hoop grid" aria-label="Hoop grid" aria-pressed={grid} onClick={()=>setGrid(value=>!value)}><Grid size={16}/></button>
  <button title="Thread view" aria-pressed={realistic} onClick={()=>setRealistic(value=>!value)}>Thread</button>
</div>{!plan&&<div className="workspace-empty">
  <SquareDashed size={31}/>
  <strong>Start with a design</strong>
  <p>Open artwork or insert a library template.</p>
  <button onClick={openInsertDialog}><FilePlus size={16}/> Browse designs</button>
</div>}</div>
<div className="playback-tools">
  <button disabled={!points.length} onClick={()=>{if(stitchIndex===points.length)setPlayhead(0);setPlaying(!playing)}}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?"Pause":"Play"}</button>
  <button aria-label="Restart simulation" title="Restart simulation" disabled={!points.length} onClick={()=>{setPlaying(false);setPlayhead(0)}}><RotateCcw size={15}/></button>
  <button title="Previous stitch" aria-label="Previous stitch" disabled={stitchIndex===0} onClick={()=>stepStitch(-1)}><StepBack size={15}/></button>
  <button title="Next stitch" aria-label="Next stitch" disabled={stitchIndex===points.length} onClick={()=>stepStitch(1)}><StepForward size={15}/></button>
  <label><span className="screen-reader-only">Planned stitch position</span><input type="range" min="0" max={points.length} disabled={!points.length} value={stitchIndex} onChange={e=>{setPlaying(false);setPlayhead(Number(e.target.value))}}/></label>
  <select aria-label="Playback speed" value={playbackSpeed} onChange={event=>setPlaybackSpeed(Number(event.target.value))}>
    <option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option>
  </select>
  <span className="stitch-playhead">{stitchIndex.toLocaleString()} / {points.length.toLocaleString()}</span>
</div>
</article><article className="workspace-sidebar workspace-inspector studio-inspector-dock" style={{width:`min(${rightWidth}px, 30vw)`}}>
  <h2>Inspector</h2>
  <div className="workspace-segments" role="group" aria-label="Inspector">
    <button aria-pressed={inspectorTab==='hoop'} onClick={()=>setInspectorTab('hoop')}>Design</button>
    <button aria-pressed={inspectorTab==='sequence'} onClick={()=>setInspectorTab('sequence')}>Sequence</button>
    <button aria-pressed={inspectorTab==='stitches'} onClick={()=>setInspectorTab('stitches')}>Stitches</button>
    <button aria-pressed={inspectorTab==='transform'} onClick={()=>setInspectorTab('transform')}>Size</button>
  </div>
  {inspectorTab==='hoop'&&<section className="workspace-inspector-group">
    <h3>Machine setup</h3><label>Machine<select value={machine} onChange={e=>{setMachine(e.target.value);const m=machines.find(p=>p.id===e.target.value);if(m){setWidth(m.width);setHeight(m.height);setHoop("");if(m.format)setFormat(m.format.toLowerCase())}}}><option value="">Manual setup</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Saved hoop<select value={hoop} onChange={e=>{setHoop(e.target.value);const h=hoops.find(p=>p.id===e.target.value);if(h){setWidth(h.width);setHeight(h.height)}}}><option value="">Custom dimensions</option>{hoops.map(h=><option key={h.id} value={h.id}>{h.name} — {h.width} × {h.height}</option>)}</select></label><label>Width (in) <small>({width.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((width/25.4).toFixed(3))} onChange={e=>{setHoop("");setWidth(Number(e.target.value)*25.4)}}/></label><label>Height (in) <small>({height.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((height/25.4).toFixed(3))} onChange={e=>{setHoop("");setHeight(Number(e.target.value)*25.4)}}/></label>
    <label>Export format<select value={format} onChange={e=>setFormat(e.target.value)}>
      {['dst','pes','jef','exp','vp3','pec'].map(f=><option value={f} key={f}>{f.toUpperCase()}</option>)}
    </select></label>
    {plan&&<div className="inspector-design-info"><h3>Design information</h3><dl><dt>Stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd><dt>Color blocks</dt><dd>{plan.blocks.length}</dd><dt>Trims</dt><dd>{plan.trims}</dd></dl></div>}{outside&&<p className="workspace-warning" role="alert">Design exceeds the hoop.</p>}
  </section>}
  {inspectorTab==='sequence'&&<section className="workspace-inspector-group"><h3>Sewing sequence</h3>{plan?.blocks.map((b,i)=><div className="sequence-item" key={i}><span>{i+1}</span><i style={{background:`rgb(${b.color.join(',')})`}}/><strong>{b.runs.reduce((n,r)=>n+r.length,0).toLocaleString()} points</strong></div>)}{!plan&&<p className="workspace-helper">Open a design to see its sewing sequence.</p>}</section>}
  {inspectorTab==='stitches'&&<section className="workspace-inspector-group">
    <h3>Generation settings</h3>
    <button onClick={()=>setAdvanced(v=>!v)} aria-expanded={advanced}>{advanced?'Hide stitch parameters':'Show stitch parameters'}</button>
    <FabricPicker value={fabric} disabled={busy||!plan||!objects.length}
      onChange={id=>void edit('apply_fabric_profile',{fabric:id})}/>
    {advanced&&<>{([{label:'Row spacing (mm)',value:spacing,set:setSpacing,min:.15,max:2,step:.05},{label:'Stitch length (mm)',value:length,set:setLength,min:.5,max:7,step:.1},{label:'Fill angle (°)',value:angle,set:setAngle,min:0,max:360,step:5},{label:'Pull compensation (mm)',value:pull,set:setPull,min:0,max:1,step:.05}]).map(f=><label key={f.label}>{f.label}<input type="number" min={f.min} max={f.max} step={f.step} value={f.value} onChange={e=>f.set(Number(e.target.value))}/></label>)}<label><input type="checkbox" checked={underlay} onChange={e=>setUnderlay(e.target.checked)}/> Underlay</label></>}{advanced&&<><label>Apply settings to<select value={scope} onChange={e=>setScope(e.target.value)}><option value="all">Entire design</option><option value="object" disabled={selectedObject===null}>Selected object</option></select></label><button disabled={!plan||busy||(scope==='object'&&selectedObject===null)} onClick={()=>edit('apply_stitch_properties',{uid:scope==='object'?selectedObject:null,fabric,spacing,length,angle,pull,underlay})}>Apply stitch parameters</button></>}
    <h3>Quality</h3><div className="workspace-stack"><button disabled={!plan||busy} onClick={async()=>{if(await confirmAction("Remove exact duplicate points and split stitches longer than 10 mm? This converts editable artwork to stitch geometry."))void edit("repair_stitches",{})}}>Repair stitches</button><button disabled={!plan||busy} onClick={audit}>Check stitch quality</button></div>
    {plan&&<details className="workspace-disclosure"><summary>Stitch-length report</summary><section><h3>Quality review</h3>{(()=>{let short=0,long=0;for(const b of plan.blocks)for(const r of b.runs)for(let i=1;i<r.length;i++){const d=Math.hypot(r[i][0]-r[i-1][0],r[i][1]-r[i-1][1]);if(d<.3)short++;if(d>7)long++;}return <><p>{short} stitch segments shorter than 0.3 mm</p><p>{long} stitch segments longer than 7 mm</p>{short>0&&<p className="muted">Inspect tiny stitches for thread buildup.</p>}{long>0&&<p className="muted">Inspect long spans for snagging. Export may subdivide these.</p>}{plan.trims>50&&<p className="muted">Many trims: inspect artwork fragmentation and sewing order.</p>}</>})()}<small>Heuristic review of planned stitches, not a guarantee of sewability.</small></section></details>}
  </section>}
  {inspectorTab==='transform'&&<section className="workspace-inspector-group">
    <h3>Placement & size</h3><div className="workspace-stack"><button disabled={!plan||busy} title="Move the design to the center of the selected hoop" onClick={()=>edit("center_design",{})}><Scan size={16}/> Center in hoop</button><button disabled={!plan||busy} title="Resize the design to fit the hoop" onClick={fit}><Maximize size={16}/> Resize to fit hoop</button><button disabled={!plan||busy} onClick={()=>transform(1,90,0,0)}><RotateCw size={16}/> Rotate 90°</button><button disabled={!plan||busy} title="Mirror the design left to right" onClick={()=>edit("mirror_design",{horizontal:true})}><FlipHorizontal size={16}/> Flip horizontal</button><button disabled={!plan||busy} title="Mirror the design top to bottom" onClick={()=>edit("mirror_design",{horizontal:false})}><FlipVertical size={16}/> Flip vertical</button></div>
    <div className="workspace-transform-fields"><label>Scale (%)<input type="number" min="10" max="1000" value={scale} onChange={e=>setScale(Number(e.target.value))}/></label><label>Rotation (°)<input type="number" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label><label>Move X (in) <small>({dx.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dx/25.4).toFixed(3))} onChange={e=>{setDx(Number(e.target.value)*25.4)}}/></label><label>Move Y (in) <small>({dy.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dy/25.4).toFixed(3))} onChange={e=>{setDy(Number(e.target.value)*25.4)}}/></label><button disabled={!plan||busy} onClick={()=>transform(scale/100,rotation,dx,dy)}>Apply transform to design</button>
    {selected&&<button disabled={busy} onClick={()=>editSelection({kind:'scale',factor:scale/100})}>Scale selected object</button>}</div>
    <p className="workspace-helper">Editable artwork regenerates when resized. Test sew machine-only files after scaling.</p>
  </section>}
</article></div><footer className="workspace-status">
  <span>{width>0&&height>0?`Hoop ${(width/25.4).toFixed(2)} × ${(height/25.4).toFixed(2)} in`:'Set a hoop size'}</span>
  {plan&&<span>{plan.stitches.toLocaleString()} points <span aria-hidden="true">·</span> {plan.blocks.length} color blocks <span aria-hidden="true">·</span> {plan.trims} trims</span>}
  <span>{outside?'Outside hoop':recoveryStatus}</span>
</footer>
{exportOpen&&plan&&<ExportCenter plan={plan} width={width} height={height} format={format} setFormat={setFormat} machine={machines.find(m=>m.id===machine)?.name||""} blocked={outside||machines.some(m=>m.id===machine&&(width>m.width||height>m.height))} busy={busy} onExport={save} onClose={()=>setExportOpen(false)}/>}{message&&<p role="status">{message}</p>}</>}
