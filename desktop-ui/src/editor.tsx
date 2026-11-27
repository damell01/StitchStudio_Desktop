import {AdvancedStitches} from './advanced-stitches';
import type {WorkspaceView} from './project-tabs';
import {StitchGuideOverlay,useStitchGuides} from './stitch-guides';
import {compositionPrompt,parseComposition} from './assistant-composition';
import {DrawingControls,DrawingOverlay,drawingTools,useCanvasDrawing} from './canvas-drawing';
import {resolveMotif} from './assistant-motif';
import {DesignIssuesDialog,QualityInspector,PathToolsDialog,TestSwatchesDialog} from './stitch-tools';
import {PricingCalculator} from './pricing-calculator';
import {PathEditor} from './path-editor';
import {assistantIntent} from './assistant-intent';
import {AssistantChat,type AssistantProposal} from './assistant-chat';
import {rememberProject,thumbnailOf,type Project} from './library';
import {InlineLettering,type PickedBaseline} from './lettering';
import {Type,Clock3,ArrowUp,ArrowDown,ArrowLeft,ArrowRight} from 'lucide-react';
import {GarmentPreview} from './garment-preview';
import {ThreadOrder,ReferenceColorPanel,type ThreadAssignments} from './thread-order';
import {FabricPicker} from './fabric-picker';
import {LayerDialog,SavedThreadDialog} from './layer-dialogs';
import {InspectorDialog,StitchLengthReport} from './workspace-inspector';
import './editor-frame.css';
import {ListNavigation,matchesName,usePagedList} from './list-navigation';
import {CommandPalette,type Command} from './command-palette';
import {InsertDesignDialog} from './insert-design-dialog';
import {EditorDigitizer} from './editor-digitizer';
import {confirmAction,toast} from './dialogs';
import {ExportCenter} from './export-center';
import {readThreads} from './threads';
import {EditorHelp, StitchPicker} from './stitch-guide';
import {useState,useEffect,useRef,useMemo,type PointerEvent as ReactPointerEvent,type CSSProperties} from 'react';
import {Save,Undo2,Redo2,FolderOpen,Download,RotateCw,Move,Maximize,Play,Pause,Eye,EyeOff,PanelLeft,PanelRight,ZoomIn,ZoomOut,Grid,Scan,FlipHorizontal,FlipVertical,FilePlus,Layers3,SquareDashed,Scissors,RotateCcw,Minimize,Menu,StepBack,StepForward,MousePointer2,PenLine,Hand,Copy,Trash2,GripHorizontal,Search,X,Waypoints,Group,Wrench,Palette,MoreHorizontal,CheckCircle2,LockKeyhole,LockKeyholeOpen,GripVertical,SlidersHorizontal} from 'lucide-react';
import {invoke,isTauri} from '@tauri-apps/api/core';
type Plan={name:string;stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type EditableObject={uid:number;groups?:string[];label:string;locked?:boolean;hidden?:boolean;color:number[];kind:string;bounds?:[number,number,number,number];path?:string;fill_rule?:'evenodd'|'nonzero';stroke_width?:number};
type ObjectOperation={kind:'move';dx:number;dy:number}|{kind:'scale';factor:number}|{kind:'rotate'|'duplicate'|'delete'}|ResizeOperation;
type ResizeOperation={kind:'resize';sx:number;sy:number;x:number;y:number};
type ResizeHandle={x:number;y:number;dx:number;dy:number;cursor:string};
// Fast offline intent recognition. Only explicitly supported commands are
// accepted; never evaluate user text or execute arbitrary native commands.

type Profile={id:string;name:string;width:number;height:number;format?:string;machineIds?:string[]};
function hoopFits(h:Profile,m?:Profile){return !m||((!h.machineIds?.length||h.machineIds.includes(m.id))&&h.width<=m.width+.001&&h.height<=m.height+.001)}
function profiles(key:string,fallback:Profile[]):Profile[]{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
function panelWidth(key: string, fallback: number, min: number, max: number) {
  const value = Number(localStorage.getItem(key));
  return value >= min && value <= max ? value : fallback;
}
export function Editor({navigation=[],initialAssistant=false,onAssistantOpened,initialView,tabId,onWorkspaceStatus}:{
  navigation?:Command[];
  initialAssistant?:boolean;
  onAssistantOpened?:()=>void;
  initialView?:WorkspaceView;
  tabId?:string;
  onWorkspaceStatus?:(status:{view:WorkspaceView;name:string|null;busy:boolean})=>void;
}){const insertDialog=useRef<HTMLDialogElement>(null);const [focusCanvas,setFocusCanvas]=useState(false);const [pricingOpen,setPricingOpen]=useState(false);
let nextSimplificationRequest = Date.now() * 1000;
const fullscreenRequested=useRef(false);
useEffect(()=>()=>{if(fullscreenRequested.current&&isTauri())void invoke('set_canvas_fullscreen',{fullscreen:false}).catch(()=>{});},[]);
const panelsBeforeFocus=useRef<{left:boolean;right:boolean}|null>(null);
const dockBreakpoint=1100;
const [left,setLeft]=useState(false),[right,setRight]=useState(false),[leftWidth,setLeftWidth]=useState(()=>panelWidth("studio-layers-width",216,180,320)),[rightWidth,setRightWidth]=useState(()=>panelWidth("studio-properties-width",260,220,360));
function showLayers(open:boolean){
  if(open&&focusCanvas)changeFocus(false);
  if(open&&window.innerWidth<dockBreakpoint)setRight(false);
  setLeft(open);
}
function showInspector(open:boolean){
  if(open&&focusCanvas)changeFocus(false);
  if(open&&window.innerWidth<dockBreakpoint)setLeft(false);
  setRight(open);
}
useEffect(()=>{
  const query=window.matchMedia(`(max-width: ${dockBreakpoint-1}px)`);
  function onNarrow(event:MediaQueryListEvent){if(event.matches)setLeft(false)}
  query.addEventListener('change',onNarrow);
  return()=>query.removeEventListener('change',onNarrow);
},[]);useEffect(()=>{localStorage.setItem("studio-layers-width",String(leftWidth));localStorage.setItem("studio-properties-width",String(rightWidth))},[leftWidth,rightWidth]);const [zoom,setZoom]=useState(initialView?.zoom??100),[pan,setPan]=useState(initialView?.pan??[0,0]),[drag,setDrag]=useState<{x:number;y:number;px:number;py:number}|null>(null),[grid,setGrid]=useState(true),[realistic,setRealistic]=useState(true);const [exportOpen,setExportOpen]=useState(false);const [threadAssignments,setThreadAssignments]=useState<ThreadAssignments>(initialView?.threadAssignments??{});const [threadLibrary]=useState(readThreads);const [recoveryStatus,setRecoveryStatus]=useState('');const [scope,setScope]=useState('all');const [fabric,setFabric]=useState('standard'),[spacing,setSpacing]=useState(.35),[length,setLength]=useState(3),[angle,setAngle]=useState(0),[pull,setPull]=useState(.15),[underlay,setUnderlay]=useState(true);const [objects,setObjects]=useState<EditableObject[]>([]),[objectQuery,setObjectQuery]=useState(''),[selectedObject,setSelectedObject]=useState<number|null>(null),[objectKind,setObjectKind]=useState('auto');const [layerTab,setLayerTab]=useState<'objects'|'threads'>('objects');
const resizePanel=useRef<{side:'left'|'right';start:number;width:number;pointer:number}|null>(null);
function panelResizeHandle(side:'left'|'right'){
 const value=side==='left'?leftWidth:rightWidth;
 const min=side==='left'?180:220,max=side==='left'?320:360;
 const change=(next:number)=>(side==='left'?setLeftWidth:setRightWidth)(Math.max(min,Math.min(max,next)));
 return <div className={'studio-panel-resizer resize-'+side} role="separator" aria-label={side==='left'?'Resize layers panel':'Resize inspector panel'} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} onPointerDown={e=>{if(e.button!==0)return;resizePanel.current={side,start:e.clientX,width:value,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault()}} onPointerMove={e=>{const drag=resizePanel.current;if(drag?.pointer===e.pointerId&&drag.side===side)change(drag.width+(e.clientX-drag.start)*(side==='left'?1:-1))}} onLostPointerCapture={()=>{resizePanel.current=null}} onPointerCancel={()=>{resizePanel.current=null}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change(value+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*10)}else if(e.key==='Home'||e.key==='End'){e.preventDefault();change(e.key==='Home'?min:max)}}}/>;
}
const [cameraTop,setCameraTop]=useState(()=>localStorage.getItem('studio-camera-top')!=='0');
useEffect(()=>localStorage.setItem('studio-camera-top',cameraTop?'1':'0'),[cameraTop]);
const cameraDrag=useRef<number|null>(null);
const [canvasMode,setCanvasMode]=useState<'pan'|'select'|'design'|'solid'>('select');
const [solidAreaShape,setSolidAreaShape]=useState<'box'|'oval'>('box');
const [objectOffset,setObjectOffset]=useState<[number,number]>([0,0]);
const [resizePreview,setResizePreview]=useState<ResizeOperation|null>(null);
const [designOffset,setDesignOffset]=useState<[number,number]>([0,0]);
const designGesture=useRef<{pointer:number;x:number;y:number;clientX:number;clientY:number;uids?:number[]}|null>(null);
const [activeGroup,setActiveGroup]=useState<string|null>(null);
const groupResizeGesture=useRef<{pointer:number;uids:number[];cx:number;cy:number;x:number;y:number}|null>(null);
const [groupScalePreview,setGroupScalePreview]=useState<[number,number]>([1,1]);
const rotationGesture=useRef<{pointer:number;uids:number[];cx:number;cy:number;start:number}|null>(null);
const [rotationPreview,setRotationPreview]=useState(0);
const [showDirections,setShowDirections]=useState(false);

function rotationAt(position:DOMPoint,shift:boolean){const g=rotationGesture.current;if(!g)return 0;let degrees=(Math.atan2(position.y-g.cy,position.x-g.cx)-g.start)*180/Math.PI;degrees=((degrees+540)%360)-180;return shift?Math.round(degrees/15)*15:degrees}

function groupScaleAt(position:DOMPoint,shift:boolean):[number,number]{const g=groupResizeGesture.current;if(!g)return [1,1];const x=g.x-g.cx,y=g.y-g.cy;const clamp=(n:number)=>Math.max(.1,Math.min(10,n));if(shift){const s=clamp(((position.x-g.cx)*x+(position.y-g.cy)*y)/Math.max(.0001,x*x+y*y));return [s,s]}return [Math.abs(x)>.001?clamp((position.x-g.cx)/x):1,Math.abs(y)>.001?clamp((position.y-g.cy)/y):1]}
const [groupWidth,setGroupWidth]=useState(''),[groupRotation,setGroupRotation]=useState('0');
useEffect(()=>{setGroupWidth('');setGroupRotation('0')},[activeGroup]);
const designGroups=useMemo(()=>{const map=new Map<string,EditableObject[]>();for(const o of objects){const key=o.groups?.find(g=>g.startsWith('tl-custom-group-')||g.startsWith('tl-independent-'))||o.groups?.find(g=>g.startsWith('tl-added-'))||o.groups?.find(g=>g.startsWith('tl-lettering-'))||'original';const list=map.get(key)||[];list.push(o);map.set(key,list)}return Array.from(map,([key,members])=>{const b=members.flatMap(o=>o.bounds?[o.bounds]:[]);if(!b.length)return {key,members,bounds:null};const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return {key,members,bounds:[x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]}})},[objects]);
const independentGroups=designGroups.length>1;
const resizeGesture=useRef<{uid:number;pointer:number;handle:ResizeHandle;anchorX:number;anchorY:number}|null>(null);
const objectGesture=useRef<{uid:number;x:number;y:number;clientX:number;clientY:number;pointerId:number}|null>(null);
const selected=objects.find(object=>object.uid===selectedObject);
const [multi,setMulti]=useState<number[]>([]);const [snap,setSnap]=useState(false);const [context,setContext]=useState<{uid:number;x:number;y:number}|null>(null);
const selectionIds=multi.filter(id=>objects.some(o=>o.uid===id&&!o.locked&&!o.hidden));
const [nudgeStep,setNudgeStep]=useState(1);
const lockedObjects=useMemo(()=>objects.filter(object=>object.locked||object.hidden).map(object=>object.uid),[objects]);
const [dragLayer,setDragLayer]=useState<number|null>(null);
const [artworkImport,setArtworkImport]=useState<{file:File|null}|null>(null);
const [artworkDrag,setArtworkDrag]=useState(false);
const [dropLayer,setDropLayer]=useState<{uid:number;direction:'before'|'after'}|null>(null);
const [renameDraft,setRenameDraft]=useState('');
const [marquee,setMarquee]=useState<{x:number;y:number;w:number;h:number}|null>(null);
const marqueeGesture=useRef<{pointer:number;x:number;y:number;clientX:number;clientY:number;add:boolean;initial:number[]}|null>(null);
const [hoverUid,setHoverUid]=useState<number|null>(null);
const [positionX,setPositionX]=useState(''),[positionY,setPositionY]=useState('');
const movementIds=canvasMode==='design'?(designGroups.find(g=>g.key===activeGroup)?.members.filter(o=>!o.locked&&!o.hidden).map(o=>o.uid)??[]):selectionIds.length?selectionIds:selected?[selected.uid]:[];
function nudge(dx:number,dy:number){if(busy||!movementIds.length||movementIds.some(id=>lockedObjects.includes(id)))return;void edit('move_artwork_objects',{uids:movementIds,dx,dy});}
const multiBounds=useMemo(()=>{const b=objects.filter(o=>multi.includes(o.uid)&&o.bounds).map(o=>o.bounds!);if(!b.length)return null;const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]},[objects,multi]);

const movementBounds=useMemo(()=>{const b=objects.filter(o=>movementIds.includes(o.uid)&&o.bounds).map(o=>o.bounds!);if(!b.length)return null;const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]},[objects,movementIds.join(',')]);
const selectionCenter=movementBounds?[movementBounds[0]+movementBounds[2]/2,movementBounds[1]+movementBounds[3]/2]:null;
useEffect(()=>{setPositionX(selectionCenter?selectionCenter[0].toFixed(2):'');setPositionY(selectionCenter?selectionCenter[1].toFixed(2):'')},[selectionCenter?.[0],selectionCenter?.[1],movementIds.join(',')]);
function applyPosition(){if(!selectionCenter||!positionX.trim()||!positionY.trim())return;const x=Number(positionX),y=Number(positionY);if(Number.isFinite(x)&&Number.isFinite(y))nudge(x-selectionCenter[0],y-selectionCenter[1]);}
function selectNearbyRegion(){
 const seed=objects.find(o=>o.uid===selectedObject);if(!seed?.bounds)return;
 const group=new Set([seed.uid]);const gap=1.2;
 const nearby=(a:EditableObject,b:EditableObject)=>{if(!a.bounds||!b.bounds)return false;const [x,y,w,h]=a.bounds,[u,v,j,k]=b.bounds;return x<=u+j+gap&&u<=x+w+gap&&y<=v+k+gap&&v<=y+h+gap};
 const candidates=objects.filter(o=>o.color.join(',')===seed.color.join(',')&&!lockedObjects.includes(o.uid)&&!o.groups?.some(g=>g.startsWith('tl-lettering-'))&&!o.groups?.some(g=>g==='tl-small-ink-detail'));
 for(let pass=0;pass<8;pass++){let added=false;for(const o of candidates){if(!group.has(o.uid)&&candidates.some(q=>group.has(q.uid)&&nearby(o,q))){group.add(o.uid);added=true}}if(!added)break}
 setMulti([...group]);setCanvasMode('select');setSelectedObject(null);setActiveGroup(null);setLayerTab('objects');showLayers(true);
}
function toggleMulti(uid:number){setCanvasMode('select');setMulti(old=>{const base=old.length?old:selectedObject!==null?[selectedObject]:[];return base.includes(uid)?base.filter(i=>i!==uid):[...base,uid]});setLayerTab('objects')}
const [guides,setGuides]=useState<{x:number|null;y:number|null}>({x:null,y:null});
function snapped(dx:number,dy:number,uids?:number[],show=false):[number,number]{
 if(!snap){if(show)setGuides({x:null,y:null});return [dx,dy]}
 const chosen=uids?new Set(uids):null;
 const bounds=chosen?objects.filter(o=>chosen.has(o.uid)&&o.bounds).map(o=>o.bounds!):[];
 const source=chosen&&bounds.length?[Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[0]+b[2])),Math.max(...bounds.map(b=>b[1]+b[3]))]:!chosen&&designBounds?[designBounds.left,designBounds.top,designBounds.left+designBounds.width,designBounds.top+designBounds.height]:null;
 if(!source){if(show)setGuides({x:null,y:null});return [Math.round(dx),Math.round(dy)]}
 const xs=[-width/2,0,width/2],ys=[-height/2,0,height/2];
 if(chosen)for(const g of designGroups){if(!g.bounds||g.members.some(o=>chosen.has(o.uid)))continue;const [x,y,w,h]=g.bounds;xs.push(x,x+w/2,x+w);ys.push(y,y+h/2,y+h)}
 const threshold=Math.max(.4,Math.min(3,150/zoom));
 function axis(delta:number,anchors:number[],targets:number[]):[number,number|null]{let best=threshold,shift=0,guide:number|null=null;for(const a of anchors)for(const t of targets){const d=t-a-delta;if(Math.abs(d)<best){best=Math.abs(d);shift=d;guide=t}}return guide===null?[Math.round(delta),null]:[delta+shift,guide]}
 const [x,gx]=axis(dx,[source[0],(source[0]+source[2])/2,source[2]],xs);
 const [y,gy]=axis(dy,[source[1],(source[1]+source[3])/2,source[3]],ys);
 if(show)setGuides({x:gx,y:gy});return [x,y]
}
const objectPage=usePagedList(objects.filter(object=>matchesName(object.label,objectQuery)),objectQuery,6);
const [convertText,setConvertText]=useState(false);const recognitionCache=useRef(new Map<string,{text:string;font:string}[]>());const [recognizingWord,setRecognizingWord]=useState(false);const [recognizedOriginal,setRecognizedOriginal]=useState('');const [recognitionError,setRecognitionError]=useState('');const [failedWord,setFailedWord]=useState('');const [recognizedIds,setRecognizedIds]=useState<number[]>([]);const [convertWord,setConvertWord]=useState('');const [convertFont,setConvertFont]=useState('');const [convertFonts,setConvertFonts]=useState<string[]>([]);const [inspectorTab,setInspectorTab]=useState<'hoop'|'stitches'|'transform'|'sequence'|'threads'|'text'|'quality'>('hoop');const inspectorScroll=useRef<HTMLElement|null>(null);useEffect(()=>{if(inspectorScroll.current)inspectorScroll.current.scrollTop=0},[inspectorTab]);const [assistantOpen,setAssistantOpen]=useState(initialAssistant);useEffect(()=>{if(initialAssistant)onAssistantOpened?.()},[]);const [hoopOpen,setHoopOpen]=useState(false);const [simplifyOpen,setSimplifyOpen]=useState(false);const [simplifyLevel,setSimplifyLevel]=useState(2);const [appearanceFloor,setAppearanceFloor]=useState(85);const [smartMode,setSmartMode]=useState<'light'|'balanced'|'aggressive'|'maximum'>('aggressive');const [simplifyRecommended,setSimplifyRecommended]=useState(0);const [simplifyReview,setSimplifyReview]=useState<{id:number;variants:{artwork_svg?:string|null;strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[]}|null>(null);const [simplifyScope,setSimplifyScope]=useState<'all'|'selection'>('all');const [simplifyDetail,setSimplifyDetail]=useState(false);const [solidMode,setSolidMode]=useState(false);const [mergeShapes,setMergeShapes]=useState(true);const [autoTypes,setAutoTypes]=useState(true);const [lighterUnderlay,setLighterUnderlay]=useState(false);const [targetMinutes,setTargetMinutes]=useState('');const [targetReduction,setTargetReduction]=useState(50);const [targetMetric,setTargetMetric]=useState<'both'|'time'|'stitches'>('both');const [simplifyBefore,setSimplifyBefore]=useState<Plan|null>(null);const [simplifyError,setSimplifyError]=useState('');const [textTarget,setTextTarget]=useState<number|null>(null);const [textSession,setTextSession]=useState(0);const baselineRequest=useRef(0);
const [baselinePicking,setBaselinePicking]=useState(false),[textBaseline,setTextBaseline]=useState<PickedBaseline|null>(null);
useEffect(()=>{if(inspectorTab!=='text')setBaselinePicking(false)},[inspectorTab]);
function openText(uid:number|null=null){++baselineRequest.current;setTextBaseline(null);setBaselinePicking(false);setTextTarget(uid);setTextSession(n=>n+1);showInspector(true);setInspectorTab('text')};
const [hoops]=useState(()=>profiles('studio-hoops',[{id:'100',name:'4 × 4 inch',width:100,height:100},{id:'130',name:'5 × 7 inch',width:130,height:180}])),[machines]=useState(()=>profiles('studio-machines',[])),[machine,setMachine]=useState(()=>initialView?.machine??(localStorage.getItem('studio-default-machine')||'')),[hoop,setHoop]=useState(()=>initialView?.hoop??(localStorage.getItem('studio-default-hoop')||''));const [plan,setPlan]=useState<Plan|null>(null),[format,setFormat]=useState(initialView?.format??'dst'),[width,setWidth]=useState(initialView?.width??130),[height,setHeight]=useState(initialView?.height??180),[playhead,setPlayhead]=useState<number|null>(null),[playbackSpeed,setPlaybackSpeed]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[artWidth,setArtWidth]=useState(80),[colors,setColors]=useState(0),[removeBackground,setRemoveBackground]=useState(true),[detail,setDetail]=useState(60),[playing,setPlaying]=useState(false),[scale,setScale]=useState(100),[rotation,setRotation]=useState(0),[dx,setDx]=useState(0),[dy,setDy]=useState(0),[hidden,setHidden]=useState<number[]>([]);
useEffect(()=>{
  onWorkspaceStatus?.({name:plan?.stitches?plan.name:null,busy,view:{width,height,format,machine,hoop,zoom,pan,threadAssignments}});
},[plan,busy,width,height,format,machine,hoop,zoom,pan,threadAssignments,tabId]);
const assistantContext = useRef({plan, width, height, machine, hoop, objects});
const assistantLastTarget=useRef<{plan:Plan;uids:number[]}|null>(null);
assistantContext.current = {plan, width, height, machine, hoop, objects};
async function audit(){try{const a=await invoke<{short:number;long:number;zero:number;segments:number}>('audit_stitches');setMessage('Stitch audit: '+a.segments+' segments · '+a.short+' short · '+a.long+' long · '+a.zero+' near-zero. Review before production.')}catch(e){setMessage(String(e))}}
const editLock=useRef(false);const [inlineWork,setInlineWork]=useState('');
async function edit(command:string,args:Record<string,unknown>){if(editLock.current||busy)return {plan:null,error:'The editor is busy. Try again when it finishes.'};editLock.current=true;setInlineWork(command==='maximize_in_hoop'?'Fitting design and regenerating stitches…':command==='resize_artwork_selection'?'Regenerating stitches at new size…':command==='edit_artwork_object'?'Updating object stitches…':command==='transform_design'?'Updating placement…':'Updating design…');setBusy(true);setPlaying(false);setMessage('');try{const next=await invoke<Plan>(command,args);if(command!=='recolor_block' && (next.blocks.length!==plan?.blocks.length||next.blocks.some((b,i)=>b.color.join(',')!==plan?.blocks[i]?.color.join(','))))setThreadAssignments({});setPlan(next);setPlayhead(null);return {plan:next,error:null}}catch(e){const error=String(e);setMessage(error);return {plan:null,error}}finally{editLock.current=false;setInlineWork('');setDesignOffset([0,0]);setObjectOffset([0,0]);setResizePreview(null);setGroupScalePreview([1,1]);setRotationPreview(0);setBusy(false)}}
const drawing=useCanvasDrawing((tool,points,subpaths,settings)=>{
  void edit('draw_canvas_shape',{tool,points,subpaths,...settings,field:[width,height]});
});
const stitchGuides=useStitchGuides(plan,selected&&!selected.locked&&!selected.hidden?selected.uid:null,
  (uid,action)=>void edit('edit_object_stitch_controls',{uid,action}));
const [hasSettingsClipboard,setHasSettingsClipboard]=useState(()=>sessionStorage.getItem('studio-stitch-clipboard')==='1');
const canCopyStitchSettings=!!selected&&!selected.locked&&!selected.hidden&&selected.kind!=='manual'&&selected.kind!=='skip';
const canPasteStitchSettings=hasSettingsClipboard&&movementIds.length>0&&
  movementIds.every(uid=>objects.some(o=>o.uid===uid&&o.kind!=='manual'&&o.kind!=='skip'));
async function copyStitchSettings(){
  if(!canCopyStitchSettings||!selected)return;
  try{
    await invoke('copy_object_stitch_settings',{uid:selected.uid});
    setHasSettingsClipboard(true);
    sessionStorage.setItem('studio-stitch-clipboard','1');
    toast('Stitch settings copied.');
  }catch(error){setMessage(String(error));}
}
function pasteStitchSettings(){
  if(canPasteStitchSettings)void edit('paste_object_stitch_settings',{uids:movementIds});
}
function selectSameStitchType(){
  if(!selected)return;
  const uids=objects.filter(o=>!o.hidden&&!o.locked&&o.kind===selected.kind).map(o=>o.uid);
  drawing.pick(null);setCanvasMode('select');setMulti(uids);setSelectedObject(null);setActiveGroup(null);setContext(null);showLayers(true);setLayerTab('objects');
}
function changeTextForm(){
  if(selected&&stitchGuides.data?.textForm)void edit('edit_object_stitch_controls',{
    uid:selected.uid,action:{type:stitchGuides.data.textForm==='text'?'outlines':'restoreText'},
  });
}
function reverseStitchPath(){
  if(selected&&stitchGuides.data?.reverses)void edit('edit_object_stitch_controls',{uid:selected.uid,action:{type:'reverse'}});
}
function drawingPoint(position: DOMPoint): [number,number] {
  if(drawing.tool!=='measure'&&!snap)return [position.x,position.y];
  const bounds=objects.flatMap(object=>!object.hidden&&object.bounds?[object.bounds]:[]);
  const nearest=(value:number,candidates:number[])=>{
    let result=value;
    let distance=1.1;
    for(const candidate of candidates){
      const delta=Math.abs(value-candidate);
      if(delta<distance){distance=delta;result=candidate;}
    }
    return distance===1.1?Math.round(value):result;
  };
  return [nearest(position.x,bounds.flatMap(([x,,w])=>[x,x+w/2,x+w])),
    nearest(position.y,bounds.flatMap(([,y,,h])=>[y,y+h/2,y+h]))];
}

useEffect(()=>{if(!plan?.stitches||busy)return;const save=()=>{invoke('recovery_save',{width,height,format,threadAssignments,expectedTab:tabId}).then(()=>setRecoveryStatus('Recovery copy saved')).catch(e=>setRecoveryStatus('Recovery save failed: '+String(e)))};const timer=setTimeout(save,1500);return()=>clearTimeout(timer)},[plan,width,height,format,busy,threadAssignments,tabId]);
async function recover(){if(plan&&!await confirmAction('Replace the current design with the recovery copy?'))return;setBusy(true);try{const p=await invoke<{plan:Plan;width:number;height:number;format:string;thread_assignments?:ThreadAssignments}|null>('recovery_open');if(p){setThreadAssignments(p.thread_assignments??{});setPlan(p.plan);setWidth(p.width);setHeight(p.height);setFormat(p.format);setMachine('');setHoop('');setHidden([]);setPlayhead(null);setMessage('Recovery copy opened. Save as a project to keep it.')}else setMessage('No recovery copy found.')}catch(e){setMessage(String(e))}finally{setBusy(false)}}
const [solidOnly,setSolidOnly]=useState(false);
const [solidIds,setSolidIds]=useState<number[]>([]);
const [solidColor,setSolidColor]=useState<number[]|null>(null);
function openSelectedSolid(ids=movementIds,color:number[]|null=null){
  if(!plan||busy||editLock.current||!ids.length)return;
  setSolidIds(ids);setSolidColor(color);
  setSolidOnly(true);setSimplifyScope('selection');setSimplifyBefore(plan);setSimplifyOpen(true);
  void simplify('selection',false,true,ids,color);
}
function openSimplify(){setSolidOnly(false);if(!plan||busy||editLock.current)return;const scope=movementIds.length&&movementIds.length<objects.length?'selection':'all';setSimplifyScope(scope);setSimplifyDetail(false);setSimplifyReview(null);setSimplifyBefore(plan);setSimplifyError('');setSimplifyOpen(true);void simplify(scope,true,false);}
const simplifyRequest = useRef<number|null>(null);
const [searchingSimplify,setSearchingSimplify] = useState(false);
const [simplifyLimited,setSimplifyLimited] = useState(false);
useEffect(()=>()=> {
  if(simplifyRequest.current!==null) {
    void invoke('cancel_simplification',{requestId:simplifyRequest.current}).catch(()=>{});
    simplifyRequest.current=null;
  }
},[]);
function cancelSimplify() {
  const requestId=simplifyRequest.current;
  if(requestId!==null) {
    simplifyRequest.current=null;
    void invoke('cancel_simplification',{requestId}).catch(()=>{});
    setSearchingSimplify(false);
    editLock.current=false;
    setBusy(false);
    setInlineWork('');
    if(simplifyReview)return;
  }else if(busy){return;}
  setSimplifyOpen(false);
}
useEffect(()=>{
  if(!simplifyOpen)return;
  function escape(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();cancelSimplify();}
  }
  window.addEventListener('keydown',escape);
  return ()=>window.removeEventListener('keydown',escape);
});
async function simplify(scope=simplifyScope,automatic=false,onlySolid=solidOnly,ids=solidIds,color=solidColor,extend=false,goalSearch=false,textureReduction=false){
  if(!plan||busy||editLock.current)return;
  const previous=extend?simplifyReview:null;
  const requestId=++nextSimplificationRequest;
  simplifyRequest.current=requestId;
  editLock.current=true;
  setSearchingSimplify(true);
  setBusy(true);
  setPlaying(false);
  setInlineWork('Generating stitch previews…');
  setSimplifyError('');
  setSimplifyLimited(false);
  if(!previous)setSimplifyReview(null);
  try{
    const review=await invoke<{id:number;limited?:boolean;variants:{artwork_svg?:string|null;strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[]}>('preview_simplification',{
      requestId,previousId:previous?.id??null,uids:scope==='selection'?(onlySolid?ids:movementIds):null,
      removeDetail:automatic||onlySolid?false:simplifyDetail,
      options:{quick:automatic,goalSearch,textureReduction,appearanceFloor,solidOnly:onlySolid,solidColor:onlySolid?color:null,solid:onlySolid||(!automatic&&solidMode),
        merge:automatic?true:mergeShapes,autoTypes:automatic?true:autoTypes,lighterUnderlay:automatic?false:lighterUnderlay,
        targetMinutes:Number(targetMinutes)>0?Number(targetMinutes):targetMetric==='stitches'?null:(plan.stitches/sewingSpm+plan.trims*trimSeconds/60+Math.max(0,plan.blocks.length-1)*changeSeconds/60)*(1-targetReduction/100),targetStitches:targetMetric==='time'?null:Math.floor(plan.stitches*(1-targetReduction/100)),speed:sewingSpm,trimSeconds}
    });
    if(simplifyRequest.current!==requestId)return;
    const variants=[...(previous?.variants.filter(old=>!review.variants.some(next=>next.strength===old.strength&&next.plan))??[]),
      ...review.variants.filter(next=>next.plan||!previous?.variants.some(old=>old.strength===next.strength))];
    variants.sort((a,b)=>a.strength-b.strength);
    setSimplifyReview({...review,variants});
    setSimplifyLimited(!!review.limited);
    const minutes=(p:Plan)=>p.stitches/sewingSpm+p.trims*trimSeconds/60+Math.max(0,p.blocks.length-1)*changeSeconds/60;
    const eligible=variants.filter(v=>v.plan&&v.strength!==4&&v.strength!==6&&(v.quality?.coverage??0)>=85&&minutes(v.plan)<minutes(plan));
    const goalTime=Number(targetMinutes)>0?Number(targetMinutes):minutes(plan)*(1-targetReduction/100);
    const goalStitches=Math.floor(plan.stitches*(1-targetReduction/100));
    const gap=(p:Plan)=> (targetMetric==='stitches'?0:Math.max(0,minutes(p)/Math.max(.01,goalTime)-1))+(targetMetric==='time'?0:Math.max(0,p.stitches/Math.max(1,goalStitches)-1));
    eligible.sort((a,b)=>gap(a.plan!)-gap(b.plan!)||minutes(a.plan!)-minutes(b.plan!));
    const best=onlySolid&&variants.some(v=>v.strength===4&&v.plan)?4:eligible[0]?.strength??0;
    setSimplifyRecommended(onlySolid?0:best);
    setSimplifyLevel(textureReduction&&variants.some(v=>v.strength===6&&v.plan)?6:best);
  }catch(e){
    if(simplifyRequest.current===requestId)setSimplifyError(String(e));
  }finally{
    if(simplifyRequest.current===requestId){
      simplifyRequest.current=null;
      editLock.current=false;
      setSearchingSimplify(false);
      setBusy(false);
      setInlineWork('');
    }
  }
}
async function applySimplify(){if(!simplifyReview||busy||editLock.current)return;editLock.current=true;setBusy(true);setInlineWork('Applying selected stitch plan…');try{const next=await invoke<Plan>('apply_simplification',{id:simplifyReview.id,strength:simplifyLevel});if(next.blocks.length!==plan?.blocks.length||next.blocks.some((block,i)=>block.color.join(',')!==plan?.blocks[i]?.color.join(',')))setThreadAssignments({});setPlan(next);setPlayhead(null);setSimplifyOpen(false);}catch(e){setSimplifyError(String(e));setSimplifyReview(null)}finally{editLock.current=false;setBusy(false);setInlineWork('')}}

function transform(s:number,r:number,x:number,y:number){return edit('transform_design',{scale:s,rotation:r,dx:x,dy:y})}
async function prepareAssistant(input: string): Promise<string | AssistantProposal> {
  const composing=compositionPrompt(input);
  const native = (
    title: string, detail: string, command: string, args: Record<string, unknown>,
    afterApply?: () => void,
  ): AssistantProposal => ({
    title,
    detail,
    async apply() {
      const current = assistantContext.current;
      const uids = Array.isArray(args.uids) ? args.uids : [];
      const stale = current.plan !== plan || current.width !== width || current.height !== height ||
        current.hoop !== hoop || current.machine !== machine || uids.some(uid =>
          !current.objects.some(object => object.uid === uid && !object.locked && !object.hidden));
      if (stale) return 'The design or sewing field changed while this request was open. Ask again to review the current design.';
      const result = await edit(command, args);
      if (!result.plan) return result.error;
      const affected=Array.isArray(args.uids)?args.uids.filter((uid):uid is number=>typeof uid==='number'):command==='compose_assistant_design'?(args.composition as {edits?:{uid:number}[]})?.edits?.map(e=>e.uid)??[]:[];
      assistantLastTarget.current=affected.length?{plan:result.plan,uids:[...new Set(affected)]}:null;
      afterApply?.();
      return title + ' applied. ' + result.plan.stitches.toLocaleString() + ' stitch points · ' +
        result.plan.trims + ' trims. Use Undo to reverse this edit.';
    },
  });

  // Multi-object requests use one native preview and one undo checkpoint.
  if (composing) {
    const request = parseComposition(input);
    if(typeof request==='string') return request;
    if (invalidField || incompatibleHoop || machineExceeded) return 'Choose a compatible hoop and sewing field first.';
    let lettering;
    if (request.text) {
      const fonts = await invoke<string[]>('lettering_fonts');
      const font = fonts?.find(name=>name==='Arial') ?? fonts?.[0];
      if (!font) return 'Install a lettering font to create this design.';
      const letters = Math.max(...request.text.split('\n').map(line=>Array.from(line).length),1);
      const size = Math.max(4, Math.min(14, (request.width ?? 90) * .63 / (letters * .72)));
      lettering = {text:request.text,font,size,spacing:.4,arc:0,bold:true,italic:false,color:request.textColor,align:'center'};
    }
    const accents = [];
    for (const [index, accent] of request.accents.entries()) {
      const artwork = await resolveMotif(accent.text!,accent.width!);
      if ('message' in artwork) return artwork.message;
      const position = accent.position==='center' && lettering ? index===0 ? 'above' : 'below' : accent.position;
      accents.push({name:artwork.name,svg:artwork.svg,color:artwork.color??null,width:accent.width,
        position,applique:!!accent.applique,field:[width,height],anchor:[0,0,0,0]});
    }
    const composition = {lettering,accents,frame:request.frame,width:request.width,field:[width,height]};
    const after = await invoke<Plan>('assistant_compose',{composition,apply:false});
    const before = plan ?? {name:'Blank design',stitches:0,trims:0,blocks:[]};
    const minutes = (candidate:Plan) => candidate.stitches / sewingSpm + candidate.trims * trimSeconds / 60;
    const elements = [request.text ? '“'+request.text+'”' : '', ...accents.map(accent=>accent.name),
      request.frame ? request.frame.style+' border' : ''].filter(Boolean);
    const detail = elements.join(' · ') + (request.width ? ' · '+Number(request.width.toFixed(2))+' mm wide' : '') +
      (before.stitches ? '. Inserts the new design in clear space within the current hoop.' : '. Centers the design in the current hoop.');
    return {...native('Create embroidery design',detail,'assistant_compose',{composition,apply:true}),
      comparison:{before,after,beforeMinutes:minutes(before),afterMinutes:minutes(after)}};
  }


  // Contextual commands are resolved against the live selection, not a stale chat transcript.
  const follow=input.trim().match(/^(?:make (?:that|it|the selection) (?:a little )?(smaller|larger|bigger)|(?:try|use|make it) (?:another color|a different color))$/i);
  if(follow){
    const remembered=assistantLastTarget.current;
    const targets=movementIds.length?movementIds:remembered?.plan===plan?remembered.uids.filter(uid=>objects.some(o=>o.uid===uid&&!o.locked&&!o.hidden)):[];
    if(!targets.length)return 'Select the artwork you want to refine first.';
    if(!movementIds.length&&follow[1]){
      const scale=follow[1].toLowerCase()==='smaller'?.9:1.1;
      return {title:'Refine last edited artwork',detail:'Resize the last edited objects to '+Math.round(scale*100)+'%.',async apply(){
        if(assistantContext.current.plan!==plan)return 'The design changed. Select the artwork again.';
        const result=await edit('transform_artwork_group',{uids:targets,scale,rotation:0});
        if(result.plan)assistantLastTarget.current={plan:result.plan,uids:targets};
        return result.plan?'Artwork resized.':result.error;
      }};
    }
    if(!follow[1])return 'Which thread color would you like to try on the selection?';
    input='Scale selected objects to '+(follow[1].toLowerCase()==='smaller'?'90':'110')+'%';
  }
  if(/^(?:describe|identify|inspect) (?:the |my )?(?:design|selection)$/i.test(input.trim())){
    const items=objects.filter(o=>!o.hidden&&(!movementIds.length||movementIds.includes(o.uid)));
    const descriptions=await Promise.all(items.slice(0,24).map(async o=>{
      const t=await invoke<{text:string}|null>('lettering_settings',{uid:o.uid});
      return (t?'Lettering: '+t.text:o.label)+' · '+o.kind+(o.locked?' · locked':'');
    }));
    return ['Hoop: '+width+' × '+height+' mm', 'Fabric: '+fabric, 'Selected objects: '+movementIds.length,...descriptions, ...(items.length>24?['Additional objects are listed in Layers.']:[])].join('\n');
  }
  // Explicit compound edits are parsed independently, then previewed as a single transaction.
  const clauses=input.trim().split(/\s*;\s*|\s+and then\s+/i);
  if(clauses.length>1){
    if(clauses.length>8)return 'Use up to eight edits in one request.';
    if(invalidField||incompatibleHoop||machineExceeded)return 'Choose a compatible hoop first.';
    const edits:Record<string,unknown>[]=[];
    const motifs:Record<string,unknown>[]=[];
    const lettering:Record<string,unknown>[]=[];
    let optimize=false;
    for(const clause of clauses){
      const action=assistantIntent(clause);
      if(action?.kind==='moveSelected'&&movementIds.length){
        for(const uid of movementIds)edits.push({type:'move',uid,delta:[action.dx??0,action.dy??0]});
      }else if(action?.kind==='recolor'&&action.previous&&action.color){
        const targets=objects.filter(o=>!o.hidden&&!o.locked&&o.color.join(',')===action.previous?.join(','));
        if(!targets.length)return 'No matching editable color for: '+clause;
        for(const o of targets)edits.push({type:'recolor',uid:o.uid,color:action.color});
      }else if(action?.kind==='optimize'){
        optimize=true;
      }else if(action?.kind==='lettering'&&action.text){
        const fonts=await invoke<string[]>('lettering_fonts');
        const font=fonts.find(n=>n==='Arial')??fonts[0];
        if(!font)return 'Install a lettering font first.';
        lettering.push({settings:{text:action.text,font,size:action.size??15,spacing:.4,arc:0,bold:true,italic:false,color:[105,69,162],align:'center'},center:[0,0]});
      }else if(action?.kind==='motif'&&action.text&&action.width&&action.position){
        const artwork=await resolveMotif(action.text,action.width);
        if('message' in artwork)return artwork.message;
        const bounds=designBounds;
        if(action.position!=='center'&&!bounds&&!lettering.length)return 'For a blank design, place the motif at the hoop center first.';
        motifs.push({name:artwork.name,svg:artwork.svg,color:artwork.color??null,width:action.width,position:action.position,applique:!!action.applique,anchor:bounds?[bounds.left,bounds.top,bounds.width,bounds.height]:[0,0,0,0],field:[width,height]});
      }else{return 'This combined request contains an unsupported edit: '+clause+'. Try it separately.';}
    }
    if(edits.length+motifs.length+lettering.length>24)return 'Select fewer objects for this combined edit.';
    const composition={name:'Combined assistant edits',field:[width,height],motifs,lettering,edits,optimize};
    const after=await invoke<Plan>('compose_assistant_design',{composition,apply:false});
    const before=plan??{name:'Blank design',stitches:0,trims:0,blocks:[]};
    const minutes=(p:Plan)=>p.stitches/sewingSpm+p.trims*trimSeconds/60+Math.max(0,p.blocks.length-1)*changeSeconds/60;
    return {title:'Combined design edits',detail:clauses.join(' · '),comparison:{before,after,beforeMinutes:minutes(before),afterMinutes:minutes(after)},async apply(){
      const current=assistantContext.current;
      if(current.plan!==plan||current.width!==width||current.height!==height||current.machine!==machine||current.hoop!==hoop)return 'The design changed. Preview the request again.';
      const result=await edit('compose_assistant_design',{composition,apply:true});
      if(result.plan&&edits.length)assistantLastTarget.current={plan:result.plan,uids:[...new Set(edits.map(e=>e.uid).filter((uid):uid is number=>typeof uid==='number'))]};
      return result.plan?'Combined edits applied. Undo reverses all changes.':result.error;
    }};
  }
  const wantsAlternatives=/^(?:show|create|generate|give me) (?:three |some |different )?(?:layout |design )?(?:options|alternatives) (?:for|to) /i.test(input);
  if(wantsAlternatives)input=input.replace(/^(?:show|create|generate|give me) (?:three |some |different )?(?:layout |design )?(?:options|alternatives) (?:for|to) /i,'');
  const intent = assistantIntent(input);
  const textChange=input.trim().match(/^(?:change|replace|rename)\s+(?:the\s+)?(?:selected\s+)?(?:lettering|text|name)\s+to\s+["“]?(.+?)["”]?$/i);
  if (textChange) {
    const candidates=objects.filter(o=>!o.locked&&!o.hidden&&(!movementIds.length||movementIds.includes(o.uid)));
    const matches=await Promise.all(candidates.map(async o=>({uid:o.uid,settings:await invoke<Record<string,unknown>|null>('lettering_settings',{uid:o.uid})})));
    const texts=matches.filter(o=>o.settings!==null);
    if(texts.length!==1)return 'Select exactly one editable lettering object to change its text.';
    if(invalidField||incompatibleHoop||machineExceeded)return 'Choose a compatible hoop first.';
    const target=texts[0];
    const composition={name:'Edit lettering',field:[width,height],motifs:[],lettering:[],edits:[{type:'lettering',uid:target.uid,settings:{...target.settings,text:textChange[1]}}]};
    const after=await invoke<Plan>('compose_assistant_design',{composition,apply:false});
    const before=plan ?? {name:'Blank design',stitches:0,trims:0,blocks:[]};
    const minutes=(p:Plan)=>p.stitches/sewingSpm+p.trims*trimSeconds/60+Math.max(0,p.blocks.length-1)*changeSeconds/60;
    return {title:'Update existing lettering',detail:'Replace text with “'+textChange[1]+'” while keeping its lettering settings.',
      comparison:{before,after,beforeMinutes:minutes(before),afterMinutes:minutes(after)},
      async apply(){
        const current=assistantContext.current;
        if(current.plan!==plan||current.width!==width||current.height!==height||current.hoop!==hoop||current.machine!==machine||!current.objects.some(o=>o.uid===target.uid&&!o.locked&&!o.hidden))return 'The design changed. Ask again to preview the current lettering.';
        const result=await edit('compose_assistant_design',{composition,apply:true});
        return result.plan?'Lettering updated. Use Undo to reverse this edit.':result.error;
      }};
  }

  if (!intent) {
    return 'I couldn’t match that request to an editor action. Try a quick action, or describe one edit with a measurement or color.';
  }

  if (intent.kind === 'help') {
    const tips = [
      ['underlay', 'Underlay supports the top stitches and stabilizes the fabric. Choose it by fabric and stitch type.'],
      ['density', 'Density is the spacing between rows. Smaller spacing increases needle penetrations. Start with the fabric preset and test sew.'],
      ['pull compensation', 'Pull compensation extends stitch edges to offset fabric contraction. Adjust in small increments after a test sew.'],
      ['satin stitches', 'Satin stitches cross a narrow column. Wider areas may need split satin or fill.'],
      ['stabilizer', 'Match backing to the garment. Stretchy knits typically need cutaway. Test your fabric and design together.'],
      ['thread trims', 'Trims cut the thread between regions. Covered travel and color order can reduce trims.'],
    ];
    return tips.find(([key]) => input.toLowerCase().includes(key))?.[1] ?? 'Choose a topic such as underlay or density.';
  }
  if (intent.kind === 'clearSelection') {
    setMulti([]); setSelectedObject(null); setActiveGroup(null); setContext(null);
    return 'Selection cleared.';
  }
  if (intent.kind === 'selectColor' || intent.kind === 'selectLabel' || intent.kind === 'selectKind') {
    const matches = objects.filter(object => {
      if (object.locked || object.hidden) return false;
      if (intent.kind === 'selectColor') return object.color.join(',') === intent.color?.join(',');
      if (intent.kind === 'selectLabel') return object.label.toLowerCase().includes(intent.text?.toLowerCase() ?? '');
      return object.kind.toLowerCase() === intent.text;
    });
    if (!matches.length) return 'No editable objects matched. Check the names, colors and stitch types in Layers.';
    setCanvasMode('select'); setMulti(matches.map(object => object.uid)); setSelectedObject(null);
    setActiveGroup(null); setContext(null); showLayers(true); setLayerTab('objects');
    return 'Selected ' + matches.length + (matches.length === 1 ? ' matching object.' : ' matching objects.');
  }

  const compositionProposal = async (composition: Record<string,unknown>, title:string, detail:string): Promise<AssistantProposal> => {
    const after=await invoke<Plan>('compose_assistant_design',{composition,apply:false});
    const before=plan ?? {name:'Blank design',stitches:0,trims:0,blocks:[]};
    const minutes=(p:Plan)=>p.stitches/sewingSpm+p.trims*trimSeconds/60+Math.max(0,p.blocks.length-1)*changeSeconds/60;
    return {...native(title,detail,'compose_assistant_design',{composition,apply:true}),
      comparison:{before,after,beforeMinutes:minutes(before),afterMinutes:minutes(after)}};
  };
  if (intent.kind === 'recolor' && intent.previous && intent.color) {
    const targets=objects.filter(o=>!o.locked&&!o.hidden&&o.color.join(',')===intent.previous?.join(','));
    if(targets.length && !invalidField && !incompatibleHoop && !machineExceeded) {
      return compositionProposal({name:'Recolor artwork',field:[width,height],motifs:[],lettering:[],
        edits:targets.map(o=>({type:'recolor',uid:o.uid,color:intent.color}))},
        'Recolor editable artwork','Preview thread changes on '+targets.length+' unlocked matching objects.');
    }
  }
  if (intent.kind === 'moveSelected' && movementIds.length && !invalidField && !incompatibleHoop && !machineExceeded) {
    return compositionProposal({name:'Move selection',field:[width,height],motifs:[],lettering:[],
      edits:movementIds.map(uid=>({type:'move',uid,delta:[intent.dx??0,intent.dy??0]}))},
      'Move selection','Preview the new placement of '+movementIds.length+' selected objects.');
  }
  if (intent.kind === 'motif' && intent.text && intent.position && intent.width) {
    const position = intent.position;
    const anchorObjects = movementIds.length && intent.relative !== 'hoop' && intent.relative !== 'design' ? objects.filter(object=>movementIds.includes(object.uid)) : [];
    const lettering = objects.filter(object=>!object.hidden && object.groups?.some(group=>group.startsWith('tl-lettering-')));
    if (intent.relative === 'selection' && !movementBounds) return 'Select the objects to place this motif around.';
    if (intent.relative === 'lettering' && !anchorObjects.length) {
      const sets = new Set(lettering.flatMap(object=>object.groups?.filter(group=>group.startsWith('tl-lettering-')) ?? []));
      if (sets.size !== 1) return 'Select the lettering you want to decorate on the canvas first.';
      anchorObjects.push(...lettering);
    }
    const visibleBounds = anchorObjects.flatMap(object=>object.bounds ? [object.bounds] : []);
    const bounds = designBounds;
    const anchor: [number,number,number,number] = visibleBounds.length ? [
      Math.min(...visibleBounds.map(b=>b[0])), Math.min(...visibleBounds.map(b=>b[1])), 0, 0,
    ] : bounds && (position !== 'center' || intent.relative === 'design') ? [bounds.left,bounds.top,bounds.width,bounds.height] : [0,0,0,0];
    if (visibleBounds.length) {
      anchor[2] = Math.max(...visibleBounds.map(b=>b[0]+b[2])) - anchor[0];
      anchor[3] = Math.max(...visibleBounds.map(b=>b[1]+b[3])) - anchor[1];
    }
    if (position !== 'center' && !visibleBounds.length && !bounds) return 'Add a design or lettering first, or ask for the motif at the hoop center.';
    if (invalidField || incompatibleHoop || machineExceeded) return 'Choose a compatible hoop and sewing field before inserting artwork.';
    const artwork = await resolveMotif(intent.text, intent.width);
    if ('message' in artwork) return artwork.message;
    const paired = position === 'sides' || position === 'topCorners' || position === 'bottomCorners';
    const places = {
      center:visibleBounds.length ? 'center of the selected artwork' : intent.relative === 'design' && bounds ? 'design center' : 'hoop center',
      above:'above', below:'below', left:'left', right:'right',
      topLeft:'top left', topRight:'top right', bottomLeft:'bottom left', bottomRight:'bottom right',
      sides:'both sides', topCorners:'both top corners', bottomCorners:'both bottom corners',
    };
    const motif = {name:artwork.name,svg:artwork.svg,color:artwork.color ?? null,
      width:intent.width,position,applique:!!intent.applique,anchor,field:[width,height]};
    const count = paired ? '2 copies' : '1 copy';
    const detail = artwork.name+' · '+count+' · '+intent.width.toLocaleString(undefined,{maximumFractionDigits:2})+
      ' mm wide each · '+places[position]+'. '+(motif.applique ?
      'Includes fabric placement, tack-down and finishing stitches. Check pauses on your machine.' :
      'Adds editable artwork to the current design.');
    const title = motif.applique ? 'Add appliqué motif' : 'Add design motif';
    const primary=await compositionProposal({name:artwork.name,field:[width,height],motifs:[motif],lettering:[],edits:[]},title,detail);
    if(wantsAlternatives){
      const alternatives:AssistantProposal[]=[];
      for(const candidate of [{...motif,width:Math.max(motif.applique?20:5,motif.width*.8)},{...motif,position:position==='above'?'below':position==='below'?'above':position==='left'?'right':position==='right'?'left':position==='center'?'above':'sides'}]){
        try{alternatives.push(await compositionProposal({name:artwork.name,field:[width,height],motifs:[candidate],lettering:[],edits:[]},candidate.width!==motif.width?'Compact decoration':'Alternate placement',artwork.name+' · '+candidate.width.toFixed(1)+' mm · '+candidate.position));}catch{}
      }
      return {...primary,alternatives};
    }
    return primary;
  }

  if (intent.kind === 'lettering') {
    const fonts = await invoke<string[]>('lettering_fonts');
    const font = fonts?.find(name => name === 'Arial') ?? fonts?.[0];
    if (!font) return 'No installed lettering font found. Import or install a font first.';
    return native('Add lettering', '“' + intent.text + '” · ' + intent.size + ' mm · ' + font +
      '. Adds a new object at the hoop center.', 'insert_lettering_settings', {settings:{
      text:intent.text, font, size:intent.size, spacing:.4, arc:0, bold:true, italic:false, color:[105,69,162], align:'center',
    }});
  }

  if (intent.kind === 'undo' || intent.kind === 'redo') {
    const redo = intent.kind === 'redo';
    const last = historyLabels[redo ? 1 : 0].at(-1);
    if (!last) return redo ? 'There is no edit to redo.' : 'There is no edit to undo.';
    return native(redo ? 'Redo edit' : 'Undo edit', last, 'history_step', {redo});
  }

  if (!plan?.stitches) return 'Open or insert a design to use this action.';
  const measurement = (value: number) => value.toLocaleString(undefined, {maximumFractionDigits: 2});
  const percentage = (value: number) => measurement(value * 100) + '%';
  const rotationLabel = (degrees: number) => measurement(Math.abs(degrees)) + '° ' + (degrees < 0 ? 'counterclockwise' : 'clockwise');

  if (intent.kind === 'moveSelected' || intent.kind === 'scaleSelected' || intent.kind === 'rotateSelected') {
    const uids = movementIds;
    if (!uids.length) return 'Select unlocked, visible objects or a design group first.';
    const target = uids.length === 1 ? objects.find(object => object.uid === uids[0])?.label || 'Selected object' : uids.length + ' selected objects';
    if (intent.kind === 'moveSelected') {
      const dx = intent.dx ?? 0, dy = intent.dy ?? 0;
      const distance = (dx ? measurement(Math.abs(dx)) + ' mm ' + (dx < 0 ? 'left' : 'right') :
        measurement(Math.abs(dy)) + ' mm ' + (dy < 0 ? 'up' : 'down'));
      return native('Move selection', target + ' · ' + distance + '.', 'move_artwork_objects', {uids, dx, dy});
    }
    const scaling = intent.kind === 'scaleSelected';
    const value = intent.value!;
    return native(scaling ? 'Resize selection' : 'Rotate selection',
      target + ' · ' + (scaling ? percentage(value) + ' of current size' : rotationLabel(value)) + '.',
      'transform_artwork_group', {uids, scale:scaling ? value : 1, rotation:scaling ? 0 : value});
  }

  if (intent.kind === 'audit' || intent.kind === 'review') {
    const audit = await invoke<{short:number;long:number;zero:number;segments:number}>('audit_stitches');
    const notes = [plan.stitches.toLocaleString() + ' stitch points · ' + plan.blocks.length + ' color blocks · ' + plan.trims + ' trims.',
      audit.short + ' short · ' + audit.long + ' over 12 mm · ' + audit.zero + ' near-zero movements.'];
    if (outside || machineExceeded || incompatibleHoop || invalidField) notes.push('Check the hoop and machine fit before export.');
    if (audit.long > 0) notes.push('Inspect the long stitches and satin split settings.');
    if (audit.short > 30 && audit.short / Math.max(1, audit.segments) > .1) notes.push('Inspect tight corners and dense areas.');
    if (audit.zero > 0) notes.push('Some near-zero movements may be intentional ties.');
    if (plan.trims / Math.max(1, plan.stitches) * 1000 > 8) notes.push('Inspect isolated areas and thread sequencing for frequent trims.');
    notes.push('Test sew before production.');
    return notes.join('\n');
  }

  if (intent.kind === 'recommendHoop') {
    if (!designBounds) return 'No stitch bounds available.';
    const {width: designWidth, height: designHeight} = designBounds;
    const best = compatibleHoops.filter(profile => profile.width >= designWidth + 4 && profile.height >= designHeight + 4)
      .sort((a,b) => a.width * a.height - b.width * b.height)[0];
    return best ? 'Recommended saved hoop: ' + best.name + ' (' + best.width + ' × ' + best.height + ' mm). Center the design before sewing.'
      : 'No saved compatible hoop has 2 mm of margin per side. Choose a larger compatible hoop or reduce the design.';
  }

  const transformProposal = (title: string, detail: string, scale: number, rotation: number) =>
    native(title, detail, 'transform_design', {scale, rotation, dx:0, dy:0});
  switch (intent.kind) {
    case 'optimize':
    case 'fabric': {
      if (!objects.some(object => object.kind !== 'manual' && object.kind !== 'skip' && !object.hidden)) {
        return 'This action needs editable artwork. Imported needle points can be adjusted individually or resized.';
      }
      if (intent.kind === 'optimize') return native('Optimize stitch density',
        'Checks for a conservative improvement across the entire design and keeps the current plan if the checks fail.',
        'optimize_editable_design', {});
      const display = intent.fabric === 'standard' ? 'stable woven' : intent.fabric?.replace(/-/g,' ');
      return native('Apply fabric profile', 'Use the ' + display + ' preset to regenerate stitches for the entire design.',
        'apply_fabric_profile', {fabric:intent.fabric});
    }
    case 'targetTime':
    case 'reduceTrims':
    case 'simplify': {
      const namedObjects = intent.kind === 'simplify' && intent.text ?
        objects.filter(object => !object.locked && !object.hidden && matchesName(object.label, intent.text!)) : null;
      const ids = namedObjects?.map(object => object.uid) ?? (intent.selected ? movementIds : null);
      if (ids && !ids.length) return namedObjects ? 'No visible, unlocked layers matched “' + intent.text + '.” Check the Layers panel.'
        : 'Select the objects to simplify first.';
      const minutes = intent.kind === 'targetTime' ? intent.value ?? 0 : 0;
      const estimate = (candidate: Plan) => candidate.stitches / sewingSpm + candidate.trims * trimSeconds / 60 +
        Math.max(0, candidate.blocks.length - 1) * changeSeconds / 60;
      const beforeMinutes = estimate(plan);
      if (minutes > 0 && beforeMinutes <= minutes) {
        return 'The current estimated sewing time is ' + beforeMinutes.toFixed(1) + ' min, within your ' + minutes + '-minute target.';
      }
      const solid = intent.kind === 'simplify' && intent.value === 4;
      const fewerTrims = intent.kind === 'reduceTrims';
      const review = await invoke<{
        id: number;
        variants: {strength: number; plan: Plan | null; reason: string | null; quality?: {coverage: number} | null}[];
      }>('preview_simplification', {uids:ids, removeDetail:solid,
        options:{solid, solidOnly:solid, merge:true, autoTypes:true, lighterUnderlay:false, targetMinutes:minutes || null, speed:sewingSpm, trimSeconds}});
      const eligible = review.variants.flatMap(variant => {
        if (!variant.plan) return [];
        if (solid) return variant.strength === 4 ? [{...variant, plan:variant.plan}] : [];
        if (variant.strength === 4 || (variant.quality?.coverage ?? 0) < 85) return [];
        if (fewerTrims ? variant.plan.trims >= plan.trims : estimate(variant.plan) >= beforeMinutes) return [];
        return [{...variant, plan:variant.plan}];
      }).sort((a,b) => (fewerTrims ? a.plan.trims - b.plan.trims : 0) || estimate(a.plan) - estimate(b.plan));
      const best = eligible[0];
      if (!best) return solid ? 'A solid silhouette could not be generated for this artwork.'
        : fewerTrims ? 'No stitch plan with fewer trims passed the coverage checks.' : 'No faster stitch plan passed the coverage checks.';
      const afterMinutes = estimate(best.plan);
      const variantName = ['Current','Gentle','Balanced','Maximum','Solid silhouette','Fast Stitch','Aggressive texture reduction'][best.strength];
      const timeNote = minutes > 0 ? (afterMinutes <= minutes ? ' Meets the ' + minutes + '-minute estimate.'
        : ' The best eligible plan is still above your ' + minutes + '-minute target.') : '';
      const scope = namedObjects ? namedObjects.length + ' matching ' + (namedObjects.length === 1 ? 'layer' : 'layers') + ' (“' + intent.text + '”)'
        : ids ? ids.length + (ids.length === 1 ? ' selected object' : ' selected objects') : 'the entire design';
      return {
        ...native(variantName + ' stitch plan', 'Stitch preview for ' + scope + '.' + timeNote,
          'apply_simplification', {id:review.id, strength:best.strength}),
        comparison:{before:plan, after:best.plan, beforeMinutes, afterMinutes},
      };
    }
    case 'recolor': {
      const count = plan.blocks.filter(block => block.color.join(',') === intent.previous?.join(',')).length;
      if (!count) return 'That source color isn’t in this design. Open the Threads inspector to find the exact hex color.';
      const hex = (color: number[] | undefined) => '#' + color?.map(channel => channel.toString(16).padStart(2,'0')).join('').toUpperCase();
      return native('Replace thread color', hex(intent.previous) + ' → ' + hex(intent.color) + ' across ' +
        count + (count === 1 ? ' sewing block.' : ' sewing blocks.'), 'replace_design_color', {previous:intent.previous, color:intent.color});
    }
    case 'center':
      return native('Center design', 'Move the entire design to the center of the current hoop.', 'center_design', {});
    case 'fit':
    case 'fitDimensions': {
      const changeField = intent.kind === 'fitDimensions';
      const w = changeField ? intent.width! : width, h = changeField ? intent.height! : height;
      if (changeField && selectedMachine && (w > selectedMachine.width || h > selectedMachine.height)) {
        return 'That size exceeds the selected machine’s sewing field.';
      }
      if (!changeField && (invalidField || machineExceeded || incompatibleHoop)) {
        return 'Choose a compatible machine and hoop before fitting the design.';
      }
      const saved = changeField ? compatibleHoops.find(profile => Math.abs(profile.width - w) < .02 && Math.abs(profile.height - h) < .02) : undefined;
      const field = measurement(w) + ' × ' + measurement(h) + ' mm';
      const detail = (changeField ? (saved ? 'Select ' + saved.name + ' with a ' + field + ' usable sewing field. ' : 'Set the custom usable sewing field to ' + field + '. ') : 'Use the current ' + field + ' usable sewing field. ') +
        'Resize and center the design with a 2 mm margin per side.' + (changeField ? ' The sewing field can be edited in Hoop settings.' : '');
      return native('Fit design to hoop', detail, 'maximize_in_hoop', {widthMm:w,heightMm:h,marginMm:2,stretch:false},
        changeField ? () => {setWidth(w);setHeight(h);setHoop(saved?.id ?? '');} : undefined);
    }
    case 'rotate':
      return transformProposal('Rotate design', 'Rotate the entire design ' + rotationLabel(intent.value!) + '.', 1, intent.value!);
    case 'scale':
      return transformProposal('Resize design', 'Scale the entire design to ' + percentage(intent.value!) + ' of its current size.', intent.value!, 0);
    case 'flipH':
    case 'flipV': {
      const horizontal = intent.kind === 'flipH';
      return native('Mirror design', 'Flip the entire design ' + (horizontal ? 'left to right.' : 'top to bottom.'),
        'mirror_design', {horizontal});
    }
    default: return 'This action is unavailable.';
  }
}

function fit(stretch=false){
  if(!plan||busy||invalidField||machineExceeded||incompatibleHoop)return;
  void edit('maximize_in_hoop',{widthMm:width,heightMm:height,marginMm:2,stretch}).then(({plan:next})=>{
    if(next){setZoom(100);setPan([0,0]);}
  });
}
useEffect(()=>{if(!initialView){const m=machines.find(p=>p.id===machine);const h=hoops.find(p=>p.id===hoop);if(!m)setMachine('');if(h&&hoopFits(h,m)){setWidth(h.width);setHeight(h.height)}else{setHoop('');if(m){setWidth(m.width);setHeight(m.height)}}if(m?.format)setFormat(m.format.toLowerCase());}try{const target=sessionStorage.getItem('studio-digitizer-output-format');if(target){if(['dst','pes','pec','jef','exp','vp3'].includes(target))setFormat(target);sessionStorage.removeItem('studio-digitizer-output-format')}const raw=sessionStorage.getItem('studio-open-project-settings');if(raw){const p=JSON.parse(raw);setWidth(p.width);setHeight(p.height);setFormat(p.format);setThreadAssignments(p.thread_assignments??{});sessionStorage.removeItem('studio-open-project-settings')}}catch{}let active=true;invoke<Plan|null>('current_preview').then(p=>{if(active&&p)setPlan(p)}).catch(()=>{});return ()=>{active=false}},[]);
useEffect(()=>{let active=true;invoke<EditableObject[]>('editable_objects').then(items=>{if(active){setObjects(items);setSelectedObject(old=>items.some(o=>o.uid===old&&!o.locked&&!o.hidden)?old:null)}}).catch(()=>{if(active){setObjects([]);if(plan)setLayerTab('threads')}});return()=>{active=false}},[plan]);
useEffect(()=>{
  let active=true;
  if(plan)void invoke<string|null>('current_fabric').then(value=>{if(active&&value)setFabric(value);}).catch(()=>{});
  return ()=>{active=false;};
},[plan]);
const threadPage=usePagedList(plan?.blocks??[],'layer-threads',6);
const resizeHandles:ResizeHandle[]=selected?.bounds
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
const [historyLabels,setHistoryLabels]=useState<[string[],string[]]>([[],[]]);
useEffect(()=>{if(busy)return;let active=true;invoke<[string[],string[]]>('history_labels').then(h=>{if(active&&Array.isArray(h)&&h.length===2)setHistoryLabels(h)}).catch(()=>{if(active)setHistoryLabels([[],[]])});return()=>{active=false}},[plan,busy]);

const [sewingSpmDraft,setSewingSpmDraft]=useState<string|null>(null);const [sewingSpm,setSewingSpm]=useState(()=>{const n=Number(localStorage.getItem('studio-sewing-spm')||800);return Number.isFinite(n)&&n>=100&&n<=1500?n:800});
const [trimSeconds,setTrimSeconds]=useState(()=>{const n=Number(localStorage.getItem('studio-trim-seconds')||3);return Number.isFinite(n)&&n>=0&&n<=30?n:3});
const [changeSeconds,setChangeSeconds]=useState(()=>{const n=Number(localStorage.getItem('studio-change-seconds')||8);return Number.isFinite(n)&&n>=0&&n<=120?n:8});
useEffect(()=>{localStorage.setItem('studio-sewing-spm',String(sewingSpm));localStorage.setItem('studio-trim-seconds',String(trimSeconds));localStorage.setItem('studio-change-seconds',String(changeSeconds))},[sewingSpm,trimSeconds,changeSeconds]);
const uniqueColors=useMemo(()=>new Set((plan?.blocks??[]).map(b=>b.color.join(','))).size,[plan]);
const sewingEstimate=useMemo(()=>plan?Math.ceil(plan.stitches/sewingSpm*60+plan.trims*trimSeconds+Math.max(0,plan.blocks.length-1)*changeSeconds):0,[plan,sewingSpm,trimSeconds,changeSeconds]);
const sewingMinutes=Math.max(plan?.stitches?1:0,Math.round(sewingEstimate/60));const sewingDuration=sewingMinutes>=60?Math.floor(sewingMinutes/60)+'h '+(sewingMinutes%60)+'m':sewingMinutes+' min';

const designBounds=useMemo(()=>{
  if(!points.length)return null;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {left,top,width:right-left,height:bottom-top};
},[points]);
const canvasSurface=useRef<HTMLDivElement>(null);
const [canvasRatio,setCanvasRatio]=useState(0);
useEffect(()=>{
  const canvas=canvasSurface.current;
  if(!canvas)return;
  const observer=new ResizeObserver(([entry])=>{
    const {width,height}=entry.contentRect;
    if(width>0&&height>0)setCanvasRatio(width/height);
  });
  observer.observe(canvas);
  return()=>observer.disconnect();
},[]);

// Use the actual canvas aspect ratio so wide workspaces can frame wide designs.
const hoopViewWidth=Number.isFinite(width)&&width>0?width*1.06:1;
const hoopViewHeight=Number.isFinite(height)&&height>0?height*1.06:1;
const ratio=canvasRatio||hoopViewWidth/hoopViewHeight;
const viewWidth=Math.max(hoopViewWidth,hoopViewHeight*ratio);
const viewHeight=viewWidth/ratio;
const screenWidth=viewWidth*100/zoom;
const screenHeight=viewHeight*100/zoom;
function artworkZoom(w:number,h:number) {
  return Math.max(25,Math.min(400,Math.min(viewWidth/Math.max(1,w),viewHeight/Math.max(1,h))*82));
}
const framedFirstDesign=useRef(!!initialView);
useEffect(()=>{
  if(framedFirstDesign.current||!designBounds||!canvasRatio||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
  framedFirstDesign.current=true;
  const {left,top,width:artWidth,height:artHeight}=designBounds;
  setZoom(Math.min(350,artworkZoom(artWidth,artHeight)));
  setPan([left+artWidth/2,top+artHeight/2]);
},[designBounds,canvasRatio,viewWidth,viewHeight,width,height]);
const sizePreview=useMemo(()=>{
 const b=movementBounds;
 if(b&&resizePreview)return {w:b[2]*resizePreview.sx,h:b[3]*resizePreview.sy,active:true};
 if(b&&groupScalePreview.some(v=>v!==1))return {w:b[2]*groupScalePreview[0],h:b[3]*groupScalePreview[1],active:true};
 return designBounds?{w:designBounds.width,h:designBounds.height,active:false}:null;
},[movementBounds,resizePreview,groupScalePreview,designBounds]);
const selectedMachine=machines.find(m=>m.id===machine);const machineExceeded=!!selectedMachine&&(width>selectedMachine.width+.001||height>selectedMachine.height+.001);const incompatibleHoop=!!selectedMachine&&!!hoop&&!hoops.some(h=>h.id===hoop&&hoopFits(h,selectedMachine));const invalidField=!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0;const compatibleHoops=hoops.filter(h=>hoopFits(h,selectedMachine));const outside=!!designBounds&&(designBounds.left < -width/2||designBounds.left+designBounds.width>width/2||designBounds.top < -height/2||designBounds.top+designBounds.height>height/2);
const stitchIndex=Math.min(points.length,playhead??points.length);
const directionSamples=useMemo(()=>{
 if(!showDirections||!plan)return [];
 const stride=Math.max(1,Math.ceil(plan.stitches/350));let index=0;
 const marks:{x:number;y:number;angle:number;index:number;block:number}[]=[];
 plan.blocks.forEach((b,block)=>b.runs.forEach(run=>{for(let j=0;j<run.length;j++,index++){if(j===0||index%stride!==0)continue;const p=run[j-1],q=run[j];if(Math.hypot(q[0]-p[0],q[1]-p[1])<.3)continue;marks.push({x:(p[0]+q[0])/2,y:(p[1]+q[1])/2,angle:Math.atan2(q[1]-p[1],q[0]-p[0])*180/Math.PI,index,block})}}));return marks;
},[plan,showDirections]);

const fullRenderedRuns=useMemo(()=>(plan?.blocks??[]).map(block=>block.runs.map(run=>run.length>1?run.map(p=>p.join(',')).join(' '):'')),[plan]);
const renderedRuns=useMemo(()=>{
  if(stitchIndex>=points.length)return fullRenderedRuns;
  let remaining=stitchIndex;
  return (plan?.blocks??[]).map((block,i)=>block.runs.map((run,j)=>{
    const count=Math.max(0,Math.min(run.length,remaining));remaining-=count;
    if(count<2)return '';
    return count===run.length?fullRenderedRuns[i][j]:run.slice(0,count).map(p=>p.join(',')).join(' ');
  }));
},[plan,stitchIndex,points.length,fullRenderedRuns]);
const stitchedArtwork=useMemo(()=>plan?.blocks.map((b,i)=><g key={i} opacity={hidden.includes(i)?0:1} fill="none" strokeLinecap={realistic?"round":"butt"} strokeLinejoin="round">{b.runs.map((_r,j)=>{const visible=renderedRuns[i]?.[j];if(!visible)return null;const color='rgb('+b.color.join(',')+')';return realistic?<g key={j} pointerEvents="none"><polyline points={visible} stroke={color} strokeWidth=".46"/><polyline points={visible} stroke="#ffffff" opacity=".17" strokeWidth=".12" transform="translate(-.06 -.07)"/></g>:<polyline key={j} points={visible} stroke={color} vectorEffect="non-scaling-stroke" strokeWidth="1"/>})}</g>),[plan,hidden,realistic,renderedRuns]);
useEffect(()=>{
  if(!playing)return;
  const interval=window.setInterval(()=>{
    setPlayhead(previous=>Math.min(points.length,(previous??0)+Math.max(1,Math.round(10*playbackSpeed))));
  },100);
  return()=>window.clearInterval(interval);
},[playing,playbackSpeed,points.length]);
useEffect(()=>{if(stitchIndex>=points.length)setPlaying(false);},[stitchIndex,points.length]);

const selectionRequest=useRef(0);
function selectObject(object:EditableObject|null) {
  if(object&&lockedObjects.includes(object.uid))return;
  if(object)setCanvasMode('select');
  setMulti([]);setContext(null);
  const request=++selectionRequest.current;
  setRecognizingWord(false);setConvertText(false);setRecognizedOriginal('');setRecognizedIds([]);setRecognitionError('');setFailedWord('');
  setSelectedObject(object?.uid??null);
  if(object){setLayerTab('objects');setObjectKind(object.kind);if(inspectorTab!=='stitches'&&inspectorTab!=='transform')setInspectorTab('transform');void invoke<unknown>('lettering_settings',{uid:object.uid}).then(settings=>{if(selectionRequest.current!==request)return;if(settings){openText(object.uid);return}if(!object.bounds)return;const [,y,,h]=object.bounds;if(h<1.8)return;const row=objects.filter(o=>{if(!o.bounds||o.hidden||o.locked||o.color.join(',')!==object.color.join(','))return false;const [,oy,ow,oh]=o.bounds;return oh>=h*.55&&oh<=h*1.65&&ow<=h*2.5&&Math.abs(oy+oh/2-y-h/2)<=h*.28}).sort((a,b)=>a.bounds![0]-b.bounds![0]);const index=row.findIndex(o=>o.uid===object.uid);if(index<0)return;let lo=index,hi=index;const gap=(a:EditableObject,b:EditableObject)=>b.bounds![0]-a.bounds![0]-a.bounds![2];const typicalGaps=row.slice(1).map((o,i)=>gap(row[i],o)).filter(g=>g>=0&&g<=h*.85).sort((a,b)=>a-b);const tracking=typicalGaps.length>=3?typicalGaps[Math.floor((typicalGaps.length-1)/2)]:0;const threshold=Math.min(h*.85,Math.max(h*.38,tracking*1.65));while(lo>0&&gap(row[lo-1],row[lo])<=threshold)lo--;while(hi+1<row.length&&gap(row[hi],row[hi+1])<=threshold)hi++;const letters=row.slice(lo,hi+1);const left=Math.min(...letters.map(o=>o.bounds![0]));const right=Math.max(...letters.map(o=>o.bounds![0]+o.bounds![2]));const components=objects.filter(o=>{if(!o.bounds||o.hidden||o.locked||letters.some(l=>l.uid===o.uid)||o.color.join(',')!==object.color.join(','))return false;const [ox,oy,ow,oh]=o.bounds;return oh>0&&oh<=h*.55&&ow<=h*.55&&ox>=left-h*.12&&ox+ow<=right+h*.12&&oy>=y-h*.45&&oy+oh<=y+h*1.15});const wordShapes=[...letters,...components];const ids=wordShapes.map(o=>o.uid);const key=JSON.stringify(wordShapes.map(o=>[o.uid,o.bounds,o.path,o.color]));const cached=recognitionCache.current.get(key);setRecognizingWord(true);showInspector(true);return Promise.all([cached?Promise.resolve(cached):invoke<{text:string;font:string}[]>('recognize_selected_lettering',{uids:ids}).then(lines=>{if(recognitionCache.current.size>=64)recognitionCache.current.clear();recognitionCache.current.set(key,lines);return lines}),invoke<string[]>('lettering_fonts')]).then(([lines,fonts])=>{if(selectionRequest.current!==request)return;setRecognizingWord(false);if(!lines.length)return;const word=lines.map(l=>l.text).join(' ').trim();if(!word)return;setConvertFonts(fonts);setConvertFont(fonts.includes(lines[0].font)?lines[0].font:fonts[0]||'');setConvertWord(word);setRecognizedOriginal(word);setRecognizedIds(ids);setConvertText(true);setMulti(ids);setSelectedObject(null);showInspector(true);setInspectorTab('transform')})}).catch(()=>{if(selectionRequest.current===request)setRecognizingWord(false)});}
}

useEffect(()=>{if(!convertText||busy||!convertWord.trim()||convertWord===recognizedOriginal||convertWord===failedWord||!convertFont||!recognizedIds.length)return;const timer=setTimeout(()=>{void edit('convert_selected_lettering',{uids:recognizedIds,text:recognizedOriginal,font:convertFont,replacement:convertWord}).then(async result=>{if(!result.plan){setFailedWord(convertWord);setRecognitionError(result.error||'Could not reconstruct this word. Original artwork preserved.');return}setConvertText(false);const items=await invoke<EditableObject[]>('editable_objects');const item=items.find(o=>!objects.some(old=>old.uid===o.uid));if(item){openText(item.uid);setMessage('Lettering updated.')}})},650);return()=>clearTimeout(timer)},[convertText,convertWord,recognizedOriginal,convertFont,recognizedIds,busy,failedWord]);

function editSelection(operation:ObjectOperation,uid=selectedObject) {
  if(uid!==null&&!busy&&!lockedObjects.includes(uid))void edit('edit_artwork_object',{uid,operation});
}

function pointerPosition(event:ReactPointerEvent<SVGSVGElement>) {
  const matrix=event.currentTarget.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()) : null;
}

function resizeAt(position:DOMPoint,shift=false) {
  const gesture=resizeGesture.current;
  if(!gesture)return null;
  const {handle,anchorX:x,anchorY:y}=gesture;
  let sx=handle.dx?(position.x-x)/(handle.x-x):1;
  let sy=handle.dy?(position.y-y)/(handle.y-y):1;
  if(shift&&handle.dx&&handle.dy){
    const width=handle.x-x,height=handle.y-y;
    sx=((position.x-x)*width+(position.y-y)*height)/(width*width+height*height);
    sy=sx;
  }
  const clamp=(factor:number)=>Math.min(10,Math.max(.1,factor));
  return {kind:'resize' as const,sx:clamp(sx),sy:clamp(sy),x,y};
}

function movedOnScreen(event: ReactPointerEvent<SVGSVGElement>, origin: {clientX:number;clientY:number}) {
  return Math.hypot(event.clientX-origin.clientX,event.clientY-origin.clientY) >= 3;
}

function startCanvasGesture(event:ReactPointerEvent<SVGSVGElement>) {
  if(busy||event.button!==0&&event.button!==1)return;
  event.preventDefault();
  const target=event.target instanceof Element?event.target.closest('[data-artwork-uid]'):null;
  let object=target?objects.find(item=>item.uid===Number(target.getAttribute('data-artwork-uid'))&&!lockedObjects.includes(item.uid)):undefined;
  const position=pointerPosition(event);
  if(position&&drawing.tool&&drawing.down(event,drawingPoint(position)))return;
  if(position&&stitchGuides.down(event,[position.x,position.y]))return;
  if(canvasMode==='solid'&&event.button===0&&position){
    marqueeGesture.current={pointer:event.pointerId,x:position.x,y:position.y,clientX:event.clientX,clientY:event.clientY,add:false,initial:[]};
    setMarquee({x:position.x,y:position.y,w:0,h:0});
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  // A small screen-space tolerance lets users grab hairlines and tiny marks.
  if(!object&&position&&canvasMode==='select'&&event.button===0){
    const matrix=event.currentTarget.getScreenCTM();
    const tol=matrix?8/Math.max(.001,Math.hypot(matrix.a,matrix.b)):1;
    const hits=objects.filter(o=>{if(!o.bounds||lockedObjects.includes(o.uid))return false;const [x,y,w,h]=o.bounds;return (Math.min(w,h)<tol*2)&&position.x>=x-tol&&position.x<=x+w+tol&&position.y>=y-tol&&position.y<=y+h+tol;});
    hits.sort((a,b)=>{const distance=(o:EditableObject)=>{const [x,y,w,h]=o.bounds!;return Math.hypot(Math.max(x-position.x,0,position.x-x-w),Math.max(y-position.y,0,position.y-y-h));};return distance(a)-distance(b)||(a.bounds![2]*a.bounds![3])-(b.bounds![2]*b.bounds![3]);});
    object=hits[0];
  }
  if(baselinePicking&&event.button===0){
    if(!object||object.fill_rule){setMessage('Click a single open path to use as the lettering baseline.');return;}
    const uid=object.uid,label=object.label,request=++baselineRequest.current;
    setBaselinePicking(false);
    void invoke<string>('lettering_baseline',{uid})
      .then(path=>{if(request===baselineRequest.current){setTextBaseline({path,label});setMessage('');}})
      .catch(error=>{if(request===baselineRequest.current)setMessage(String(error));});
    return;
  }
  if(event.button===0&&position&&event.target instanceof Element&&event.target.hasAttribute('data-rotation-handle')){
    const group=canvasMode==='design'?designGroups.find(g=>g.key===activeGroup):null;
    const b=group?.bounds??(canvasMode==='select'?(selectionIds.length?multiBounds:selected?.bounds):null);
    const ids=group?group.members.map(o=>o.uid):selectionIds.length?selectionIds:selected?[selected.uid]:[];
    if(b&&ids.length){const cx=b[0]+b[2]/2,cy=b[1]+b[3]/2;rotationGesture.current={pointer:event.pointerId,uids:ids,cx,cy,start:Math.atan2(position.y-cy,position.x-cx)};setRotationPreview(0);event.currentTarget.setPointerCapture(event.pointerId);return}
  }
  if(canvasMode==='select'&&event.button===0&&position&&multiBounds&&selectionIds.length&&event.target instanceof Element&&event.target.hasAttribute('data-multi-resize')){
    const [x,y,w,h]=multiBounds;const corner=Number(event.target.getAttribute('data-multi-resize'));
    groupResizeGesture.current={pointer:event.pointerId,uids:selectionIds,cx:x+w/2,cy:y+h/2,x:x+(corner%2)*w,y:y+Math.floor(corner/2)*h};
    event.currentTarget.setPointerCapture(event.pointerId);return;
  }
  if(canvasMode==='design'&&event.button===0&&position&&event.target instanceof Element&&event.target.hasAttribute('data-group-resize')){
    const group=designGroups.find(g=>g.key===activeGroup);
    if(group?.bounds){const [x,y,w,h]=group.bounds;const corner=Number(event.target.getAttribute('data-group-resize'));groupResizeGesture.current={pointer:event.pointerId,uids:group.members.map(o=>o.uid),cx:x+w/2,cy:y+h/2,x:x+(corner%2)*w,y:y+Math.floor(corner/2)*h};event.currentTarget.setPointerCapture(event.pointerId);return}
  }
  if(canvasMode==='design'&&event.button===0&&position&&event.target instanceof Element&&event.target.hasAttribute('data-design-group')){
    const key=event.target.getAttribute('data-design-group');const group=independentGroups?designGroups.find(g=>g.key===key):undefined;setActiveGroup(group?.key??designGroups[0]?.key??null);designGesture.current={pointer:event.pointerId,x:position.x,y:position.y,clientX:event.clientX,clientY:event.clientY,uids:group?.members.map(o=>o.uid)};
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
    if(event.shiftKey){toggleMulti(object.uid);return;}
    if(!selectionIds.includes(object.uid))selectObject(object);
    objectGesture.current={uid:object.uid,x:position.x,y:position.y,clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }
  if(canvasMode==='select'&&event.button===0&&position){
    marqueeGesture.current={pointer:event.pointerId,x:position.x,y:position.y,clientX:event.clientX,clientY:event.clientY,add:event.shiftKey,initial:movementIds};
    setMarquee({x:position.x,y:position.y,w:0,h:0});event.currentTarget.setPointerCapture(event.pointerId);return;
  }
  event.currentTarget.setPointerCapture(event.pointerId);
  setDrag({x:event.clientX,y:event.clientY,px:pan[0],py:pan[1]});
}

function moveCanvasGesture(event:ReactPointerEvent<SVGSVGElement>) {
  const position=pointerPosition(event);
  if(!position)return;
  if(drawing.tool&&drawing.move(event,drawingPoint(position)))return;
  if(stitchGuides.move(event,[position.x,position.y]))return;
  const box=marqueeGesture.current;
  if(box?.pointer===event.pointerId){setMarquee({x:Math.min(box.x,position.x),y:Math.min(box.y,position.y),w:Math.abs(position.x-box.x),h:Math.abs(position.y-box.y)});return;}
  if(!event.buttons&&canvasMode==='select'){const element=event.target instanceof Element?event.target.closest('[data-artwork-uid]'):null;setHoverUid(element?Number(element.getAttribute('data-artwork-uid')):null);}
  if(rotationGesture.current?.pointer===event.pointerId){setRotationPreview(rotationAt(position,event.shiftKey));return}
  if(groupResizeGesture.current?.pointer===event.pointerId){setGroupScalePreview(groupScaleAt(position,event.shiftKey));return}
  if(designGesture.current?.pointer===event.pointerId){
    const start=designGesture.current;
    const offset: [number,number] = movedOnScreen(event,start) ? snapped(position.x-start.x,position.y-start.y,start.uids,true) : [0,0];
    if(start.uids)setObjectOffset(offset);else setDesignOffset(offset);
    return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    setResizePreview(resizeAt(position,event.shiftKey));
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId===event.pointerId){
    setObjectOffset(movedOnScreen(event,gesture)
      ? snapped(position.x-gesture.x,position.y-gesture.y,selectionIds.includes(gesture.uid)?selectionIds:[gesture.uid],true)
      : [0,0]);
  }else if(drag){
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const start=new DOMPoint(drag.x,drag.y).matrixTransform(matrix.inverse());
    setPan([drag.px-(position.x-start.x),drag.py-(position.y-start.y)]);
  }
}

function finishCanvasGesture(event:ReactPointerEvent<SVGSVGElement>,commit:boolean) {
  if(drawing.tool){
    const point=commit?pointerPosition(event):null;
    if(drawing.end(event,point?drawingPoint(point):null,commit))return;
  }
  const handlePoint=commit?pointerPosition(event):null;
  if(stitchGuides.end(event,handlePoint?[handlePoint.x,handlePoint.y]:null))return;
  setGuides({x:null,y:null});
  const box=marqueeGesture.current;
  if(box?.pointer===event.pointerId){
    marqueeGesture.current=null;setMarquee(null);
    const p=commit?pointerPosition(event):null;
    if(!p)return;
    if(Math.hypot(event.clientX-box.clientX,event.clientY-box.clientY)<4){if(!box.add)selectObject(null);return;}
    const x=Math.min(box.x,p.x),y=Math.min(box.y,p.y),right=Math.max(box.x,p.x),bottom=Math.max(box.y,p.y);
    const contained=objects.filter(object=>{
      if(!object.bounds||lockedObjects.includes(object.uid))return false;
      const [a,b,w,h]=object.bounds;
      if(a<x||b<y||a+w>right||b+h>bottom)return false;
      if(canvasMode!=='solid')return true;
      if(object.kind==='manual'||object.kind==='skip'||object.kind==='applique'||object.groups?.some(group=>group.startsWith('tl-lettering-')))return false;
      if(solidAreaShape==='box')return true;
      const rx=(right-x)/2, ry=(bottom-y)/2;
      if(rx<=0||ry<=0)return false;
      const farX=Math.max(Math.abs(a-x-rx),Math.abs(a+w-x-rx));
      const farY=Math.max(Math.abs(b-y-ry),Math.abs(b+h-y-ry));
      return (farX/rx)**2+(farY/ry)**2<=1;
    });
    const ids=contained.map(object=>object.uid);
    if(canvasMode==='solid'){
      if(!ids.length){setMessage('Draw around the full outline of at least one editable object.');return;}
      const colors = new Map<string,{area:number;color:number[]}>();
      for(const object of contained){
        const key=object.color.join(',');
        const previous=colors.get(key)?.area??0;
        colors.set(key,{area:previous+object.bounds![2]*object.bounds![3],color:object.color});
      }
      const dominant=[...colors.values()].reduce((a,b)=>a.area>=b.area?a:b).color;
      ++selectionRequest.current;setSelectedObject(null);setMulti(ids);setLayerTab('objects');setCanvasMode('select');setMessage('');
      openSelectedSolid(ids,dominant);
      return;
    }
    const next=Array.from(new Set([...(box.add?box.initial:[]),...ids]));
    if(next.length===1){selectObject(objects.find(o=>o.uid===next[0])??null);return;}
    ++selectionRequest.current;setSelectedObject(null);setMulti(next);setLayerTab('objects');return;
  }
  if(rotationGesture.current?.pointer===event.pointerId){
    const g=rotationGesture.current,position=commit?pointerPosition(event):null;
    const degrees=position?rotationAt(position,event.shiftKey):0;rotationGesture.current=null;
    if(Math.abs(degrees)>.5){setRotationPreview(degrees);void edit('transform_artwork_group',{uids:g.uids,scale:1,rotation:degrees})}else setRotationPreview(0);
    return;
  }
  if(groupResizeGesture.current?.pointer===event.pointerId){
    const g=groupResizeGesture.current,position=commit?pointerPosition(event):null;
    const factor=position?groupScaleAt(position,event.shiftKey):[1,1] as [number,number];groupResizeGesture.current=null;
    if(factor.some(v=>Math.abs(v-1)>.007)){setGroupScalePreview(factor);void edit('resize_artwork_selection',{uids:g.uids,sx:factor[0],sy:factor[1],x:g.cx,y:g.cy})}else setGroupScalePreview([1,1]);
    return;
  }
  if(designGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const start=designGesture.current;
    designGesture.current=null;
    if(position&&movedOnScreen(event,start)){
      const [dx,dy]=snapped(position.x-start.x,position.y-start.y,start.uids);
      if(Math.hypot(dx,dy)>=.05){if(start.uids){setObjectOffset([dx,dy]);void edit('move_artwork_objects',{uids:start.uids,dx,dy})}else{setDesignOffset([dx,dy]);void transform(1,0,dx,dy)}return;}
    }
    setDesignOffset([0,0]);setObjectOffset([0,0]);return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const result=position?resizeAt(position,event.shiftKey):null;
    const uid=resizeGesture.current.uid;
    resizeGesture.current=null;
    if(result&&(Math.abs(result.sx-1)>.007||Math.abs(result.sy-1)>.007)){setResizePreview(result);void edit('resize_artwork_selection',{uids:[uid],sx:result.sx,sy:result.sy,x:result.x,y:result.y});}else setResizePreview(null);
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId!==event.pointerId)return;
  const position=commit&&gesture?pointerPosition(event):null;
  objectGesture.current=null;
  if(!gesture){setDrag(null);return;}
  setDrag(null);
  if(position&&movedOnScreen(event,gesture)){
    const [dx,dy]=snapped(position.x-gesture.x,position.y-gesture.y,selectionIds.includes(gesture.uid)?selectionIds:[gesture.uid]);
    if(Math.hypot(dx,dy)>=0.05){setObjectOffset([dx,dy]);if(selectionIds.includes(gesture.uid)&&selectionIds.length>1)void edit('move_artwork_objects',{uids:selectionIds,dx,dy});else editSelection({kind:'move',dx,dy},gesture.uid);return;}
  }
  setObjectOffset([0,0]);
}

function stepStitch(delta:number) {
  setPlaying(false);
  setPlayhead(Math.max(0,Math.min(points.length,stitchIndex+delta)));
}

function fitArtwork() {
  if(!designBounds||invalidField)return;
  const {left,top,width:w,height:h}=designBounds;
  // The bounds are already cached for the current plan. Avoid scanning every
  // penetration again whenever the user changes the camera.
  setZoom(artworkZoom(w,h));
  setPan([left+w/2,top+h/2]);
}

const [qualityOverlay,setQualityOverlay]=useState<'coverage'|'density'>('coverage');
const [qualityObjects,setQualityObjects]=useState<number[]>([]);
useEffect(()=>{
  if(inspectorTab!=='quality'||!plan){setQualityObjects([]);return}
  let active=true;setQualityObjects([]);
  invoke<{uid:number|null;message:string}[]>('design_issues',{width,height}).then(issues=>{if(active)setQualityObjects(issues.filter(i=>i.uid!==null&&i.message.includes('Possible underfilled artwork:')).map(i=>i.uid!))}).catch(()=>{});
  return()=>{active=false};
},[inspectorTab,plan,width,height]);
const qualityDensity=useMemo(()=>{
  if(inspectorTab!=='quality'||qualityOverlay!=='density'||!plan)return [];
  const cells=new Map<string,{x:number;y:number;n:number}>();
  for(const b of plan.blocks)for(const r of b.runs)for(const p of r){
    const x=Math.floor(p[0]),y=Math.floor(p[1]),key=x+','+y;
    const c=cells.get(key);if(c)c.n++;else cells.set(key,{x,y,n:1});
  }
  return Array.from(cells.values()).filter(c=>c.n>=24).sort((a,b)=>b.n-a.n).slice(0,1500);
},[plan,inspectorTab,qualityOverlay]);
function locateIssue(uid:number) {
  const object=objects.find(object=>object.uid===uid);
  if(!object)return;
  selectObject(object);
  showLayers(true);
  if(object.bounds&&!invalidField){
    const [x,y,w,h]=object.bounds;
    setPlaying(false);
    setPlayhead(null);
    setPan([x+w/2,y+h/2]);
    setZoom(artworkZoom(w,h));
  }
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

async function open(){if(plan&&!await confirmAction('Replace the current design? Save your project first if needed.'))return;setBusy(true);setMessage('');try{const p=await invoke<Plan|null>('open_svg',{widthMm:artWidth,colors,removeBackground,detail});if(p){setThreadAssignments({});setPlan(p);setHidden([]);setPlayhead(null)}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
function deletionTarget(){if(canvasMode==='design'){const group=designGroups.find(g=>g.key===activeGroup);if(group)return {uids:group.members.map(o=>o.uid),all:false};if(plan?.stitches&&(!independentGroups||!objects.length))return {uids:[],all:true}}const ids=selectionIds.length?selectionIds:selectedObject!==null?[selectedObject]:[];return ids.length?{uids:ids,all:false}:null}
async function deleteDesign(clear=false){if(busy||!plan?.stitches)return;const target=clear?{uids:[],all:true}:deletionTarget();if(!target){setMessage('Select a design or objects on the canvas first.');return}if((target.all||target.uids.length===objects.length)&&!await confirmAction('Remove the entire design from the canvas? You can undo this action.'))return;await edit('delete_artwork_objects',target);setActiveGroup(null);setSelectedObject(null);setMulti([]);setContext(null);setHidden([])}
async function projectSave(){setBusy(true);try{const project=await invoke<Project|null>('save_project',{width,height,format,threadAssignments});if(project){rememberProject({...project,thumbnail:plan?thumbnailOf(plan):undefined});toast('Project saved.')}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
async function projectOpen(){if(plan&&!await confirmAction('Replace the current design? Save your project first if needed.'))return;setBusy(true);try{const p=await invoke<{plan:Plan;width:number;height:number;format:string;thread_assignments?:ThreadAssignments}|null>('open_project');if(p){setThreadAssignments(p.thread_assignments??{});setPlan(p.plan);setWidth(p.width);setHeight(p.height);setFormat(p.format);setMachine('');setHoop('');setHidden([]);setPlayhead(null)}}catch(e){setMessage(String(e))}finally{setBusy(false)}}
async function save(companions=false,images?:{sheet?:number[];preview?:number[]}){if(outside||machineExceeded||incompatibleHoop||invalidField||!plan?.stitches){const reason='Select a compatible hoop with valid dimensions and fit the design before exporting.';setMessage(reason);throw new Error(reason)}setBusy(true);try{if(await invoke<boolean>('export_design',{format,width,height,companions,assignments:threadAssignments,sheetPng:images?.sheet,previewPng:images?.preview}))toast((companions||images?.sheet||images?.preview)?'Embroidery file and companion documents saved. Test sew before production.':'Embroidery file saved. Test sew before production.')}catch(e){setMessage(String(e));throw e}finally{setBusy(false)}}
useEffect(()=>{const key=(e:KeyboardEvent)=>{if (document.querySelector('dialog[open]')||busy) return;
if(e.key==='Escape'&&baselinePicking){setBaselinePicking(false);return;}
if(e.key==='Escape'&&drawing.tool){drawing.pick(null);return;}
if(e.key==='Escape'&&canvasMode==='solid'){setCanvasMode('select');setMarquee(null);marqueeGesture.current=null;return;}
if(e.key==='Escape'&&focusCanvas){changeFocus(false);return;}
if(e.key==='Escape'&&window.innerWidth<dockBreakpoint&&(left||right)){setLeft(false);setRight(false);return;}
if((e.target as HTMLElement)?.closest("input,select,textarea,[contenteditable=true],[role=separator]"))return;
if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&movementIds.length&&!e.ctrlKey&&!e.metaKey){e.preventDefault();const step=e.shiftKey?nudgeStep*10:e.altKey?nudgeStep*.1:nudgeStep;nudge(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);return;}
if(e.repeat)return;
if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyC'&&canCopyStitchSettings){e.preventDefault();void copyStitchSettings();return;}
if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyV'&&canPasteStitchSettings){e.preventDefault();pasteStitchSettings();return;}
const drawShortcut=!e.ctrlKey&&!e.metaKey&&!e.altKey?drawingTools.find(item=>item.shortcut===e.key.toUpperCase()):undefined;
if(drawShortcut){e.preventDefault();drawing.pick(drawShortcut.tool);return;}
if(e.key==='F11'){e.preventDefault();toggleFocus();return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='i'){e.preventDefault();openInsertDialog();return;}
if(e.key==='Delete'||e.key==='Backspace'){if(deletionTarget()){e.preventDefault();void deleteDesign()}return;}
if(!selectionIds.length&&selectedObject!==null&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();editSelection({kind:'duplicate'});return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if(plan)void projectSave()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();if(plan)void edit("history_step",{redo:e.shiftKey})}else if(e.key==="Escape"){setContext(null);setMulti([]);setExportOpen(false);setDrag(null)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[plan,busy,width,height,format,focusCanvas,selectedObject,left,right,multi,activeGroup,canvasMode,objects,nudgeStep,lockedObjects]);return <><InsertDesignDialog<Plan> dialogRef={insertDialog} editorBusy={busy} anchorBounds={movementBounds??(()=>{const b=objects.filter(o=>!o.hidden&&o.bounds).map(o=>o.bounds!);if(!b.length)return null;const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]})()} onInsert={result=>{
  setThreadAssignments({});setPlan(result);setPlayhead(null);setPlaying(false);setHidden([]);setMessage('');
}}/><div className={`studio-edit-bar ${focusCanvas?'studio-focus-active':''}`} role="group" aria-label="Design commands">
  {focusCanvas&&<button className="studio-exit-focus" onClick={()=>changeFocus(false)}><Minimize size={16}/> Exit focus</button>}
  <div className="studio-document">
    <Layers3 size={17} aria-hidden="true"/>
    <h1 title={plan?.name || 'Untitled design'}>{plan?.name || 'Untitled design'}</h1>
  </div>
  <EditorHelp/>
  <EditorDigitizer active={artworkImport} onOpen={()=>setArtworkImport({file:null})} onClose={()=>setArtworkImport(null)} disabled={busy} onInsert={async(id,strength)=>{
    const result=await invoke<Plan>('insert_digitizer_draft',{id,strength});
    setThreadAssignments({});setPlan(result);setPlayhead(null);setPlaying(false);setHidden([]);
  }}/>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title="Open artwork" aria-label="Open artwork" disabled={busy} onClick={open}><FolderOpen size={18}/></button>
    <button className="studio-insert-action" title="Insert design (Ctrl+I or Cmd+I)" aria-label="Insert design" disabled={busy} onClick={openInsertDialog}><FilePlus size={18}/><span>Insert design</span></button>
    
  </div>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title={historyLabels[0].length?"Undo: "+historyLabels[0].at(-1):"Undo"} aria-label="Undo" disabled={!historyLabels[0].length||busy} onClick={()=>edit('history_step',{redo:false})}><Undo2 size={17}/></button>
    <button className="studio-tool-icon" title={historyLabels[1].length?"Redo: "+historyLabels[1].at(-1):"Redo"} aria-label="Redo" disabled={!historyLabels[1].length||busy} onClick={()=>edit('history_step',{redo:true})}><Redo2 size={17}/></button>
  </div>
  <div className="studio-command-group studio-design-tools" role="group" aria-label="Create and edit"><button className="studio-add-text" disabled={busy||!plan} onClick={openSimplify}><Scissors size={17}/> Simplify</button>
    <button className="studio-tool-icon" title="Center design in hoop" aria-label="Center design" disabled={!plan||busy} onClick={()=>edit('center_design',{})}><Scan size={18}/></button>
    <button className="studio-tool-icon" title="Transform design" aria-label="Transform design" disabled={!plan} onClick={()=>{showInspector(true);setInspectorTab('transform')}}><Move size={17}/></button>
    
    <button className="studio-add-text studio-toolbar-text" title="Add text" aria-label="Add text" disabled={busy} onClick={()=>openText()}><Type size={17}/><span>Add text</span></button>
  </div>
  <div className="studio-command-group studio-view-tools" role="group" aria-label="Workspace view">
    <button className="studio-tool-icon" title="Layers" aria-label="Layers" aria-pressed={left} onClick={()=>showLayers(!left)}><PanelLeft size={18}/></button>
    <button className="studio-tool-icon" title="Inspector" aria-label="Inspector" aria-pressed={right} onClick={()=>showInspector(!right)}><PanelRight size={18}/></button>
    <button className="studio-tool-icon" title={focusCanvas?'Exit focus view (Esc)':'Full-screen canvas (F11)'} aria-label={focusCanvas?'Exit focus view':'Focus canvas'} aria-pressed={focusCanvas} onClick={toggleFocus}>{focusCanvas?<Minimize size={18}/>:<Maximize size={18}/>}</button>
  </div>
  <CommandPalette commands={[
    ...drawingTools.map(item=>({label:item.label,group:'Drawing',run:()=>drawing.pick(item.tool),disabled:busy})),
    {label:'Move whole design',group:'Edit',run:()=>setCanvasMode('design'),disabled:!plan},
    {label:'Fit artwork',group:'View',run:fitArtwork,disabled:!plan},
    {label:'Fit hoop',group:'View',run:()=>{setZoom(100);setPan([0,0])}},
    {label:focusCanvas?'Exit focus view':'Focus canvas',group:'View',run:toggleFocus},
    {label:'Layers',group:'View',run:()=>showLayers(!left)},
    {label:'Hoop and machine',group:'Inspector',run:()=>{showInspector(true);setInspectorTab('hoop')}},
    {label:'Transform and resize',group:'Inspector',run:()=>{showInspector(true);setInspectorTab('transform')},disabled:!plan},
    {label:'Stitch tools and quality',group:'Inspector',run:()=>{showInspector(true);setInspectorTab('stitches')},disabled:!plan},
    {label:'Copy stitch settings',group:'Stitches',run:()=>void copyStitchSettings(),disabled:busy||!canCopyStitchSettings},
    {label:'Paste stitch settings',group:'Stitches',run:pasteStitchSettings,disabled:busy||!canPasteStitchSettings},
    {label:'Select same stitch type',group:'Stitches',run:selectSameStitchType,disabled:busy||!selected},
    {label:'Reverse stitch path',group:'Stitches',run:reverseStitchPath,disabled:busy||!stitchGuides.data?.reverses},
    {label:'Show stitch guides',group:'View',run:()=>{drawing.pick(null);stitchGuides.setVisible(!stitchGuides.visible);},disabled:!plan},
    {label:'Show sewing order',group:'View',run:()=>stitchGuides.setOrder(!stitchGuides.order),disabled:!plan},
    {label:stitchGuides.data?.textForm==='outlines'?'Restore editable text':'Convert lettering to outlines',group:'Lettering',run:changeTextForm,disabled:busy||!stitchGuides.data?.textForm},
    {label:'Add Text',group:'Create',run:()=>openText(),disabled:busy},
    {label:'Insert design',group:'File',run:openInsertDialog,disabled:busy},
    {label:'Import image and digitize',group:'File',run:()=>setArtworkImport({file:null}),disabled:busy},
    {label:'Duplicate selection',group:'Edit',run:()=>editSelection({kind:'duplicate'}),disabled:busy||!selected},
    {label:'Delete selection',group:'Edit',run:()=>void deleteDesign(),disabled:busy||!deletionTarget()},{label:'Clear canvas',group:'Edit',run:()=>void deleteDesign(true),disabled:busy||!plan?.stitches},
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
    <div className="workspace-options-panel"><details className="studio-inspector-section"><summary>Editing history</summary><small>Undo · latest first</small>{historyLabels[0].length?<ol>{[...historyLabels[0]].reverse().map((label,i)=><li key={i}>{label}</li>)}</ol>:<p>No undo actions</p>}<small>Redo · latest first</small>{historyLabels[1].length?<ol>{[...historyLabels[1]].reverse().map((label,i)=><li key={i}>{label}</li>)}</ol>:<p>No redo actions</p>}</details>
      <button disabled={busy} onClick={projectOpen}>Open project</button>
      <button disabled={busy} onClick={recover}>Recover last design</button>
      <label><span>Layers panel width</span><input aria-label="Left panel width" type="range" min="180" max="320" value={leftWidth} onChange={e=>setLeftWidth(Number(e.target.value))}/></label>
      <label><span>Inspector width</span><input aria-label="Right panel width" type="range" min="220" max="360" value={rightWidth} onChange={e=>setRightWidth(Number(e.target.value))}/></label>
    </div>
  </details>
  {plan&&<GarmentPreview blocks={plan.blocks}/>}
  {plan&&<ThreadOrder assignments={threadAssignments} onAssign={(index,value)=>setThreadAssignments(old=>({...old,[index]:value}))} blocks={plan.blocks} format={format} machine={machines.find(profile=>profile.id===machine)?.name??''}/>}
  <button title="Delete selected design or objects (Delete)" aria-label="Delete selection" disabled={busy||!deletionTarget()} onClick={()=>void deleteDesign()}><Trash2 size={17}/> Delete</button><button className="studio-price-job" title="Calculate pricing using current stitches and sewing time" disabled={!plan||busy} onClick={()=>setPricingOpen(true)}>Price job</button><button className="studio-save-design" title="Save editable Stitch Studio project (Ctrl+S or Cmd+S)" disabled={!plan||busy} onClick={projectSave}><Save size={17}/> Save design</button><button className="primary studio-export" disabled={!plan?.stitches||outside||busy||machineExceeded||incompatibleHoop||invalidField} onClick={()=>setExportOpen(true)}><Download size={16}/> Export design</button>
</div>
{context&&<div className="studio-context-menu" style={{left:Math.max(8,Math.min(context.x,window.innerWidth-190)),top:Math.max(8,Math.min(context.y,window.innerHeight-270))}} role="group" aria-label="Object actions"><button onClick={()=>{const uid=context.uid;setContext(null);void invoke<unknown>('lettering_settings',{uid}).then(s=>{if(s)openText(uid);else{showInspector(true);setInspectorTab('transform')}}).catch(e=>setMessage(String(e)))}}>Object properties</button><button disabled={!canCopyStitchSettings} onClick={()=>{setContext(null);void copyStitchSettings()}}>Copy stitch settings</button><button onClick={()=>{setContext(null);drawing.pick(null);stitchGuides.setVisible(true)}}>Show stitch guides</button><button onClick={()=>{editSelection({kind:'duplicate'},context.uid);setContext(null)}}>Duplicate</button><button onClick={()=>{editSelection({kind:'rotate'},context.uid);setContext(null)}}>Rotate 90°</button><button onClick={()=>{editSelection({kind:'delete'},context.uid);setContext(null)}}>Delete object</button><button onClick={()=>setContext(null)}>Close menu</button></div>}{busy&&!inlineWork&&<div className="processing-overlay"><section className="processing-card" role="status"><div className="studio-spinner"/><h2>Working on your design</h2><progress aria-label="Processing"/></section></div>}<div className={`editor-grid studio-canvas-layout ${focusCanvas?'canvas-focus':''} ${left?'':'hide-left'} ${right?'':'hide-right'}`} style={{'--studio-layers-width':`${leftWidth}px`,'--studio-inspector-width':`${rightWidth}px`} as CSSProperties}>
<div className="editor-toolrail" role="group" aria-label="Editor tools">
  <button onClick={()=>setHoopOpen(true)} title="Hoop and machine settings"><SquareDashed size={20}/><small>Hoop</small></button>
  <button aria-pressed={right&&inspectorTab==='stitches'} onClick={()=>{showInspector(true);setInspectorTab('stitches')}} title="Stitch settings and quality"><Scissors size={20}/><small>Stitches</small></button>
  <button aria-pressed={right&&inspectorTab==='threads'} onClick={()=>{showInspector(true);setInspectorTab('threads')}} title="Edit design colors"><Palette size={20}/><small>Colors</small></button>
  <button disabled={busy} onClick={()=>{const command=navigation.find(n=>n.label==='Digitize an image');if(command)command.run();else void open()}} title="Digitize an image"><Wrench size={20}/><small>Digitize</small></button>
</div>
<article className="workspace-sidebar studio-layers-dock">
  <div className="layers-dock-header">
    <div className="layers-dock-title"><Layers3 size={17} aria-hidden="true"/><h2>Layers</h2>
      <button className="studio-tool-icon" title="Close layers" aria-label="Close layers" onClick={()=>setLeft(false)}><X size={15}/></button>
    </div>
    <div className="workspace-segments" role="group" aria-label="Layers">
      <button aria-pressed={layerTab==='objects'} onClick={()=>setLayerTab('objects')}>Objects <span>{objects.length}</span></button>
      <button aria-pressed={layerTab==='threads'} onClick={()=>setLayerTab('threads')}>Blocks <span>{plan?.blocks.length??0}</span></button>
    </div>
  </div>
  {layerTab==='objects' && (objects.length ? <section className="workspace-object-list">
    <label className="layers-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="Search objects"
      placeholder="Find an object" value={objectQuery} onChange={event=>setObjectQuery(event.target.value)}/></label>
    {!objectPage.total&&<p className="workspace-helper">No objects match your search.</p>}
    <div className="layers-object-rows">
      {objectPage.items.map(object=>{
        const name=object.label||`Object ${object.uid+1}`;
        const targetDirection=dropLayer?.uid===object.uid?dropLayer.direction:undefined;
        const canDrop=dragLayer!==null&&dragLayer!==object.uid&&!busy;
        return <div key={object.uid} className="studio-layer-item" data-drop={targetDirection} data-hidden={object.hidden||undefined}
          onDragOver={event=>{
            if(!canDrop)return;
            event.preventDefault();
            event.dataTransfer.dropEffect='move';
            const bounds=event.currentTarget.getBoundingClientRect();
            const direction=event.clientY<bounds.top+bounds.height/2?'before':'after';
            setDropLayer({uid:object.uid,direction});
          }}
          onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropLayer(null)}}
          onDrop={event=>{
            event.preventDefault();
            if(canDrop&&targetDirection)void edit('reorder_artwork_object',{uid:dragLayer,direction:targetDirection,targetUid:object.uid});
            setDragLayer(null);setDropLayer(null);
          }}>
          <span draggable={!busy&&!object.locked&&!object.hidden} className="studio-layer-grip" title="Drag to change sewing order"
            onDragStart={event=>{
              event.dataTransfer.effectAllowed='move';
              event.dataTransfer.setData('text/plain',String(object.uid));
              setDragLayer(object.uid);
            }} onDragEnd={()=>{setDragLayer(null);setDropLayer(null)}}><GripVertical size={14} aria-hidden="true"/></span>
          <button disabled={object.locked||object.hidden} aria-pressed={selectionIds.length?selectionIds.includes(object.uid):selectedObject===object.uid}
            onClick={event=>event.shiftKey?toggleMulti(object.uid):selectObject(object)} className="object-layer-row" title={name}>
            <span className="layers-swatch" style={{backgroundColor:`rgb(${object.color.join(',')})`}}/>
            <span className="layers-row-text"><strong>{name}</strong><small>{object.kind==='manual'?'Fixed stitches':object.kind==='auto'?'Auto':object.kind}</small></span>
          </button>
          <button type="button" className="layer-row-action" disabled={busy} aria-label={`${object.hidden?'Show':'Hide'} ${name}`}
            title={object.hidden?'Include in preview and exports':'Hide from preview and exports'}
            onClick={()=>void edit('set_artwork_layer',{uid:object.uid,hidden:!object.hidden})}>
            {object.hidden?<EyeOff size={14}/>:<Eye size={14}/>}
          </button>
          <button type="button" className="layer-row-action" disabled={busy} aria-label={`${object.locked?'Unlock':'Lock'} ${name}`}
            title={object.locked?'Unlock object':'Lock object'} onClick={()=>void edit('set_artwork_layer',{uid:object.uid,locked:!object.locked})}>
            {object.locked?<LockKeyhole size={13}/>:<LockKeyholeOpen size={13}/>}
          </button>
        </div>;
      })}
    </div>
    <ListNavigation {...objectPage}/>
    {selected&&<div className="layer-dock-footer">
      <LayerDialog label="Layer settings" title="Layer settings" icon={<SlidersHorizontal size={14}/>} disabled={busy} onOpen={()=>setRenameDraft(selected.label)}>
        {close=><div className="layer-artwork-settings">
          <label>Layer name<input value={renameDraft} maxLength={80} onChange={e=>setRenameDraft(e.target.value)}/></label>
          <button disabled={busy||!renameDraft.trim()||renameDraft.trim()===selected.label} onClick={()=>{
            close();
            void edit('set_artwork_layer',{uid:selected.uid,name:renameDraft.trim()});
          }}>Rename layer</button>
          <h3>Sewing order</h3>
          <div className="alignment-pair">{[['first','First'],['earlier','Earlier'],['later','Later'],['last','Last']].map(([direction,label])=>
            <button key={direction} disabled={busy} onClick={()=>{close();void edit('reorder_artwork_object',{uid:selected.uid,direction})}}>{label}</button>)}</div>
          <p className="workspace-helper">Manual order overrides automatic sequencing. Hidden layers are excluded from exports.</p>
          <button disabled={busy||!selected.bounds} onClick={()=>{close();selectNearbyRegion()}}>Select nearby same-color shapes</button>
        </div>}
      </LayerDialog>
      {selected.kind!=='manual'&&<LayerDialog label="Change stitch type" title="Selected object stitch type"
        icon={<Waypoints size={14}/>} disabled={busy}>
        {close=><div className="layer-stitch-choices">
          <StitchPicker value={objectKind} onChange={setObjectKind}/>
          <button disabled={busy||objectKind==='manual'} onClick={()=>{close();void edit('set_object_kind',{uid:selected.uid,kind:objectKind})}}>Apply to selected object</button>
        </div>}
      </LayerDialog>}
    </div>}
  </section> : <p className="workspace-helper">{plan ? 'This design has stitch paths. Open Threads to inspect the color blocks.' : 'Open artwork or insert a design to see its objects.'}</p>)}
  {layerTab==='threads' && (plan ? <section className="workspace-thread-list">
    {threadPage.items.map((block,offset)=>{
      const index=threadPage.start+offset;
      const color='#'+block.color.map(value=>value.toString(16).padStart(2,'0')).join('');
      const concealed=hidden.includes(index);
      function recolor(value:string) {
        setThreadAssignments(old=>{const next={...old};delete next[index];return next});
        void edit('recolor_block',{index,color:[1,3,5].map(position=>parseInt(value.slice(position,position+2),16))});
      }
      return <div className="thread-row layers-thread-row" key={index}>
        <input aria-label={`Thread ${index+1} color`} type="color" disabled={busy} value={color} onChange={event=>recolor(event.target.value)}/>
        <div className="layers-row-text"><strong>Block {index+1}</strong><small>{color.toUpperCase()}</small></div>
        <button title={concealed?'Show this thread in the preview':'Hide this thread in the preview'} aria-label={concealed?'Show thread preview':'Hide thread preview'}
          onClick={()=>setHidden(items=>concealed?items.filter(item=>item!==index):[...items,index])}>{concealed?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        {!!threadLibrary.length&&<SavedThreadDialog index={index} threads={threadLibrary} disabled={busy} onChoose={thread=>{
          recolor(thread.color);
          setThreadAssignments(old=>({...old,[index]:[thread.brand,thread.code,thread.name].filter(Boolean).join(' ')}));
        }}/>}
      </div>;
    })}
    <ListNavigation {...threadPage}/>
  </section> : <p className="workspace-helper">Open a design to see its thread order.</p>)}
  <div className="layer-dock-footer">
    <LayerDialog label="Artwork import settings" title="Artwork import settings" icon={<SlidersHorizontal size={14}/>}>
      {()=><div className="layer-artwork-settings">
    <label>Artwork width (in) <small>({artWidth.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((artWidth/25.4).toFixed(3))} onChange={e=>{setArtWidth(Number(e.target.value)*25.4)}}/></label><label>Thread colors<select value={colors} onChange={e=>setColors(Number(e.target.value))}><option value="0">Automatic</option>{[2,3,4,5,6,7,8,9,10].map(n=><option key={n}>{n}</option>)}</select></label><label><input type="checkbox" checked={removeBackground} onChange={e=>setRemoveBackground(e.target.checked)}/> Remove white background</label><label>Detail<input type="range" min="0" max="100" value={detail} onChange={e=>setDetail(Number(e.target.value))}/></label>
  </div>}
    </LayerDialog>
  </div>
</article>
{left&&panelResizeHandle("left")}{right&&panelResizeHandle("right")}<article className="canvas-panel"
  onDragOver={event=>{
    if(!event.dataTransfer.types.includes('Files'))return;
    event.preventDefault();
    event.dataTransfer.dropEffect=busy?'none':'copy';
    if(!busy)setArtworkDrag(true);
  }}
  onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setArtworkDrag(false)}}
  onDrop={event=>{
    if(!event.dataTransfer.types.includes('Files'))return;
    setArtworkDrag(false);
    if(event.defaultPrevented)return;
    event.preventDefault();
    if(!busy&&event.dataTransfer.files[0])setArtworkImport({file:event.dataTransfer.files[0]});
  }}>
{artworkDrag&&<div className="canvas-artwork-drop" role="status">Drop an image to digitize</div>}
<div className={`studio-camera studio-camera-docked ${cameraTop?'studio-camera-top':'studio-camera-bottom'}`} role="group" aria-label="Canvas view">
  <button className="studio-tool-icon camera-dock-grip" title="Move camera controls to the top or bottom"
    aria-label={cameraTop?'Move camera controls to bottom':'Move camera controls to top'}
    onClick={event=>{if(event.detail===0)setCameraTop(value=>!value)}}
    onPointerDown={event=>{
      if(event.button!==0)return;
      cameraDrag.current=event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerCancel={()=>{cameraDrag.current=null}} onPointerUp={event=>{
      if(cameraDrag.current===null)return;
      const movement=event.clientY-cameraDrag.current;
      cameraDrag.current=null;
      if(Math.abs(movement)<7)setCameraTop(value=>!value);
      else setCameraTop(movement<0);
    }}><GripHorizontal size={16}/></button>
  <button className="studio-hoop-shortcut" title="Change machine or hoop dimensions" aria-label="Change machine or hoop dimensions" onClick={()=>setHoopOpen(true)}><SquareDashed size={16}/><strong>{(width/25.4).toFixed(2)} × {(height/25.4).toFixed(2)} in</strong></button>
  
  <DrawingControls drawing={drawing} disabled={busy}/>
  <button className="studio-selection-mode" title="Select and move the entire design" aria-label="Move whole design" aria-pressed={canvasMode==='design'} onClick={()=>{drawing.pick(null);selectObject(null);setCanvasMode('design');setActiveGroup(designGroups.length===1?designGroups[0].key:null);setPlaying(false);setPlayhead(null)}}><Group size={17}/><span className="camera-label">Design</span></button>
  <button className="studio-selection-mode" title="Select individual objects; Shift-click to select several" aria-label="Select objects" aria-pressed={canvasMode==='select'} onClick={()=>{drawing.pick(null);setCanvasMode('select');setPlaying(false);setPlayhead(null)}}><MousePointer2 size={17}/><span className="camera-label">Objects</span></button>
  <button className="studio-selection-mode" title="Draw a box or oval to preview a solid fill" aria-label="Solid area"
    disabled={!objects.length||busy} aria-pressed={canvasMode==='solid'} onClick={()=>{drawing.pick(null);setPlaying(false);setPlayhead(null);setCanvasMode(canvasMode==='solid'?'select':'solid')}}>
    <SquareDashed size={16}/><span className="camera-label">Solid area</span>
  </button>
  <button className="studio-tool-icon" title="Pan canvas" aria-label="Pan canvas" aria-pressed={canvasMode==='pan'} onClick={()=>{drawing.pick(null);setCanvasMode('pan')}}><Hand size={17}/></button>
  <button className="studio-tool-icon" title="Zoom out" aria-label="Zoom out" disabled={zoom<=25} onClick={()=>setZoom(value=>Math.max(25,value-25))}><ZoomOut size={17}/></button>
  <button className="camera-zoom-value" title="Reset zoom to 100%" aria-label="Reset zoom to 100%" onClick={()=>{setZoom(100);setPan([0,0])}}>{Math.round(zoom)}%</button>
  <button className="studio-tool-icon" title="Zoom in" aria-label="Zoom in" disabled={zoom>=400} onClick={()=>setZoom(value=>Math.min(400,value+25))}><ZoomIn size={17}/></button>
  <button title="Fit artwork" aria-label="Fit artwork" disabled={!points.length} onClick={fitArtwork}><Maximize size={16}/><span className="camera-label">Fit</span></button>
  <button title="Fit hoop view" aria-label="Fit hoop view" onClick={()=>{setZoom(100);setPan([0,0])}}><SquareDashed size={16}/><span className="camera-label">Hoop</span></button>
  <button className="studio-tool-icon" title="Hoop grid" aria-label="Hoop grid" aria-pressed={grid} onClick={()=>setGrid(value=>!value)}><Grid size={16}/></button>
  <button title="Thread view" aria-label="Thread view" aria-pressed={realistic} onClick={()=>setRealistic(value=>!value)}><Eye size={16}/><span className="camera-label">Thread</span></button>
<button title="Show sampled stitch directions" aria-label="Show stitch directions" aria-pressed={showDirections} onClick={()=>setShowDirections(v=>!v)}><Waypoints size={16}/><span className="camera-label">Direction</span></button>
</div>
{canvasMode==='solid'&&<div className="studio-soft-area-tools" role="group" aria-label="Solid area shape">
  <button aria-pressed={solidAreaShape==='box'} onClick={()=>setSolidAreaShape('box')}>Box</button>
  <button aria-pressed={solidAreaShape==='oval'} onClick={()=>setSolidAreaShape('oval')}>Oval</button>
  <span>Drag around the artwork to make solid.</span>
</div>}
<div className="workspace-canvas" ref={canvasSurface}>
{plan&&(movementIds.length>0||(selected&&canvasMode==='select'))&&<div className="canvas-selection-bar">{movementIds.length>0&&<button disabled={busy} onClick={()=>openSelectedSolid()}
  title="Preview the selected artwork as a solid fill">Make selection solid</button>}{selected&&canvasMode==='select'&&<div className="studio-selection-docked" role="group" aria-label="Selected object actions">
  <span style={{fontSize:12,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selected.label||'Object '+selected.uid}</span>
  <button className="studio-tool-icon" title="Edit the selected object" aria-label="Open object editing tools"
    onClick={()=>{showInspector(true);setInspectorTab('transform')}}><MousePointer2 size={16}/></button>
  <button className="studio-tool-icon" title="Adjust stitches on the selected object" aria-label="Open object stitch settings"
    onClick={()=>{showInspector(true);setInspectorTab('stitches')}}><Scissors size={16}/></button>
  <button className="studio-tool-icon" title="Move left" aria-label="Move selected object left" disabled={busy} onClick={()=>nudge(-nudgeStep,0)}><ArrowLeft size={16}/></button>
  <button className="studio-tool-icon" title="Move up" aria-label="Move selected object up" disabled={busy} onClick={()=>nudge(0,-nudgeStep)}><ArrowUp size={16}/></button>
  <button className="studio-tool-icon" title="Move down" aria-label="Move selected object down" disabled={busy} onClick={()=>nudge(0,nudgeStep)}><ArrowDown size={16}/></button>
  <button className="studio-tool-icon" title="Move right" aria-label="Move selected object right" disabled={busy} onClick={()=>nudge(nudgeStep,0)}><ArrowRight size={16}/></button>
  <button className="studio-tool-icon" title="Rotate selection 90°" aria-label="Rotate selection 90 degrees" disabled={busy} onClick={()=>editSelection({kind:'rotate'})}><RotateCw size={16}/></button>
  <PathEditor<Plan> key={selected.uid} object={selected} disabled={busy||lockedObjects.includes(selected.uid)}
    onApply={next=>{
      if(next.blocks.length!==plan.blocks.length||next.blocks.some((block,index)=>block.color.join(',')!==plan.blocks[index]?.color.join(',')))setThreadAssignments({});
      setPlan(next);setPlayhead(null);setPlaying(false);setMessage('');
    }}/>
  <button className="studio-tool-icon" title="Duplicate selection" aria-label="Duplicate selection" disabled={busy} onClick={()=>editSelection({kind:'duplicate'})}><Copy size={16}/></button>
  <button className="studio-tool-icon" title="Delete selection" aria-label="Delete selection" disabled={busy||!deletionTarget()} onClick={()=>void deleteDesign()}><Trash2 size={16}/></button>
</div>}</div>}
<svg aria-label="Stitch preview; drag empty space to select objects in Objects mode, or use Pan to move the canvas" data-mode={drawing.tool?'draw':canvasMode}
 onPointerDown={startCanvasGesture} onPointerMove={moveCanvasGesture} onPointerLeave={()=>setHoverUid(null)}
 onPointerUp={event=>finishCanvasGesture(event,true)}
 onPointerCancel={event=>finishCanvasGesture(event,false)}
 onLostPointerCapture={event=>finishCanvasGesture(event,false)} viewBox={[pan[0]-screenWidth/2,pan[1]-screenHeight/2,screenWidth,screenHeight].join(' ')} className="design-canvas" onWheel={e=>{const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const anchor=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());const next=Math.max(25,Math.min(400,zoom*(e.deltaY<0?1.1:1/1.1)));if(next===zoom)return;const ratio=zoom/next;setPan([anchor.x+(pan[0]-anchor.x)*ratio,anchor.y+(pan[1]-anchor.y)*ratio]);setZoom(next)}} style={{width:'100%',background:'var(--lav-bg,var(--canvas,#edf1ed))'}}><defs><pattern id="hoop-fabric" width="1.4" height="1.4" patternUnits="userSpaceOnUse"><path d="M0 .2H1.4 M.2 0V1.4" fill="none" stroke="#967a68" strokeWidth=".075" opacity=".18"/></pattern><pattern id="hoop-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#d8cce6" strokeWidth=".75" vectorEffect="non-scaling-stroke"/></pattern></defs><rect x={-width/2} y={-height/2} width={width} height={height} fill="#fffdf5" stroke="#ad8cd1" strokeWidth="1.6" rx={4} vectorEffect="non-scaling-stroke" className="studio-hoop"/><rect x={-width/2} y={-height/2} width={width} height={height} fill="url(#hoop-fabric)" rx={2}/><rect x={-width/2} y={-height/2} width={width} height={height} fill={grid?"url(#hoop-grid)":"none"}/>{!invalidField&&<g pointerEvents="none" fill="#6945a2" stroke="#9478b6" strokeWidth=".6"><path d={`M ${-width/2} ${-height/2-5} H ${width/2} M ${-width/2} ${-height/2-7} v4 M ${width/2} ${-height/2-7} v4 M ${-width/2-5} ${-height/2} V ${height/2} M ${-width/2-7} ${-height/2} h4 M ${-width/2-7} ${height/2} h4`} fill="none" vectorEffect="non-scaling-stroke"/><text x={0} y={-height/2-7} textAnchor="middle" fontSize={Math.max(2.4,Math.min(width,height)*.025)} stroke="none">{(width/25.4).toFixed(2)} in · {Math.round(width)} mm</text><text transform={`translate(${-width/2-8} 0) rotate(-90)`} textAnchor="middle" fontSize={Math.max(2.4,Math.min(width,height)*.025)} stroke="none">{(height/25.4).toFixed(2)} in · {Math.round(height)} mm</text></g>}{grid&&<g stroke="#896d98" opacity=".6" pointerEvents="none">
<path d={`M ${-width/2} 0 H ${width/2} M 0 ${-height/2} V ${height/2}`} strokeDasharray="4 5" strokeWidth=".6" vectorEffect="non-scaling-stroke"/>
</g>}<g transform={`translate(${designOffset.join(' ')})`}>{stitchedArtwork}{showDirections&&<g pointerEvents="none" fill="none" stroke="#663399" strokeWidth="1.2">{directionSamples.filter(d=>d.index<stitchIndex&&!hidden.includes(d.block)).map(d=><path key={d.index} d="M-1.1 0H1.1M.4 -.65L1.1 0L.4 .65" transform={`translate(${d.x} ${d.y}) rotate(${d.angle}) scale(${100/zoom})`} vectorEffect="non-scaling-stroke"/>)}</g>}{canvasMode==='design'&&!independentGroups&&designBounds&&<rect
  data-design-group x={designBounds.left-2} y={designBounds.top-2}
  width={designBounds.width+4} height={designBounds.height+4} rx={1}
  fill="transparent" pointerEvents="all" stroke="#8543aa" strokeWidth="1.5"
  vectorEffect="non-scaling-stroke" strokeDasharray="5 4"><title>Drag to move the whole design</title></rect>}</g>
<DrawingOverlay drawing={drawing}/>
{canvasMode==='design'&&independentGroups&&designGroups.map((group,i)=>{const b=group.bounds;if(!b)return null;return <g key={group.key} transform={activeGroup===group.key?'translate('+objectOffset.join(' ')+')':undefined}><rect data-design-group={group.key} x={b[0]-1} y={b[1]-1} width={b[2]+2} height={b[3]+2} fill="transparent" pointerEvents="all" stroke={activeGroup===group.key?'#754bb0':'#b49acb'} strokeDasharray="5 4" vectorEffect="non-scaling-stroke"><title>Move design {i+1}</title></rect></g>})}
{canvasMode==='design'&&designGroups.filter(g=>g.key===activeGroup&&g.bounds&&g.bounds[2]>.01&&g.bounds[3]>.01).map(g=>{const [x,y,w,h]=g.bounds!;const cx=x+w/2,cy=y+h/2;const [sx,sy]=groupScalePreview;const tx=cx-w*sx/2+objectOffset[0],ty=cy-h*sy/2+objectOffset[1];return <g key={'resize-'+g.key} transform={`rotate(${rotationPreview} ${cx} ${cy})`}>{(sx!==1||sy!==1||rotationPreview!==0||objectOffset.some(v=>v!==0))&&<g pointerEvents="none" transform={`translate(${objectOffset.join(' ')}) translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`}>{g.members.filter(o=>o.path).map(o=><path key={o.uid} d={o.path} fill={o.fill_rule?'rgb('+o.color.join(',')+')':'none'} fillRule={o.fill_rule} stroke={'rgb('+o.color.join(',')+')'} strokeWidth={o.stroke_width||.3} opacity=".55"/>)}</g>}<rect x={tx} y={ty} width={w*sx} height={h*sy} fill="none" stroke="#754bb0" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>{[0,1,2,3].map(i=><circle key={i} cx={tx+(i%2)*w*sx} cy={ty+Math.floor(i/2)*h*sy} r={Math.max(.65,1.2*100/zoom)} fill="white" stroke="#754bb0" vectorEffect="non-scaling-stroke" data-group-resize={i} style={{cursor:i===0||i===3?'nwse-resize':'nesw-resize'}}><title>Drag to resize and recalculate stitches · Shift keeps proportions</title></circle>)}<line x1={tx+w*sx/2} x2={tx+w*sx/2} y1={ty} y2={ty-Math.max(3,9*100/zoom)} stroke="#754bb0" vectorEffect="non-scaling-stroke" pointerEvents="none"/><circle cx={tx+w*sx/2} cy={ty-Math.max(3,9*100/zoom)} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" style={{cursor:'grab'}}><title>Rotate design · Shift snaps to 15°</title></circle></g>})}
{snap&&<g pointerEvents="none" stroke="#a84bc5" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke">{guides.x!==null&&<line x1={guides.x} x2={guides.x} y1={-height/2} y2={height/2} vectorEffect="non-scaling-stroke"/>}{guides.y!==null&&<line x1={-width/2} x2={width/2} y1={guides.y} y2={guides.y} vectorEffect="non-scaling-stroke"/>}</g>}
{canvasMode==='select'&&stitchIndex===points.length&&<g className="studio-hit-targets">
 {objects.filter(object=>object.path&&!lockedObjects.includes(object.uid)).map(object=><path key={object.uid} d={object.path}
   data-artwork-uid={object.uid} onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!busy){selectObject(object);setContext({uid:object.uid,x:e.clientX,y:e.clientY})}}} onDoubleClick={e=>{e.stopPropagation();void invoke<unknown>('lettering_settings',{uid:object.uid}).then(s=>{if(s){setSelectedObject(object.uid);openText(object.uid)}}).catch(()=>{})}} fill={object.fill_rule?'transparent':'none'}
   fillRule={object.fill_rule} stroke={object.fill_rule?'none':'transparent'}
   strokeWidth={object.stroke_width} pointerEvents={object.fill_rule?'fill':'stroke'}/>)}
 {objects.filter(o=>o.path&&o.bounds&&!lockedObjects.includes(o.uid)&&Math.min(o.bounds[2],o.bounds[3])<2).map(o=><path key={'wide-hit-'+o.uid} d={o.path} data-artwork-uid={o.uid} fill="none" stroke="transparent" strokeWidth="12" vectorEffect="non-scaling-stroke" pointerEvents="stroke" style={{cursor:'move'}}/>)}
</g>}
{canvasMode==='select'&&hoverUid!==null&&hoverUid!==selectedObject&&!selectionIds.includes(hoverUid)&&!marquee&&objects.filter(o=>o.uid===hoverUid&&o.path).map(o=><path key={'hover-'+o.uid} d={o.path} fill="none" stroke="#a76bce" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none"/>)}
{marquee&&<g fill="#9165bf" fillOpacity=".12" stroke="#754bb0" strokeDasharray="4 3" pointerEvents="none">
  {canvasMode==='solid'&&solidAreaShape==='oval'
    ? <ellipse cx={marquee.x+marquee.w/2} cy={marquee.y+marquee.h/2} rx={marquee.w/2} ry={marquee.h/2} vectorEffect="non-scaling-stroke"/>
    : <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} vectorEffect="non-scaling-stroke"/>}
</g>}
{selectionIds.length>0&&canvasMode==='select'&&multiBounds&&(()=>{const [x,y,w,h]=multiBounds;const cx=x+w/2,cy=y+h/2,[sx,sy]=groupScalePreview;const tx=cx-w*sx/2,ty=cy-h*sy/2;const lift=Math.max(3,9*100/zoom);const moving=objectOffset.some(v=>v!==0)||sx!==1||sy!==1||rotationPreview!==0;return <g pointerEvents="none" transform={`translate(${objectOffset.join(' ')}) rotate(${rotationPreview} ${cx} ${cy})`}>
 {moving&&<g transform={`translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`}>{objects.filter(o=>selectionIds.includes(o.uid)&&o.path).map(o=><path key={o.uid} d={o.path} fill={o.fill_rule?'rgb('+o.color.join(',')+')':'none'} fillRule={o.fill_rule} stroke={'rgb('+o.color.join(',')+')'} strokeWidth={o.stroke_width||.3} opacity=".55"/>)}</g>}
 <rect x={tx} y={ty} width={w*sx} height={h*sy} fill="none" stroke="#754bb0" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>
 {[0,1,2,3].map(i=><circle key={i} cx={tx+(i%2)*w*sx} cy={ty+Math.floor(i/2)*h*sy} r={Math.max(.65,1.2*100/zoom)} fill="white" stroke="#754bb0" vectorEffect="non-scaling-stroke" data-multi-resize={i} pointerEvents={busy?'none':'all'} style={{cursor:i===0||i===3?'nwse-resize':'nesw-resize'}}><title>Stretch selected objects · Shift keeps proportions</title></circle>)}
 <line x1={cx} x2={cx} y1={ty} y2={ty-lift} stroke="#754bb0" vectorEffect="non-scaling-stroke"/><circle cx={cx} cy={ty-lift} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" pointerEvents={busy?'none':'all'} style={{cursor:'grab'}}><title>Rotate selection · Shift snaps to 15°</title></circle></g>})()}
{!selectionIds.length&&selected?.bounds&&canvasMode==='select'&&<g className="studio-selection" pointerEvents="none" transform={selectionTransform+(rotationPreview?` rotate(${rotationPreview} ${selected.bounds[0]+selected.bounds[2]/2} ${selected.bounds[1]+selected.bounds[3]/2})`:'')}>
 {(objectGesture.current||resizePreview||rotationPreview!==0||objectOffset.some(v=>v!==0))&&<path d={selected.path} fill={selected.fill_rule?'#8d53a333':'none'} fillRule={selected.fill_rule}
   stroke="#8d53a3" strokeWidth={selected.stroke_width||.3}/>}
 <rect x={selected.bounds[0]-.6} y={selected.bounds[1]-.6} width={selected.bounds[2]+1.2} height={selected.bounds[3]+1.2}
   fill="none" stroke="#8543aa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4 3"/>
 {resizeHandles.map((handle,index)=><circle key={index} cx={handle.x} cy={handle.y}
   r={Math.max(.65,1.2*100/zoom)} fill="#fff" stroke="#6945a2" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
   data-resize-handle={index} pointerEvents={busy?'none':'all'} style={{cursor:handle.cursor}}>
   <title>{handle.dx&&handle.dy?'Drag corner to stretch · Shift keeps proportions':'Drag side to resize'}</title>
 </circle>)}
<line x1={selected.bounds[0]+selected.bounds[2]/2} x2={selected.bounds[0]+selected.bounds[2]/2} y1={selected.bounds[1]} y2={selected.bounds[1]-Math.max(3,9*100/zoom)} stroke="#754bb0" vectorEffect="non-scaling-stroke"/><circle cx={selected.bounds[0]+selected.bounds[2]/2} cy={selected.bounds[1]-Math.max(3,9*100/zoom)} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" pointerEvents={busy?'none':'all'} style={{cursor:'grab'}}><title>Rotate object · Shift snaps to 15°</title></circle>
</g>}
{inspectorTab==='quality'&&<g pointerEvents="none" aria-label="Quality overlay">{qualityOverlay==='coverage'?objects.filter(o=>qualityObjects.includes(o.uid)&&o.bounds).map(o=><rect key={o.uid} x={o.bounds![0]} y={o.bounds![1]} width={o.bounds![2]} height={o.bounds![3]} fill="#ef4444" fillOpacity=".16" stroke="#dc2626" strokeDasharray="4 2" vectorEffect="non-scaling-stroke"/>):qualityDensity.map(c=><rect key={c.x+','+c.y} x={c.x} y={c.y} width={1} height={1} fill={c.n>=40?'#dc2626':'#f59e0b'} opacity=".65"/>)}</g>}
{!drawing.tool&&<StitchGuideOverlay guides={stitchGuides} zoom={zoom}/>}
</svg>{!plan?.stitches&&!drawing.tool&&<section className="workspace-empty studio-canvas-start" aria-labelledby="canvas-start-title">
  <span className="canvas-start-icon"><SquareDashed size={24}/></span>
  <h2 id="canvas-start-title">Your hoop is ready</h2>
  <p>Bring in artwork or start drawing on the canvas.</p>
  <button className="primary" onClick={openInsertDialog}><FilePlus size={17}/> Browse designs</button>
  <div className="canvas-start-secondary">
    <button onClick={()=>openText()}><Type size={16}/> Add lettering</button>
    <button onClick={()=>drawing.pick('pen')} title="Draw a running path (P)"><PenLine size={16}/> Draw a path</button>
  </div>
</section>}</div>

</article><article ref={inspectorScroll} className="workspace-sidebar workspace-inspector studio-inspector-dock"><div className="inspector-sticky-header"><div className="layers-dock-title"><h2>Inspector</h2>
    <button className="studio-tool-icon" title="Close inspector" aria-label="Close inspector" onClick={()=>setRight(false)}><X size={15}/></button>
  </div>
  <div className="workspace-segments" role="group" aria-label="Inspector">
    <button aria-pressed={inspectorTab==='hoop'} onClick={()=>setInspectorTab('hoop')}><SquareDashed size={15}/>Hoop</button>
    <button aria-pressed={inspectorTab==='sequence'} onClick={()=>setInspectorTab('sequence')}><Waypoints size={15}/>Sequence</button>
    <button aria-pressed={inspectorTab==='threads'} onClick={()=>setInspectorTab('threads')}><Palette size={15}/>Threads</button>
    <button aria-pressed={inspectorTab==='text'} onClick={()=>openText(selectedObject)}><Type size={15}/>Text</button><button aria-pressed={inspectorTab==='transform'} onClick={()=>setInspectorTab('transform')}><Move size={15}/>Edit</button><button aria-pressed={inspectorTab==='stitches'} onClick={()=>setInspectorTab('stitches')}><Scissors size={15}/>Stitches</button><button aria-pressed={inspectorTab==='quality'} onClick={()=>setInspectorTab('quality')}>Quality</button>
  </div>
</div>
  {plan&&<div className="inspector-metrics"><div><small>Stitches</small><strong>{plan.stitches.toLocaleString()}</strong></div><div><small>Trims</small><strong>{plan.trims}</strong></div><div><small>Est. time</small><strong>{Math.ceil(plan.stitches/sewingSpm+plan.trims*trimSeconds/60+Math.max(0,plan.blocks.length-1)*changeSeconds/60)} min</strong></div></div>}
  {inspectorTab==='quality'&&plan&&<div className="workspace-inspector-group"><div className="inspector-actions"><button aria-pressed={qualityOverlay==='coverage'} onClick={()=>setQualityOverlay('coverage')}>Coverage objects</button><button aria-pressed={qualityOverlay==='density'} onClick={()=>setQualityOverlay('density')}>Density map</button></div><small>{qualityOverlay==='coverage'?'Red outlines mark objects with possible missing coverage, not exact gaps.':'Orange/red cells mark 24+ planned needle points per square millimeter.'}</small></div>}
  {inspectorTab==='quality'&&plan&&<QualityInspector width={width} height={height} revision={plan} disabled={busy} onLocate={locateIssue} onRepair={async()=>{if(await confirmAction("Try conservative repair? You can undo the change."))void edit("repair_stitches",{})}}/>}
  {movementIds.length>0&&inspectorTab!=='text'&&<div className="inspector-context">
    <strong title={selected?.label}>{selected?.label||`${movementIds.length} selected`}</strong>
    {movementBounds&&<small>{(movementBounds[2]/25.4).toFixed(2)} × {(movementBounds[3]/25.4).toFixed(2)} in</small>}
  </div>}
  {inspectorTab==='transform'&&recognizingWord&&<small role="status">Recognizing lettering…</small>}{inspectorTab==='transform'&&convertText&&<section className="workspace-inspector-group"><h3><Type size={16}/> Recognized lettering</h3><label>Text<input value={convertWord} disabled={busy} onChange={e=>{setConvertWord(e.target.value);setRecognitionError('');setFailedWord('')}}/></label><SearchChoice label="Font" value={convertFont} options={convertFonts.map(f=>({value:f,label:f}))} onChoose={setConvertFont}/><small>Edits regenerate stitches automatically.</small>{recognitionError&&<div role="alert"><small>{recognitionError}</small><label>Correct original recognition<input value={recognizedOriginal} onChange={e=>{setRecognizedOriginal(e.target.value);setFailedWord('')}}/></label></div>}</section>}{inspectorTab==='transform'&&movementIds.length>0&&<PathToolsDialog count={movementIds.length} disabled={busy}
    onApply={async operation=>(await edit('apply_path_tool',{uids:movementIds,operation})).error}/>}
  {inspectorTab==='transform'&&movementIds.length>0&&<section className="workspace-inspector-group" aria-label="Move selection"><h3><Move size={16}/> Move selection</h3><div className="studio-choice-field"><span>Movement step (mm)</span><div className="studio-choice-row" role="group" aria-label="Movement step in millimeters">{[.1,.5,1,5,10].map(n=><button key={n} aria-pressed={nudgeStep===n} onClick={()=>setNudgeStep(n)}>{n}</button>)}</div></div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,maxWidth:180,margin:'6px auto'}}><span/><button disabled={busy} aria-label="Nudge up" onClick={()=>nudge(0,-nudgeStep)}><ArrowUp size={17}/></button><span/><button disabled={busy} aria-label="Nudge left" onClick={()=>nudge(-nudgeStep,0)}><ArrowLeft size={17}/></button><span style={{textAlign:'center',alignSelf:'center'}}>{nudgeStep} mm</span><button disabled={busy} aria-label="Nudge right" onClick={()=>nudge(nudgeStep,0)}><ArrowRight size={17}/></button><span/><button disabled={busy} aria-label="Nudge down" onClick={()=>nudge(0,nudgeStep)}><ArrowDown size={17}/></button><span/></div><small>Arrow keys move · Shift ×10 · Alt ×0.1</small>{selectionCenter&&<><div className="workspace-hoop-fields"><label>X center (mm)<input type="number" step=".1" value={positionX} onChange={e=>setPositionX(e.target.value)}/></label><label>Y center (mm)<input type="number" step=".1" value={positionY} onChange={e=>setPositionY(e.target.value)}/></label></div><button disabled={busy||!positionX.trim()||!positionY.trim()||!Number.isFinite(Number(positionX))||!Number.isFinite(Number(positionY))} onClick={applyPosition}>Set exact position</button><small>Hoop center is 0, 0 · positive X right, positive Y down.</small></>}</section>}
  {inspectorTab==='transform'&&<section className="workspace-inspector-group multi-align"><h3>{selectionIds.length>1?selectionIds.length+' objects selected':selected?'Object properties':'Design properties'}</h3>{canvasMode==='design'&&designGroups.length>0&&<><label>Design group<select value={activeGroup??''} disabled={busy} onChange={e=>{setActiveGroup(e.target.value||null);setCanvasMode('design');setMulti([]);setSelectedObject(null)}}><option value="">Choose a design</option>{designGroups.map((g,i)=><option key={g.key} value={g.key}>Design {i+1} · {g.members.length} objects</option>)}</select></label>{designGroups.filter(g=>g.key===activeGroup).map(g=><div key={g.key}><small>{g.bounds?(g.bounds[2]/25.4).toFixed(2)+' × '+(g.bounds[3]/25.4).toFixed(2)+' in':''}</small>{g.bounds&&g.bounds[2]>0&&<><label>Target width (in)<input type="number" min=".05" step=".01" value={groupWidth} placeholder={(g.bounds[2]/25.4).toFixed(2)} onChange={e=>setGroupWidth(e.target.value)}/></label><button disabled={busy||!groupWidth||!Number.isFinite(Number(groupWidth))||Number(groupWidth)*25.4/g.bounds[2]<.1||Number(groupWidth)*25.4/g.bounds[2]>10} onClick={()=>{if(g.bounds){void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:Number(groupWidth)*25.4/g.bounds[2],rotation:0});setGroupWidth('')}}}>Apply width proportionally</button></>}<label>Rotate by (degrees)<input type="number" min="-360" max="360" step="1" value={groupRotation} onChange={e=>setGroupRotation(e.target.value)}/></label><button disabled={busy||!Number(groupRotation)||!Number.isFinite(Number(groupRotation))||Math.abs(Number(groupRotation))>360} onClick={()=>{void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:1,rotation:Number(groupRotation)});setGroupRotation('0')}}>Apply rotation</button><div className="alignment-pair">{[{label:'Smaller 10%',scale:.9,rotation:0},{label:'Larger 10%',scale:1.1,rotation:0},{label:'Rotate left',scale:1,rotation:-90},{label:'Rotate right',scale:1,rotation:90}].map(a=><button key={a.label} disabled={busy} onClick={()=>void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:a.scale,rotation:a.rotation})}>{a.label}</button>)}</div><button disabled={busy} onClick={()=>{setMulti(g.members.map(o=>o.uid));setSelectedObject(null);setCanvasMode('select')}}>Select group objects</button><button disabled={busy||g.members.length<2} onClick={()=>{void edit('set_artwork_group',{uids:g.members.map(o=>o.uid),group:false});setActiveGroup(null)}}>Ungroup design</button><details><summary>Group thread colors</summary>{Array.from(new Map(g.members.map(o=>[o.color.join(','),o.color])).values()).map(color=><PaletteRow key={color.join(',')} color={color} count={g.members.filter(o=>o.color.join(',')===color.join(',')).length} disabled={busy} library={threadLibrary} onSelectObjects={()=>{setMulti(g.members.filter(o=>o.color.join(',')===color.join(',')).map(o=>o.uid));setSelectedObject(null);setCanvasMode('select')}} onReplace={next=>void edit('recolor_artwork_group',{uids:g.members.map(o=>o.uid),previous:color,color:next})}/>)}</details></div>)}</>}<details className="studio-inspector-section" open={selectionIds.length>1||snap}><summary>Alignment & snapping</summary><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap to grid, hoop and design edges</label><small>Shift-click objects or layers to select multiple.</small>{selectionIds.length>0&&<><strong>{selectionIds.length} selected</strong><div className="alignment-pair">{[{mode:'center_x',label:'Align X'},{mode:'center_y',label:'Align Y'},{mode:'distribute_x',label:'Distribute X'},{mode:'distribute_y',label:'Distribute Y'}].map(a=><button key={a.mode} disabled={busy||selectionIds.length<(a.mode.startsWith('distribute')?3:2)} onClick={()=>void edit('align_artwork_objects',{uids:selectionIds,mode:a.mode})}>{a.label}</button>)}</div><button disabled={busy||selectionIds.length<2} onClick={()=>{void edit('set_artwork_group',{uids:selectionIds,group:true});setActiveGroup(null);setCanvasMode('design');setMulti([])}}>Group selected objects</button><button onClick={()=>setMulti([])}>Clear selection</button></>}</details></section>}
  {inspectorTab==='text'&&stitchGuides.data?.textForm&&<button disabled={busy} onClick={changeTextForm}>
    {stitchGuides.data.textForm==='text'?'Convert lettering to outlines':'Restore editable text'}
  </button>}
  {inspectorTab==='text'&&<InlineLettering key={textSession} uid={textTarget} disabled={busy} baseline={textBaseline} pickingBaseline={baselinePicking}
    onPickBaseline={()=>{drawing.pick(null);setCanvasMode('select');setPlaying(false);setPlayhead(null);setBaselinePicking(value=>!value)}} onBusy={setBusy} onDone={uid=>{if(uid!==null){setSelectedObject(uid);setLayerTab('objects')}void invoke<Plan|null>('current_preview').then(p=>{if(p){if(p.blocks.length!==plan?.blocks.length||p.blocks.some((b,i)=>b.color.join(',')!==plan?.blocks[i]?.color.join(',')))setThreadAssignments({});setPlan(p);setPlayhead(null);setPlaying(false);setHidden([])}}).catch(e=>setMessage(String(e)))}}/>}
  {inspectorTab==='hoop'&&<section className="workspace-inspector-group">
<h3>Hoop & machine</h3><div className="studio-hoop-summary"><strong>{(width/25.4).toFixed(2)} × {(height/25.4).toFixed(2)} in</strong><small>{selectedMachine?.name||'Manual machine setup'}</small><button onClick={()=>setHoopOpen(true)}>Change hoop or machine</button></div>    <details className="studio-inspector-section"><summary><Clock3 size={15}/> Sewing time estimate</summary><p className="workspace-helper">Adjust to your machine and workflow. Estimated sewing time excludes setup, hooping, bobbin changes and interruptions.</p><label>Effective speed (stitches/min)<input type="number" min="100" max="1500" step="50" value={sewingSpmDraft??String(sewingSpm)} onChange={e=>{setSewingSpmDraft(e.target.value);const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=100&&n<=1500)setSewingSpm(n)}} onBlur={()=>{const n=Number(sewingSpmDraft);if(sewingSpmDraft!==null&&sewingSpmDraft.trim()!==''&&Number.isFinite(n))setSewingSpm(Math.max(100,Math.min(1500,n)));setSewingSpmDraft(null)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();e.stopPropagation()}}/></label><div className="workspace-hoop-fields"><label>Trim (sec)<input type="number" min="0" max="30" value={trimSeconds} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setTrimSeconds(Math.max(0,Math.min(30,n)))}}/></label><label>Color change (sec)<input type="number" min="0" max="120" value={changeSeconds} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setChangeSeconds(Math.max(0,Math.min(120,n)))}}/></label></div><strong>{plan?'Estimated sewing time: '+sewingDuration:'Load a design to estimate time'}</strong></details>
<InspectorDialog label="Export multiple formats" title="Batch format export" disabled={!plan||busy||outside||invalidField||machineExceeded||incompatibleHoop}>
      <p className="workspace-helper">Save the current design in several machine formats in one folder. Existing files are never overwritten.</p>
      <form onSubmit={async e=>{e.preventDefault();const selectedFormats=new FormData(e.currentTarget).getAll('formats').map(String);if(!selectedFormats.length){setMessage('Choose at least one format.');return;}if(editLock.current||busy)return;editLock.current=true;setBusy(true);try{const count=await invoke<number>('export_multiple_formats',{selectedFormats,width,height});if(count)toast('Exported '+count+' machine files.');}catch(error){setMessage(String(error));}finally{editLock.current=false;setBusy(false);}}}>
        {['dst','pes','jef','exp','vp3','pec'].map(ext=><label key={ext} className="inspector-checkbox"><input type="checkbox" name="formats" value={ext} defaultChecked={ext===format}/>{ext.toUpperCase()}</label>)}
        <button disabled={busy||outside||invalidField||machineExceeded||incompatibleHoop}>Choose folder and export</button>
      </form>
    </InspectorDialog>
    <label>Export format<select value={format} onChange={e=>setFormat(e.target.value)}>
      {['dst','pes','jef','exp','vp3','pec'].map(f=><option value={f} key={f}>{f.toUpperCase()}</option>)}
    </select></label>
    {plan&&<div className="inspector-design-info"><h3><Layers3 size={18}/> Design information</h3><dl><dt><Waypoints size={15}/> Stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd><dt><Layers3 size={15}/> Color blocks</dt><dd>{plan.blocks.length}</dd><dt><Scissors size={15}/> Trims</dt><dd>{plan.trims}</dd></dl></div>}{(incompatibleHoop||invalidField)&&<p className="workspace-warning" role="alert">Select a compatible hoop and positive usable dimensions before exporting.</p>}{machineExceeded&&<p className="workspace-warning" role="alert">Selected field exceeds {selectedMachine?.name}: maximum {selectedMachine?.width} × {selectedMachine?.height} mm. Choose a smaller hoop or correct the machine profile.</p>}{outside?<p className="workspace-warning" role="alert">Design exceeds the hoop.</p>:plan&&!machineExceeded&&!incompatibleHoop&&!invalidField&&<div className="workspace-fit-card"><CheckCircle2 size={30}/><div><strong>Fits selected hoop</strong><small>Review export settings before sewing.</small></div></div>}
  </section>}
  {inspectorTab==='sequence'&&<section className="workspace-inspector-group"><h3>Sewing sequence</h3>{plan?.blocks.map((b,i)=><div className="sequence-item" key={i}><span>{i+1}</span><i style={{background:`rgb(${b.color.join(',')})`}}/><strong>{b.runs.reduce((n,r)=>n+r.length,0).toLocaleString()} points</strong></div>)}{!plan&&<p className="workspace-helper">Open a design to see its sewing sequence.</p>}</section>}
  {inspectorTab==='threads'&&<section className="workspace-inspector-group palette-editor"><h3><Palette size={18}/> Design palette</h3>{plan&&<ReferenceColorPanel plan={plan} busy={busy} onApply={(original,colors)=>edit('apply_reference_colors',{original,colors})}/>}<p className="muted">Replace a color everywhere in the design, or edit individual sewing blocks in Layers.</p>{Array.from(new Map((plan?.blocks??[]).map(b=>[b.color.join(','),b.color])).values()).map(color=><PaletteRow key={color.join(',')} color={color} count={plan?.blocks.filter(b=>b.color.join(',')===color.join(',')).length??0} disabled={busy} library={threadLibrary} onSelectObjects={()=>{const ids=objects.filter(o=>o.color.join(',')===color.join(',')).map(o=>o.uid);if(ids.length){setCanvasMode('select');setMulti(ids);setSelectedObject(null);showLayers(true);setLayerTab('objects')}}} onReplace={next=>void edit('replace_design_color',{previous:color,color:next})}/>)}<button onClick={()=>{showLayers(true);setLayerTab('threads')}}>Individual sewing blocks</button></section>}
  {inspectorTab==='stitches'&&<section className="workspace-inspector-group">
    <h3>Generation settings</h3>
    <FabricPicker value={fabric} disabled={busy||!plan||!objects.length}
      onChange={id=>void edit('apply_fabric_profile',{fabric:id})}/>
    <InspectorDialog label="Stitch parameters" title="Stitch parameters" disabled={!plan||busy}>
      <div className="inspector-dialog-fields">
        <div className="inspector-fields">
          {[
            {label:'Row spacing (mm)',value:spacing,set:setSpacing,min:.15,max:2,step:.05},
            {label:'Stitch length (mm)',value:length,set:setLength,min:.5,max:7,step:.1},
            {label:'Fill angle (°)',value:angle,set:setAngle,min:0,max:360,step:5},
            {label:'Pull compensation (mm)',value:pull,set:setPull,min:0,max:1,step:.05},
          ].map(field=><label key={field.label}>{field.label}<input type="number" min={field.min} max={field.max}
            step={field.step} value={field.value} onChange={event=>field.set(Number(event.target.value))}/></label>)}
        </div>
        <label className="inspector-checkbox"><input type="checkbox" checked={underlay}
          onChange={event=>setUnderlay(event.target.checked)}/> Underlay</label>
        <label>Apply settings to<select value={scope} onChange={event=>setScope(event.target.value)}>
          <option value="all">Entire design</option><option value="object" disabled={selectedObject===null}>Selected object</option>
        </select></label>
        <button disabled={!plan||busy||(scope==='object'&&selectedObject===null)}
          onClick={()=>void edit('apply_stitch_properties',{uid:scope==='object'?selectedObject:null,fabric,spacing,length,angle,pull,underlay})}>
          Apply stitch parameters
        </button>
      </div>
    </InspectorDialog>
    <AdvancedStitches object={selected&&!selected.locked&&!selected.hidden?selected:null} disabled={busy}
      onApply={async (uid,settings)=>(await edit('set_advanced_stitches',{uid,settings})).error}/>
    <InspectorDialog label="Sewing commands" title="Trim and stop after objects" disabled={busy||!movementIds.length}>
      <p className="workspace-helper">Apply explicit sewing commands to selected artwork. Automatic restores planner defaults. Verify stops in the exported machine format.</p>
      <div className="workspace-stack">
        {([{label:'Trim after selection',trim:true,stop:null},{label:'Stop after selection',trim:null,stop:true},{label:'Trim and stop',trim:true,stop:true},{label:'Restore automatic commands',trim:null,stop:null}]).map(option=><button key={option.label} disabled={busy||!movementIds.length} onClick={()=>void edit('set_sewing_commands',{uids:movementIds,trim:option.trim,stop:option.stop})}>{option.label}</button>)}
      </div>
    </InspectorDialog>
    <div className="stitch-inspector-shortcuts">
      <button title="Show draggable stitch guides on the canvas" aria-pressed={stitchGuides.visible}
        disabled={busy||!selected} onClick={()=>{drawing.pick(null);stitchGuides.setVisible(!stitchGuides.visible)}}>
        <Waypoints size={15}/> Canvas guides
      </button>
      <button title="Number objects by sewing order" aria-pressed={stitchGuides.order}
        disabled={busy||!plan?.stitches} onClick={()=>stitchGuides.setOrder(!stitchGuides.order)}>
        <Layers3 size={15}/> Sewing order
      </button>
    </div>
    <InspectorDialog label="Object stitch tools" title="Object stitch tools" disabled={busy||!plan}>
      <div className="studio-stitch-tool-groups">
        <section>
        <h3>Canvas guides</h3>
        <div className="studio-stitch-guide-actions">
        <button aria-pressed={stitchGuides.visible} onClick={()=>{drawing.pick(null);stitchGuides.setVisible(!stitchGuides.visible)}}>Show stitch guides</button>
        <button aria-pressed={stitchGuides.order} onClick={()=>stitchGuides.setOrder(!stitchGuides.order)}>Show sewing order</button>
        </div>
        <p className="workspace-helper">Select an object and drag its angle, IN, or OUT marker on the canvas.</p>
        </section>
        <section>
        <h3>Reuse stitch settings</h3>
        <div className="studio-stitch-guide-actions">
        <button disabled={!canCopyStitchSettings||busy} onClick={()=>void copyStitchSettings()}>Copy stitch settings</button>
        <button disabled={!canPasteStitchSettings||busy} onClick={pasteStitchSettings}>Paste stitch settings</button>
        </div>
        <details className="studio-inspector-section">
          <summary>Copy basic settings from another object</summary>
          <p className="workspace-helper">Copies spacing, length, angle, compensation and underlay to the selection.</p>
      <select aria-label="Source stitch settings" defaultValue="" disabled={busy} onChange={e=>{const uid=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(uid))void edit('copy_stitch_properties',{sourceUid:uid,uids:movementIds});e.target.value=''}}>
        <option value="">Choose source artwork…</option>
        {objects.filter(o=>!o.hidden&&o.kind!=='manual'&&o.kind!=='skip'&&!movementIds.includes(o.uid)).map(o=><option key={o.uid} value={o.uid}>{o.label} · {o.kind}</option>)}
      </select>
        </details>
        </section>
        <section>
        <h3>Selection and sewing direction</h3>
        <div className="studio-stitch-guide-actions">
        <button disabled={!selected||busy} onClick={selectSameStitchType}>Select same stitch type</button>
        <button disabled={!stitchGuides.data?.reverses||busy} onClick={reverseStitchPath}>Reverse stitch path</button>
        </div>
        {selected&&(stitchGuides.data?.pinnedEntry||stitchGuides.data?.pinnedExit)&&
          <div className="workspace-stack">
            <button disabled={!stitchGuides.data?.pinnedEntry||busy} onClick={()=>void edit('edit_object_stitch_controls',{uid:selected.uid,action:{type:'entry',point:null}})}>Reset sewing entry</button>
            <button disabled={!stitchGuides.data?.pinnedExit||busy} onClick={()=>void edit('edit_object_stitch_controls',{uid:selected.uid,action:{type:'exit',point:null}})}>Reset sewing exit</button>
          </div>}
        </section>
      </div>
    </InspectorDialog>
    <InspectorDialog label="Embroidery effects" title="Quick stitch effects" disabled={busy||!movementIds.length}>
      <small>Apply a preset to selected compatible objects. Choose the appropriate stitch type first; review the stitch preview before sewing.</small>
      <div className="effect-gallery">{[
        {name:'Bean outline',description:'Triple-pass running stitch',settings:{repeats:3}},
        {name:'Light outline',description:'Single running pass',settings:{repeats:1}},
        {name:'Spiral contour',description:'Continuous contour pattern',settings:{spiral:true}},
        {name:'Contour rings',description:'Concentric contour pattern',settings:{spiral:false}},
        {name:'Classic satin',description:'Plain satin top stitching',settings:{style:'satin',short_stitches:true}},
        {name:'Decorative S-stitch',description:'Patterned satin surface',settings:{style:'s'}},
        {name:'Open zigzag',description:'Open decorative satin pattern',settings:{style:'zigzag'}},
      ].map((effect,i)=><button className="effect-tile" key={effect.name} disabled={busy} onClick={()=>void edit('set_specialty_settings',{uids:movementIds,settings:effect.settings})}><svg viewBox="0 0 120 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">{i<2?<>{Array.from({length:i===0?3:1},(_,j)=><path key={j} d="M8 35 Q32 4 60 24 T112 13" transform={`translate(0,${j-1})`} strokeDasharray="5 2"/>)}</>:i<4?<>{i===2?<path d="M12 24 C12 2 108 2 108 24 S24 46 24 24 S96 9 96 24 S36 38 36 24 S84 16 84 24 S48 30 48 24 L72 24"/>:[0,1,2,3].map(j=><ellipse key={j} cx="60" cy="24" rx={48-j*10} ry={20-j*4}/>)}</>:<polyline points={Array.from({length:i===4?64:i===5?40:22},(_,j)=>{const n=i===4?63:i===5?39:21;return (8+j*104/n)+',' + ((j%2?36:12)+(i===5?Math.sin(j)*3:0))}).join(' ')}/>}</svg><strong>{effect.name}</strong><small>{effect.description}</small></button>)}</div>
    </InspectorDialog>
    <InspectorDialog label="Advanced stitch controls" title="Specialty stitch settings" disabled={busy||!movementIds.length}>
      <p className="workspace-helper">Apply individual settings to selected artwork. Only compatible stitch types use each parameter.</p>
      {movementIds.length===1&&<CurrentStitchOverrides uid={movementIds[0]} plan={plan}/>}
      <details className="studio-inspector-section"><summary>Apply satin underlay</summary><div className="studio-choice-row" role="group" aria-label="Apply satin underlay">{['None','Center walk','Contour walk','Center + contour','Zigzag','Center + zigzag','Contour + zigzag','All three'].map((name,i)=><button key={i} disabled={busy} onClick={()=>void edit('set_specialty_settings',{uids:movementIds,settings:{satin_underlay:i}})}>{name}</button>)}</div></details>
      <div className="studio-choice-field"><span>Satin top pattern</span><div className="studio-choice-row" role="group" aria-label="Apply satin top pattern">{[["satin","Plain"],["s","S-stitch"],["zigzag","Zigzag"]].map(([style,label])=><button key={style} disabled={busy} onClick={()=>void edit("set_specialty_settings",{uids:movementIds,settings:{style}})}>{label}</button>)}</div></div>
      <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const rgb=(name:string)=>String(data.get(name)).slice(1).match(/../g)!.map(v=>parseInt(v,16));void edit('set_specialty_settings',{uids:movementIds,settings:{colors:[rgb('first'),rgb('second')]}})}}>
        <strong>Two-color satin</strong><label>First thread<input name="first" type="color" defaultValue="#6945a2"/></label><label>Second thread<input name="second" type="color" defaultValue="#c5a8e8"/></label><button disabled={busy}>Apply two-color satin</button>
      </form>
      <button disabled={busy} onClick={()=>void edit('set_specialty_settings',{uids:movementIds,settings:{colors:[]}})}>Restore single-color satin</button>
      <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const rgb=(name:string)=>String(data.get(name)).slice(1).match(/../g)!.map(v=>parseInt(v,16));void edit('set_specialty_settings',{uids:movementIds,settings:{sett:[[rgb('first'),Number(data.get('width1'))],[rgb('second'),Number(data.get('width2'))]]}})}}>
        <strong>Tartan stripes</strong><label>First stripe<input name="first" type="color" defaultValue="#244536"/></label><label>Width (mm)<input name="width1" type="number" min=".5" max="20" step=".1" defaultValue="3" required/></label><label>Second stripe<input name="second" type="color" defaultValue="#d4b574"/></label><label>Width (mm)<input name="width2" type="number" min=".5" max="20" step=".1" defaultValue="2" required/></label><button disabled={busy}>Apply tartan stripes</button>
      </form>
      <button disabled={busy} onClick={()=>void edit('set_specialty_settings',{uids:movementIds,settings:{sett:[]}})}>Restore default tartan</button>

      {[{label:'Satin width (mm)',key:'width',min:.2,max:20,step:.1},{label:'Satin split length (0 = off)',key:'split',min:0,max:12,step:.5},{label:'Cross-stitch cell (mm)',key:'cell',min:.5,max:10,step:.1},{label:'Start along outline (0–1)',key:'start',min:0,max:1,step:.05},{label:'End along outline (0–1)',key:'end',min:0,max:1,step:.05}].map(field=><form key={field.key} onSubmit={e=>{e.preventDefault();const value=Number(new FormData(e.currentTarget).get('value'));void edit('set_specialty_settings',{uids:movementIds,settings:{[field.key]:value}})}}><label>{field.label}<input name="value" type="number" required min={field.min} max={field.max} step={field.step}/></label><button disabled={busy}>Apply</button></form>)}
      {[{label:'Running passes',key:'repeats',options:[['Single',1],['Triple / bean',3]]},{label:'Contour pattern',key:'spiral',options:[['Rings',false],['Spiral',true]]},{label:'Satin mode',key:'border',options:[['Column',false],['Border',true]]},{label:'Short stitches',key:'short_stitches',options:[['Off',false],['On',true]]}].map(field=><div key={field.key}><strong>{field.label}</strong><div className="workspace-stack">{field.options.map(([label,value])=><button key={String(label)} disabled={busy} onClick={()=>void edit('set_specialty_settings',{uids:movementIds,settings:{[field.key]:value}})}>{String(label)}</button>)}</div></div>)}
    </InspectorDialog>
    <InspectorDialog label="Sewing order and travel" title="Routing settings" disabled={busy||!objects.length}><RoutingSettings plan={plan} busy={busy} apply={settings=>void edit('set_routing_settings',settings)}/></InspectorDialog>
    <h3>Quality</h3><div className="workspace-stack"><button disabled={busy||!plan?.stitches||!objects.some(o=>o.kind!=='manual'&&o.kind!=='skip')} onClick={openSimplify}>Simplify design</button><small>Compares a conservative alternative and preserves the original if checks fail.</small><button disabled={!plan?.stitches||busy} title={objects.length?"Try conservative source-preserving repair.":"Split long fixed stitches without removing tie stitches."} onClick={async()=>{if(await confirmAction(objects.length?"Try conservative editable artwork repair? You can undo this change.":"Split fixed stitches longer than 10 mm? Original tie stitches are retained. You can undo this change."))void edit("repair_stitches",{})}}>{objects.length?"Repair editable artwork":"Repair fixed stitches"}</button><button disabled={!plan||busy} onClick={audit}>Check stitch quality</button></div>
    <DesignIssuesDialog width={width} height={height} disabled={!plan||busy} onLocate={locateIssue}/>
    <TestSwatchesDialog width={width} height={height} format={format} object={movementIds.length===1?selected??null:null}
      disabled={busy} blocked={invalidField||machineExceeded||incompatibleHoop}/>
    {plan&&<InspectorDialog title="Stitch-length report" label="Stitch-length report">
      <StitchLengthReport blocks={plan.blocks} trims={plan.trims}/>
    </InspectorDialog>}
  </section>}
  {inspectorTab==='transform'&&<section className="workspace-inspector-group">
    <details className="studio-inspector-section" open={movementIds.length===0}><summary>Placement & size</summary><small>Drag handles to resize · Shift preserves proportions.</small><div className="workspace-stack placement-actions"><button onClick={()=>setInspectorTab('stitches')}>Stitch quality</button><button disabled={!plan||busy} title="Move the design to the center of the selected hoop" onClick={()=>edit("center_design",{})}><Scan size={16}/> Center in hoop</button><div className="alignment-pair"><button disabled={!plan||busy} onClick={()=>edit("center_design_axis",{horizontal:true})}>Center horizontally</button><button disabled={!plan||busy} onClick={()=>edit("center_design_axis",{horizontal:false})}>Center vertically</button></div><button disabled={!plan||busy} title="Maximize and center the design with a 2 mm edge margin" onClick={()=>fit()}><Maximize size={16}/> Maximize in hoop</button><button disabled={!plan||busy||invalidField||machineExceeded||incompatibleHoop} title="Stretch width and height to fill hoop · 2 mm edge margin" onClick={()=>fit(true)}><SquareDashed size={16}/> Fill hoop</button><button disabled={!plan||busy} onClick={()=>transform(1,90,0,0)}><RotateCw size={16}/> Rotate 90°</button><button disabled={!plan||busy} title="Mirror the design left to right" onClick={()=>edit("mirror_design",{horizontal:true})}><FlipHorizontal size={16}/> Flip horizontal</button><button disabled={!plan||busy} title="Mirror the design top to bottom" onClick={()=>edit("mirror_design",{horizontal:false})}><FlipVertical size={16}/> Flip vertical</button></div>
    </details><details className="studio-inspector-section"><summary>Precise transformation</summary><div className="workspace-transform-fields"><label>Scale (%)<input type="number" min="10" max="1000" value={scale} onChange={e=>setScale(Number(e.target.value))}/></label><label>Rotation (°)<input type="number" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label><label>Move X (in) <small>({dx.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dx/25.4).toFixed(3))} onChange={e=>{setDx(Number(e.target.value)*25.4)}}/></label><label>Move Y (in) <small>({dy.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dy/25.4).toFixed(3))} onChange={e=>{setDy(Number(e.target.value)*25.4)}}/></label><button disabled={!plan||busy} onClick={()=>transform(scale/100,rotation,dx,dy)}>Apply transform to design</button>
    {selected&&canvasMode==='select'&&<button disabled={busy} onClick={()=>editSelection({kind:'scale',factor:scale/100})}>Scale selected object</button>}</div>
    <p className="workspace-helper">Editable artwork regenerates when resized. Test sew machine-only files after scaling.</p></details>
  </section>}
</article></div><div className="editor-bottom-bar"><div className="playback-tools">
  <button disabled={!points.length} onClick={()=>{if(stitchIndex===points.length)setPlayhead(0);setPlaying(!playing)}}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?"Pause":"Play"}</button>
  <button aria-label="Restart simulation" title="Restart simulation" disabled={!points.length} onClick={()=>{setPlaying(false);setPlayhead(0)}}><RotateCcw size={15}/></button>
  <button title="Previous stitch" aria-label="Previous stitch" disabled={stitchIndex===0} onClick={()=>stepStitch(-1)}><StepBack size={15}/></button>
  <button title="Next stitch" aria-label="Next stitch" disabled={stitchIndex===points.length} onClick={()=>stepStitch(1)}><StepForward size={15}/></button>
  <label><span className="screen-reader-only">Planned stitch position</span><input type="range" min="0" max={points.length} disabled={!points.length} value={stitchIndex} onChange={e=>{setPlaying(false);setPlayhead(Number(e.target.value))}}/></label>
  <select aria-label="Playback speed" value={playbackSpeed} onChange={event=>setPlaybackSpeed(Number(event.target.value))}>
    <option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option><option value={64}>64×</option>
  </select>
  <span className="stitch-playhead">{stitchIndex.toLocaleString()} / {points.length.toLocaleString()}</span>
</div><footer className="workspace-status">{inlineWork&&<span className="inline-work-status" role="status"><span className="inline-work-spinner"/>{inlineWork}</span>}
  <button title="Open hoop settings" onClick={()=>setHoopOpen(true)}><SquareDashed size={16}/>{width>0&&height>0?`Hoop ${(width/25.4).toFixed(2)} × ${(height/25.4).toFixed(2)} in`:'Set a hoop size'}</button>
  {plan&&<div className="status-metrics">{sizePreview&&<span title={`${Math.round(sizePreview.w)} × ${Math.round(sizePreview.h)} mm`}>{sizePreview.active?'Resizing · ':''}{(sizePreview.w/25.4).toFixed(2)} × {(sizePreview.h/25.4).toFixed(2)} in</span>}<span><Waypoints size={16}/>{plan.stitches.toLocaleString()} points</span><span><Layers3 size={16}/>{plan.blocks.length} color blocks</span><span title="Unique RGB thread colors">{uniqueColors} colors</span><span><Scissors size={16}/>{plan.trims} trims</span><button className="sewing-estimate" title={'Estimated machine time at '+sewingSpm+' stitches/min, '+trimSeconds+' seconds per trim and '+changeSeconds+' seconds per block transition. Excludes hooping, setup and interruptions.'} onClick={()=>{showInspector(true);setInspectorTab('hoop')}}><Clock3 size={15}/> Est. {sewingDuration}</button></div>}
  <span className="workspace-fit-status" data-outside={outside}>{outside?'Outside hoop':plan?'Fits hoop · '+recoveryStatus:recoveryStatus}</span>
</footer></div>
  <AssistantChat open={false&&assistantOpen} busy={busy} onRequest={prepareAssistant} onClose={()=>setAssistantOpen(false)}/>

{simplifyOpen&&<div role="presentation" onClick={cancelSimplify} style={{position:'fixed',inset:0,zIndex:1001,background:'#17102266',display:'grid',placeItems:'center'}}><section role="dialog" aria-modal="true" aria-label="Simplify design" aria-busy={busy} onClick={e=>e.stopPropagation()} className="workspace-inspector-group simplify-dialog" style={{background:'var(--panel,#fff)',padding:24,borderRadius:16,width:'min(1120px,94vw)',maxHeight:'85vh',overflow:'auto'}}><header className="simplify-dialog-heading"><h3><Scissors size={18}/> Simplify design</h3><button aria-label={searchingSimplify?undefined:"Close simplification"} disabled={busy&&!searchingSimplify} onClick={cancelSimplify}>{searchingSimplify?"Stop search":<X size={18}/>}</button></header><p>{solidOnly?'Compare a solid fill for the selected artwork. Fine shading may change.':'Reduce sewing time while preserving artwork outlines, lettering and thread order. Test sew before production.'}</p>{solidOnly&&solidColor&&<div className="studio-soft-area-tools">
  <label>Fill thread color <input type="color" value={'#'+solidColor.map(value=>value.toString(16).padStart(2,'0')).join('')}
    disabled={busy} onChange={event=>{
      const next=[1,3,5].map(index=>parseInt(event.target.value.slice(index,index+2),16));
      setSolidColor(next);
      void simplify('selection',false,true,solidIds,next);
    }}/></label>
</div>}{!solidOnly&&simplifyBefore&&<section aria-label="Optimization goal" style={{border:'1px solid var(--border,#a99bb966)',borderRadius:12,padding:14,display:'grid',gap:10}}>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}><strong>Optimization goal</strong><div className="studio-choice-row" role="group" aria-label="Optimization focus">{([["both","Both"],["time","Time"],["stitches","Stitches"]] as const).map(([value,label])=><button key={value} disabled={busy} aria-pressed={targetMetric===value} onClick={()=>setTargetMetric(value)}>{label}</button>)}</div></div>
<div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}><label style={{flex:'1 1 220px'}}>Reduction target <input aria-label="Reduction target" type="range" min="10" max="70" step="5" value={targetReduction} disabled={busy} onChange={e=>{setTargetReduction(Number(e.target.value));setTargetMinutes('')}}/></label><label>Percent <input aria-label="Reduction percentage" type="number" min="10" max="70" step="5" value={targetReduction} disabled={busy} onChange={e=>{setTargetReduction(Math.min(70,Math.max(10,Number(e.target.value)||10)));setTargetMinutes('')}} style={{width:75}}/>%</label>{[25,40,50,60].map(n=><button key={n} disabled={busy} aria-pressed={targetReduction===n} onClick={()=>{setTargetReduction(n);setTargetMinutes('')}}>{n}%</button>)}</div>
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8}}>{targetMetric!=='time'&&<div><small>Target stitch count</small><div><strong>{Math.floor(simplifyBefore.stitches*(1-targetReduction/100)).toLocaleString()}</strong> / {simplifyBefore.stitches.toLocaleString()}</div></div>}{targetMetric!=='stitches'&&<div><small>Target sewing time</small><div><strong>{(Number(targetMinutes)>0?Number(targetMinutes):(simplifyBefore.stitches/sewingSpm+simplifyBefore.trims*trimSeconds/60+Math.max(0,simplifyBefore.blocks.length-1)*changeSeconds/60)*(1-targetReduction/100)).toFixed(1)} min</strong></div></div>}</div>
<label>Exact target stitches <input type="number" min={1} max={simplifyBefore.stitches} value={Math.floor(simplifyBefore.stitches*(1-targetReduction/100))} disabled={busy} onChange={e=>{const n=Number(e.target.value);if(n>0)setTargetReduction(Math.max(0,Math.min(99.99,100*(1-n/simplifyBefore.stitches))))}}/></label><small>Targets guide the search; artwork protection still applies. Changing a goal does not alter existing previews.</small>{simplifyReview&&<button disabled={busy} onClick={()=>void simplify(simplifyScope,false,false,solidIds,null,true,true)}>Optimize for this goal</button>}</section>}{!solidOnly&&!simplifyReview&&<section className="simplify-advanced"><strong>Smart Simplify · Offline</strong><div role="group" aria-label="Simplification mode" style={{display:'flex',flexWrap:'wrap',gap:4,margin:'8px 0'}}>{(['light','balanced','aggressive','maximum'] as const).map(mode=><button key={mode} type="button" aria-pressed={smartMode===mode} className={smartMode===mode?'primary':''} disabled={busy} onClick={()=>{setSmartMode(mode);setAppearanceFloor(({light:97,balanced:93,aggressive:85,maximum:65})[mode]);setSolidMode(mode==='aggressive'||mode==='maximum');setTargetReduction(({light:15,balanced:30,aggressive:50,maximum:65})[mode]);setLighterUnderlay(mode==='maximum');}}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}</div><label>Preserve appearance · {appearanceFloor}%<input type="range" min={65} max={100} value={appearanceFloor} disabled={busy} onChange={e=>setAppearanceFloor(Number(e.target.value))}/></label><small>{({light:'Minor stitch cleanup',balanced:'Preserve most artwork',aggressive:'Rebuild decorative texture',maximum:'Search for the lowest practical sewing cost'})[smartMode]}</small></section>}{!solidOnly&&<details className="simplify-advanced"><summary>Adjust optimization options · {simplifyScope==='selection'?'Selected objects':'Entire design'}</summary><label>Apply to<select value={simplifyScope} disabled={busy||!!simplifyReview} onChange={e=>setSimplifyScope(e.target.value as 'all'|'selection')}><option value="all">Entire design</option><option value="selection" disabled={!movementIds.length}>Selected objects ({movementIds.length})</option></select></label><label><input type="checkbox" checked={simplifyDetail} disabled={busy||!!simplifyReview} onChange={e=>setSimplifyDetail(e.target.checked)}/> Remove tiny decorative details</label><small>Optional: may remove small marks and change artwork appearance. Review the canvas before sewing.</small><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8,padding:'10px 0'}}><label><input type="checkbox" checked={solidMode} disabled={busy||!!simplifyReview} onChange={e=>setSolidMode(e.target.checked)}/> Solid artwork · close narrow texture gaps</label><label><input type="checkbox" checked={mergeShapes} disabled={busy||!!simplifyReview} onChange={e=>setMergeShapes(e.target.checked)}/> Merge compatible overlapping shapes</label><label><input type="checkbox" checked={autoTypes} disabled={busy||!!simplifyReview} onChange={e=>setAutoTypes(e.target.checked)}/> Automatically select stitch types</label><label><input type="checkbox" checked={lighterUnderlay} disabled={busy||!!simplifyReview} onChange={e=>setLighterUnderlay(e.target.checked)}/> Try lighter satin underlay</label></div><label>Target sewing time (minutes, optional)<input type="number" min="1" step="1" placeholder="Best available improvement" value={targetMinutes} disabled={busy||!!simplifyReview} onChange={e=>setTargetMinutes(e.target.value)}/></label><small>Uses your machine speed and trim time. A target is a goal, not a guarantee. Solid artwork and lighter underlay can change the sewn appearance.</small></details>}{simplifyReview&&!solidOnly&&<p className="simplify-recommendation">{simplifyRecommended?'Recommended: '+['Original','Gentle','Balanced','Maximum','Solid silhouette','Fast Stitch','Aggressive texture reduction'][simplifyRecommended]+' · fastest eligible plan with at least 85% footprint overlap.':'Original recommended · no preview qualified for automatic selection.'} You may choose another preview.</p>}{searchingSimplify&&<section className="simplify-loading" role="status" aria-live="polite"><div className="simplify-spinner" aria-hidden="true"/><div><strong>Generating stitch previews</strong><p>Analyzing artwork and generating stitch plan candidates. Your original design is unchanged.</p><div className="simplify-progress" aria-hidden="true"><span/></div><small>Stop the search at any time. Finished previews are available when the search returns.</small></div></section>}{simplifyBefore&&simplifyReview&&<SimplificationGallery before={simplifyBefore} variants={simplifyReview.variants} selected={simplifyLevel} recommended={simplifyRecommended} onSelect={setSimplifyLevel} speed={sewingSpm} trim={trimSeconds} change={changeSeconds} target={targetMetric==='stitches'?0:Number(targetMinutes)>0?Number(targetMinutes):(simplifyBefore.stitches/sewingSpm+simplifyBefore.trims*trimSeconds/60+Math.max(0,simplifyBefore.blocks.length-1)*changeSeconds/60)*(1-targetReduction/100)} targetStitches={targetMetric==='time'?0:Math.floor(simplifyBefore.stitches*(1-targetReduction/100))}/>}
{simplifyReview&&simplifyLevel!==0&&simplifyReview.variants.find(v=>v.strength===simplifyLevel)?.artwork_svg&&<details className="simplify-advanced"><summary>Inspect simplified artwork</summary><div style={{display:'flex',justifyContent:'center',background:'#fff',borderRadius:8,padding:8,marginTop:8}}><img alt="Reconstructed artwork for selected simplification candidate" style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}} src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(simplifyReview.variants.find(v=>v.strength===simplifyLevel)?.artwork_svg??'')}/></div><small>This is the editable geometry of the selected candidate, before applying it to your design.</small></details>}
{simplifyBefore&&!simplifyReview&&<p>Original: {simplifyBefore.stitches.toLocaleString()} stitch points · {simplifyBefore.trims} trims. Compare stitch plans without changing the design.</p>}
{simplifyLimited&&<p role="status">Search time limit reached. Review the available previews.</p>}{simplifyError&&<p role="alert">{simplifyError}</p>}<div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>{simplifyReview&&!solidOnly&&!simplifyReview.variants.some(v=>v.strength>=4)&&<button disabled={busy} onClick={()=>void simplify(simplifyScope,false,false,solidIds,null,true)}>Deep optimization</button>}{simplifyReview&&!solidOnly&&<button disabled={busy} title="Rebuild traced texture; appearance and thread sequence may change" onClick={()=>void simplify(simplifyScope,false,false,solidIds,null,true,false,true)}>Aggressive texture reduction</button>}{simplifyReview&&!solidOnly&&<button disabled={busy} onClick={()=>setSimplifyReview(null)}>Change options</button>}{!searchingSimplify&&<button disabled={busy} onClick={cancelSimplify}>Cancel</button>}{simplifyReview?<button className="primary" disabled={busy||(simplifyLevel!==0&&!simplifyReview.variants.some(v=>v.strength===simplifyLevel&&v.plan))} onClick={()=>simplifyLevel===0?setSimplifyOpen(false):void applySimplify()}>{simplifyLevel===0?'Keep original':'Apply selected design'}</button>:<button className="primary" disabled={busy} onClick={()=>void (solidOnly?simplify():simplify(simplifyScope,false,false,solidIds,null,smartMode==='maximum'||smartMode==='aggressive',smartMode==='maximum',smartMode==='maximum'||smartMode==='aggressive'))}>{busy?'Generating stitch previews…':solidOnly?'Retry solid fill':'Generate smart previews'}</button>}</div></section></div>}
{hoopOpen&&<div className="studio-modal-scrim" onClick={()=>setHoopOpen(false)}><section className="studio-modal workspace-inspector-group" role="dialog" aria-modal="true" aria-label="Hoop and machine settings" onClick={e=>e.stopPropagation()}><header><strong>Hoop & machine</strong><button aria-label="Close hoop settings" onClick={()=>setHoopOpen(false)}><X size={18}/></button></header>    <SearchChoice label="Machine" value={machine} options={[{value:"",label:"Manual setup"},...machines.map(m=>({value:m.id,label:m.name}))]} onChoose={value=>{setMachine(value);const m=machines.find(p=>p.id===value);const preferred=hoops.find(h=>h.id===hoop&&hoopFits(h,m))||hoops.find(h=>h.id===localStorage.getItem("studio-default-hoop")&&hoopFits(h,m));if(preferred){setHoop(preferred.id);setWidth(preferred.width);setHeight(preferred.height)}else{setHoop("");if(m){setWidth(m.width);setHeight(m.height)}}if(m?.format)setFormat(m.format.toLowerCase())}}/><SearchChoice label="Saved hoop" value={hoop} options={[{value:"",label:"Custom dimensions"},...compatibleHoops.map(h=>({value:h.id,label:`${h.name} — ${h.width} × ${h.height} mm`}))]} onChoose={value=>{setHoop(value);const h=hoops.find(p=>p.id===value);if(h){setWidth(h.width);setHeight(h.height)}}}/>{selectedMachine&&<small>{compatibleHoops.length} compatible saved hoops · {hoops.length-compatibleHoops.length} excluded by field size or mounting assignment.</small>}<div className="workspace-hoop-fields"><label>Width (in) <small>({width.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((width/25.4).toFixed(3))} onChange={e=>{setHoop("");setWidth(Number(e.target.value)*25.4)}}/></label><label>Height (in) <small>({height.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((height/25.4).toFixed(3))} onChange={e=>{setHoop("");setHeight(Number(e.target.value)*25.4)}}/></label></div>
<p className="muted">Enter the usable sewing field, not the outer dimensions of the hoop.</p>{(invalidField||machineExceeded||incompatibleHoop)&&<p role="alert">Check the machine and hoop dimensions.</p>}<div className="studio-modal-actions"><button onClick={()=>{setHoopOpen(false);setZoom(100);setPan([0,0])}}>Done</button><button className="primary" disabled={!plan||busy||invalidField||machineExceeded||incompatibleHoop} onClick={()=>{setHoopOpen(false);fit(false)}}>Maximize design in hoop</button></div></section></div>}
{pricingOpen&&plan&&<div className="pricing-modal-backdrop" onClick={()=>setPricingOpen(false)}><section role="dialog" aria-modal="true" aria-label="Job pricing calculator" className="pricing-modal" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setPricingOpen(false);e.stopPropagation()}}><div className="pricing-modal-title"><h2>Price current design</h2><button autoFocus aria-label="Close pricing calculator" onClick={()=>setPricingOpen(false)}><X size={18}/></button></div><PricingCalculator design={{name:plan.name,stitches:plan.stitches,minutes:sewingEstimate/60,objects}}/></section></div>}{exportOpen&&plan&&<ExportCenter assignments={threadAssignments} plan={plan} width={width} height={height} format={format} setFormat={setFormat} machine={machines.find(m=>m.id===machine)?.name||""} blocked={outside||machineExceeded||incompatibleHoop||invalidField} busy={busy} onExport={save} onClose={()=>setExportOpen(false)}/>}{message&&<p role="status">{message}</p>}</>}

function SearchChoice({label,value,options,onChoose}:{label:string;value:string;options:{value:string;label:string}[];onChoose:(value:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const filtered=options.filter(o=>matchesName(o.label,query));
 return <div className="studio-search-choice"><span>{label}</span><button type="button" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setQuery('')}}>{options.find(o=>o.value===value)?.label||'Choose…'}</button>{open&&<div className="studio-search-options" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false)}}}><input autoFocus type="search" aria-label={'Search '+label} placeholder="Search…" value={query} onChange={e=>setQuery(e.target.value)}/><div role="group" aria-label={label+' options'}>{filtered.map(o=><button type="button" key={o.value} aria-pressed={o.value===value} onClick={()=>{onChoose(o.value);setOpen(false)}}>{o.label}</button>)}{!filtered.length&&<small>No matches</small>}</div></div>}</div>
}

function PaletteRow({color,count,disabled,library,onSelectObjects,onReplace}:{color:number[];count:number;disabled:boolean;library:ReturnType<typeof readThreads>;onSelectObjects:()=>void;onReplace:(color:number[])=>void}){
 const original='#'+color.map(v=>v.toString(16).padStart(2,'0')).join('');
 const [value,setValue]=useState(original);
 const [expanded,setExpanded]=useState(false);
 return <article className="palette-edit-row"><button className="palette-row-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><i style={{backgroundColor:original}}/><span><strong>{original.toUpperCase()}</strong><small>{count} sewing {count===1?'block':'blocks'}</small></span><Palette size={16}/></button>{expanded&&<div className="palette-row-controls"><button disabled={disabled} onClick={onSelectObjects}>Select matching objects</button><label>Replacement color<input type="color" value={value} onChange={e=>setValue(e.target.value)}/></label><div className="inline-color-presets">{['#111111','#ffffff','#754bb0','#ae294f','#24558c','#34754b','#d5a52e'].map(v=><button key={v} aria-label={'Choose '+v} aria-pressed={value===v} style={{backgroundColor:v}} onClick={()=>setValue(v)}/>)}</div>{!!library.length&&<SearchChoice label="Saved thread" value="" options={library.map(t=>({value:t.id,label:t.brand+' '+t.code+' '+t.name}))} onChoose={id=>{const t=library.find(t=>t.id===id);if(t)setValue(t.color)}}/>}<button className="primary" disabled={disabled||value===original} onClick={()=>onReplace([1,3,5].map(i=>parseInt(value.slice(i,i+2),16)))}>Replace all {count} {count===1?'block':'blocks'}</button></div>}</article>
}

function SimplificationGallery({before,variants,selected,recommended,onSelect,speed,trim,change,target,targetStitches}:{before:Plan;variants:{artwork_svg?:string|null;strength:number;plan:Plan|null;reason:string|null;quality?:{coverage:number;density_peak:number;seconds:number}|null}[];selected:number;recommended:number;onSelect:(n:number)=>void;speed:number;trim:number;change:number;target:number;targetStitches:number}){
 const bounds=useMemo(()=>{let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;for(const plan of [before,...variants.flatMap(v=>v.plan?[v.plan]:[])])for(const block of plan.blocks)for(const run of block.runs)for(const p of run){x=Math.min(x,p[0]);y=Math.min(y,p[1]);r=Math.max(r,p[0]);b=Math.max(b,p[1]);}return Number.isFinite(x)?[x-3,y-3,Math.max(6,r-x+6),Math.max(6,b-y+6)].join(' '):'0 0 100 100'},[before,variants]);
 const time=(p:Plan)=>p.stitches/speed+p.trims*trim/60+Math.max(0,p.blocks.length-1)*change/60;
 const cards=[{strength:0,plan:before,reason:null,quality:null},...variants];
 return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>{cards.map(v=>{const p=v.plan;const name=['Original','Gentle','Balanced','Maximum','Solid silhouette','Fast Stitch','Aggressive texture reduction'][v.strength];return <div key={v.strength} style={{border:v.strength===selected?'2px solid #8055b4':'1px solid #a99bb966',borderRadius:10,padding:10,display:'grid',gap:6}}><strong>{name}{v.strength===recommended?' · Recommended':''}</strong>{p?<><svg viewBox={bounds} style={{width:'100%',height:170,background:'#faf7f0',borderRadius:6}} aria-label={name+' stitch preview'}>{p.blocks.map((block,j)=><g key={j} stroke={'rgb('+block.color.join(',')+')'} strokeWidth=".28" fill="none" strokeLinecap="round" strokeLinejoin="round">{block.runs.map((run,k)=><polyline key={k} points={run.map(p=>p.join(',')).join(' ')}/>)}</g>)}</svg><strong>{p.stitches.toLocaleString()} stitches</strong><small>{p.trims} trims · Est. {Math.ceil(time(p))} min</small>{v.strength===0&&<button aria-pressed={selected===0} onClick={()=>onSelect(0)}>{selected===0?'Selected':'Keep original'}</button>}{v.strength>0&&<><small>{Math.round(Math.abs(before.stitches-p.stitches)*100/Math.max(1,before.stitches))}% {p.stitches<=before.stitches?'fewer':'more'} stitches · {Math.abs(Math.round(time(before)-time(p)))} min {time(p)>time(before)?'longer':'saved'}</small>{v.quality&&<small>{Math.round(v.quality.coverage)}% stitch footprint overlap · peak {v.quality.density_peak}/mm²</small>}{target>0&&<small>{Math.round((1-time(p)/Math.max(.01,time(before)))*100)}% time reduction · {time(p)<=target?'Time goal met':'Time goal not met'}</small>}{targetStitches>0&&<small>{p.stitches<=targetStitches?'Stitch goal met':(p.stitches-targetStitches).toLocaleString()+' stitches above goal'}</small>}<button aria-pressed={selected===v.strength} onClick={()=>onSelect(v.strength)}>{selected===v.strength?'Selected':'Choose '+name}</button></>}</>:<><small>No eligible improvement</small><small>{v.reason}</small></>}</div>})}</div>
}

function CurrentStitchOverrides({uid,plan}:{uid:number;plan:Plan|null}){
 const [values,setValues]=useState<Record<string,unknown>|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{let live=true;setValues(null);setError('');void invoke<Record<string,unknown>>('get_specialty_settings',{uid}).then(v=>{if(live)setValues(v)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[uid,plan]);
 const labels:Record<string,string>={width:'Satin width',split:'Split length',repeats:'Running passes',cell:'Cross-stitch cell',spiral:'Spiral',border:'Border',short_stitches:'Short stitches',start:'Start',end:'End',satin_underlay:'Underlay mask',colors:'Satin colors',sett:'Tartan stripes',spacing:'Spacing',length:'Length',angle:'Angle',pull:'Pull compensation',underlay:'Underlay'};
 return <details className="studio-inspector-section"><summary>Current object settings</summary>{error?<p role="alert">{error}</p>:!values?<p>Loading settings…</p>:<dl>{Object.entries(labels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{values[key]==null?'Automatic':typeof values[key]==='boolean'?(values[key]?'On':'Off'):typeof values[key]==='object'?JSON.stringify(values[key]):String(values[key])}</dd></div>)}</dl>}</details>
}

function RoutingSettings({plan,busy,apply}:{plan:Plan|null;busy:boolean;apply:(settings:{hatOrder:boolean;connectMm:number;removeOverlaps:boolean})=>void}){
 const [settings,setSettings]=useState<{hatOrder:boolean;connectMm:number;removeOverlaps:boolean}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{let live=true;setSettings(null);setError('');void invoke<{hatOrder:boolean;connectMm:number;removeOverlaps:boolean}>('get_routing_settings').then(v=>{if(live)setSettings(v)}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[plan]);
 if(!settings)return <p>{error||'Loading routing settings…'}</p>;
 return <form onSubmit={e=>{e.preventDefault();apply(settings)}}>
 <label><input type="checkbox" checked={settings.hatOrder} onChange={e=>setSettings({...settings,hatOrder:e.target.checked})}/>Cap sewing order</label>
 <small>Use the engine's cap-specific sewing sequence. Verify on a sample cap.</small>
 <label>Connect gaps up to (mm)<input type="number" min="0" max="5" step=".1" required value={settings.connectMm} onChange={e=>setSettings({...settings,connectMm:Number(e.target.value)})}/></label>
 <small>Zero disables sewn connections. Larger values can leave visible travel stitches.</small>
 <label><input type="checkbox" checked={settings.removeOverlaps} onChange={e=>setSettings({...settings,removeOverlaps:e.target.checked})}/>Remove covered overlapping stitches</label>
 <button disabled={busy}>Apply and regenerate</button>
 </form>
}
