import {assistantIntent} from './assistant-intent';
import {rememberProject,thumbnailOf,type Project} from './library';
import {InlineLettering} from './lettering';
import {Type,Clock3,Sparkles} from 'lucide-react';
import {GarmentPreview} from './garment-preview';
import {ThreadOrder,ReferenceColorPanel,type ThreadAssignments} from './thread-order';
import {FabricPicker} from './fabric-picker';
import {ListNavigation,matchesName,usePagedList} from './list-navigation';
import {CommandPalette,type Command} from './command-palette';
import {InsertDesignDialog} from './insert-design-dialog';
import {confirmAction,toast} from './dialogs';
import {ExportCenter} from './export-center';
import {readThreads} from './threads';
import {StitchPicker} from './stitch-guide';
import {useState,useEffect,useRef,useMemo,type PointerEvent as ReactPointerEvent} from 'react';
import {Save,Undo2,Redo2,FolderOpen,Download,RotateCw,Move,Maximize,Play,Pause,Eye,EyeOff,PanelLeft,PanelRight,ZoomIn,ZoomOut,Grid,Scan,FlipHorizontal,FlipVertical,FilePlus,Layers3,SquareDashed,Scissors,RotateCcw,Minimize,Menu,StepBack,StepForward,MousePointer2,Hand,Copy,Trash2,GripHorizontal,Search,X,Waypoints,Group,Shapes,Wrench,Palette,MoreHorizontal,CheckCircle2} from 'lucide-react';
import {invoke,isTauri} from '@tauri-apps/api/core';
type Plan={name:string;stitches:number;trims:number;blocks:{color:number[];runs:number[][][]}[]};
type EditableObject={uid:number;groups?:string[];label:string;color:number[];kind:string;bounds?:[number,number,number,number];path?:string;fill_rule?:'evenodd'|'nonzero';stroke_width?:number};
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
export function Editor({beginner=true,navigation=[]}:{beginner?:boolean;navigation?:Command[]}){const insertDialog=useRef<HTMLDialogElement>(null);const [focusCanvas,setFocusCanvas]=useState(false);
const fullscreenRequested=useRef(false);
useEffect(()=>()=>{if(fullscreenRequested.current&&isTauri())void invoke('set_canvas_fullscreen',{fullscreen:false}).catch(()=>{});},[]);
const panelsBeforeFocus=useRef<{left:boolean;right:boolean}|null>(null);
const [left,setLeft]=useState(true),[right,setRight]=useState(true),[leftWidth,setLeftWidth]=useState(()=>panelWidth("studio-layers-width",280,160,340)),[rightWidth,setRightWidth]=useState(()=>panelWidth("studio-properties-width",420,180,460));useEffect(()=>{localStorage.setItem("studio-layers-width",String(leftWidth));localStorage.setItem("studio-properties-width",String(rightWidth))},[leftWidth,rightWidth]);const [zoom,setZoom]=useState(100),[pan,setPan]=useState([0,0]),[drag,setDrag]=useState<{x:number;y:number;px:number;py:number}|null>(null),[grid,setGrid]=useState(true),[realistic,setRealistic]=useState(true);const [exportOpen,setExportOpen]=useState(false);const [threadAssignments,setThreadAssignments]=useState<ThreadAssignments>({});const [threadLibrary]=useState(readThreads);const [recoveryStatus,setRecoveryStatus]=useState('');const [scope,setScope]=useState('all');const [fabric,setFabric]=useState('standard'),[spacing,setSpacing]=useState(.35),[length,setLength]=useState(3),[angle,setAngle]=useState(0),[pull,setPull]=useState(.15),[underlay,setUnderlay]=useState(true);const [objects,setObjects]=useState<EditableObject[]>([]),[objectQuery,setObjectQuery]=useState(''),[selectedObject,setSelectedObject]=useState<number|null>(null),[objectKind,setObjectKind]=useState('auto');const [layerTab,setLayerTab]=useState<'objects'|'threads'>('threads');
const resizePanel=useRef<{side:'left'|'right';start:number;width:number;pointer:number}|null>(null);
function panelResizeHandle(side:'left'|'right'){
 const value=side==='left'?leftWidth:rightWidth;
 const min=side==='left'?160:180,max=side==='left'?340:460;
 const change=(next:number)=>(side==='left'?setLeftWidth:setRightWidth)(Math.max(min,Math.min(max,next)));
 return <div className={'studio-panel-resizer resize-'+side} role="separator" aria-label={side==='left'?'Resize layers panel':'Resize inspector panel'} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} onPointerDown={e=>{if(e.button!==0)return;resizePanel.current={side,start:e.clientX,width:value,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault()}} onPointerMove={e=>{const drag=resizePanel.current;if(drag?.pointer===e.pointerId&&drag.side===side)change(drag.width+(e.clientX-drag.start)*(side==='left'?1:-1))}} onLostPointerCapture={()=>{resizePanel.current=null}} onPointerCancel={()=>{resizePanel.current=null}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change(value+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*10)}else if(e.key==='Home'||e.key==='End'){e.preventDefault();change(e.key==='Home'?min:max)}}}/>;
}
const [canvasMode,setCanvasMode]=useState<'pan'|'select'|'design'>('design');
const [objectOffset,setObjectOffset]=useState<[number,number]>([0,0]);
const [resizePreview,setResizePreview]=useState<ResizeOperation|null>(null);
const [designOffset,setDesignOffset]=useState<[number,number]>([0,0]);
const designGesture=useRef<{pointer:number;x:number;y:number;uids?:number[]}|null>(null);
const [activeGroup,setActiveGroup]=useState<string|null>(null);
const groupResizeGesture=useRef<{pointer:number;uids:number[];cx:number;cy:number;x:number;y:number}|null>(null);
const [groupScalePreview,setGroupScalePreview]=useState(1);
const rotationGesture=useRef<{pointer:number;uids:number[];cx:number;cy:number;start:number}|null>(null);
const [rotationPreview,setRotationPreview]=useState(0);
const [showDirections,setShowDirections]=useState(false);

function rotationAt(position:DOMPoint,shift:boolean){const g=rotationGesture.current;if(!g)return 0;let degrees=(Math.atan2(position.y-g.cy,position.x-g.cx)-g.start)*180/Math.PI;degrees=((degrees+540)%360)-180;return shift?Math.round(degrees/15)*15:degrees}

function groupScaleAt(position:DOMPoint){const g=groupResizeGesture.current;if(!g)return 1;const x=g.x-g.cx,y=g.y-g.cy;return Math.max(.1,Math.min(10,((position.x-g.cx)*x+(position.y-g.cy)*y)/Math.max(.0001,x*x+y*y)))}
const [groupWidth,setGroupWidth]=useState(''),[groupRotation,setGroupRotation]=useState('0');
useEffect(()=>{setGroupWidth('');setGroupRotation('0')},[activeGroup]);
const designGroups=useMemo(()=>{const map=new Map<string,EditableObject[]>();for(const o of objects){const key=o.groups?.find(g=>g.startsWith('tl-custom-group-')||g.startsWith('tl-independent-'))||o.groups?.find(g=>g.startsWith('tl-added-'))||o.groups?.find(g=>g.startsWith('tl-lettering-'))||'original';const list=map.get(key)||[];list.push(o);map.set(key,list)}return Array.from(map,([key,members])=>{const b=members.flatMap(o=>o.bounds?[o.bounds]:[]);if(!b.length)return {key,members,bounds:null};const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return {key,members,bounds:[x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]}})},[objects]);
const independentGroups=designGroups.length>1;
const resizeGesture=useRef<{uid:number;pointer:number;handle:ResizeHandle;anchorX:number;anchorY:number}|null>(null);
const objectGesture=useRef<{uid:number;x:number;y:number;pointerId:number}|null>(null);
const selected=objects.find(object=>object.uid===selectedObject);
const [multi,setMulti]=useState<number[]>([]);const [snap,setSnap]=useState(false);const [context,setContext]=useState<{uid:number;x:number;y:number}|null>(null);
const selectionIds=multi.filter(id=>objects.some(o=>o.uid===id));
const multiBounds=useMemo(()=>{const b=objects.filter(o=>multi.includes(o.uid)&&o.bounds).map(o=>o.bounds!);if(!b.length)return null;const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y]},[objects,multi]);

function toggleMulti(uid:number){setCanvasMode('select');setMulti(old=>{const base=old.length?old:selectedObject!==null?[selectedObject]:[];return base.includes(uid)?base.filter(i=>i!==uid):[...base,uid]});setRight(true);setInspectorTab('transform');setLayerTab('objects')}
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
const [inspectorTab,setInspectorTab]=useState<'hoop'|'stitches'|'transform'|'sequence'|'threads'|'text'|'assistant'>('hoop');const [assistantText,setAssistantText]=useState('');const [assistantReply,setAssistantReply]=useState('Describe a supported edit, or choose a suggestion. No model or internet required.');const [textTarget,setTextTarget]=useState<number|null>(null);const [textSession,setTextSession]=useState(0);function openText(uid:number|null=null){setTextTarget(uid);setTextSession(n=>n+1);setRight(true);setInspectorTab('text')};
const [advanced,setAdvanced]=useState(!beginner);const [hoops]=useState(()=>profiles('studio-hoops',[{id:'100',name:'4 × 4 inch',width:100,height:100},{id:'130',name:'5 × 7 inch',width:130,height:180}])),[machines]=useState(()=>profiles('studio-machines',[])),[machine,setMachine]=useState(()=>localStorage.getItem('studio-default-machine')||''),[hoop,setHoop]=useState(()=>localStorage.getItem('studio-default-hoop')||'');const [plan,setPlan]=useState<Plan|null>(null),[format,setFormat]=useState('dst'),[width,setWidth]=useState(130),[height,setHeight]=useState(180),[playhead,setPlayhead]=useState<number|null>(null),[playbackSpeed,setPlaybackSpeed]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[artWidth,setArtWidth]=useState(80),[colors,setColors]=useState(0),[removeBackground,setRemoveBackground]=useState(true),[detail,setDetail]=useState(60),[playing,setPlaying]=useState(false),[scale,setScale]=useState(100),[rotation,setRotation]=useState(0),[dx,setDx]=useState(0),[dy,setDy]=useState(0),[hidden,setHidden]=useState<number[]>([]);
async function audit(){try{const a=await invoke<{short:number;long:number;zero:number;segments:number}>('audit_stitches');setMessage('Stitch audit: '+a.segments+' segments · '+a.short+' short · '+a.long+' long · '+a.zero+' near-zero. Review before production.')}catch(e){setMessage(String(e))}}
const editLock=useRef(false);const [inlineWork,setInlineWork]=useState('');
async function edit(command:string,args:Record<string,unknown>){if(editLock.current||busy)return;editLock.current=true;setInlineWork(command==='edit_artwork_object'?'Updating object stitches…':command==='transform_design'?'Updating placement…':'Updating design…');setBusy(true);setPlaying(false);setMessage('');try{const next=await invoke<Plan>(command,args);if(command!=='recolor_block' && (next.blocks.length!==plan?.blocks.length||next.blocks.some((b,i)=>b.color.join(',')!==plan?.blocks[i]?.color.join(','))))setThreadAssignments({});setPlan(next);setPlayhead(null)}catch(e){setMessage(String(e))}finally{editLock.current=false;setInlineWork('');setDesignOffset([0,0]);setObjectOffset([0,0]);setResizePreview(null);setGroupScalePreview(1);setRotationPreview(0);setBusy(false)}}
useEffect(()=>{if(!plan||busy)return;const save=()=>{invoke('recovery_save',{width,height,format,threadAssignments}).then(()=>setRecoveryStatus('Recovery copy saved')).catch(e=>setRecoveryStatus('Recovery save failed: '+String(e)))};const timer=setTimeout(save,1500);return()=>clearTimeout(timer)},[plan,width,height,format,busy,threadAssignments]);
async function recover(){if(plan&&!await confirmAction('Replace the current design with the recovery copy?'))return;setBusy(true);try{const p=await invoke<{plan:Plan;width:number;height:number;format:string;thread_assignments?:ThreadAssignments}|null>('recovery_open');if(p){setThreadAssignments(p.thread_assignments??{});setPlan(p.plan);setWidth(p.width);setHeight(p.height);setFormat(p.format);setMachine('');setHoop('');setHidden([]);setPlayhead(null);setMessage('Recovery copy opened. Save as a project to keep it.')}else setMessage('No recovery copy found.')}catch(e){setMessage(String(e))}finally{setBusy(false)}}
function transform(s:number,r:number,x:number,y:number){return edit('transform_design',{scale:s,rotation:r,dx:x,dy:y})}
async function runAssistant(input:string){
 if(busy)return;
 const intent=assistantIntent(input);
 if(!intent){setAssistantReply('Try centering, fitting, rotation, scaling, checking quality, recommending a hoop, optimizing for a fabric, replacing exact hex colors, or explaining underlay. Open-ended requests are not supported yet.');return}
 if(intent.kind==='help'){
 const s=input.toLowerCase();
 const tips=[['underlay','Underlay supports top stitches and stabilizes the fabric. Choose it by fabric and stitch type.'],['density','Density is the spacing between stitch rows. Smaller spacing means more penetrations. Start with the fabric preset and test sew.'],['pull compensation','Pull compensation extends stitch edges to offset fabric contraction. Adjust in small increments after a test sew.'],['satin stitches','Satin uses alternating stitches across a narrow column. Wide areas may need split satin or fill.'],['stabilizer','Use an appropriate backing for the garment; stretchy knits typically need cutaway. Test your fabric and design together.'],['thread trims','Trims cut thread between separated areas. Optimize covered travel and color order rather than connecting across empty artwork.']];
 setAssistantReply(tips.find(([key])=>s.includes(key))?.[1]??'Choose a topic such as underlay or density.');return;
 }
 if(intent.kind==='clearSelection'){setMulti([]);setSelectedObject(null);setActiveGroup(null);setContext(null);setAssistantReply('Selection cleared.');return}
 if(intent.kind==='selectColor'||intent.kind==='selectLabel'||intent.kind==='selectKind'){
  const matches=objects.filter(o=>intent.kind==='selectColor'?o.color.join(',')===intent.color?.join(','):intent.kind==='selectLabel'?o.label.toLowerCase().includes(intent.text??''):o.kind.toLowerCase()===intent.text);
  if(!matches.length){setAssistantReply('No editable objects matched. Check the Layers panel for exact colors, labels and stitch types.');return}
  setCanvasMode('select');setMulti(matches.map(o=>o.uid));setSelectedObject(null);setActiveGroup(null);setContext(null);setLeft(true);setLayerTab('objects');
  setAssistantReply('Selected '+matches.length+' matching object'+(matches.length===1?'':'s')+'. Use Properties to modify the selection. Whole-design commands still affect the entire canvas.');return;
 }
 if(['moveSelected','scaleSelected','rotateSelected'].includes(intent.kind)){
  const ids=selectionIds.length?selectionIds:selectedObject!==null&&objects.some(o=>o.uid===selectedObject)?[selectedObject]:activeGroup!==null?designGroups.find(g=>g.key===activeGroup)?.members.map(o=>o.uid)??[]:[];
  if(!ids.length){setAssistantReply('Select editable objects or a design group before using a selected-object command. Nothing was changed.');return}
  if(!await confirmAction('Apply to '+ids.length+' selected object(s) only: '+input+'?'))return;
  if(editLock.current)return;
  setAssistantReply('Updating the selected objects only. Review the canvas and editor status; use Undo to reverse the change.');
  if(intent.kind==='moveSelected')await edit('move_artwork_objects',{uids:ids,dx:intent.dx,dy:intent.dy});
  else await edit('transform_artwork_group',{uids:ids,scale:intent.kind==='scaleSelected'?intent.value:1,rotation:intent.kind==='rotateSelected'?intent.value:0});
  return;
 }
 if(intent.kind==='lettering'){
  try {
   const fonts=await invoke<string[]>('lettering_fonts');
   const font=fonts.find(f=>f==='Arial')||fonts[0];
   if(!font){setAssistantReply('No installed lettering font found. Import or install a font first.');return}
   if(!await confirmAction('Add "'+intent.text+'" at '+intent.size+' mm using '+font+'? Existing artwork will be retained.'))return;
   if(editLock.current)return;
   await edit('insert_lettering_settings',{settings:{text:intent.text,font,size:intent.size,spacing:.4,arc:0,bold:true,italic:false,color:[105,69,162],align:'center'}});
   setAssistantReply('Review the lettering on the canvas and the editor status. Select it in Layers to change its font, placement or stitch settings.');
  }catch(e){setAssistantReply(String(e))}
  return;
 }
 if(!plan?.stitches){setAssistantReply('Open a design before running an editing command.');return}
 if(intent.kind==='review'){
  try {
   const a=await invoke<{short:number;long:number;zero:number;segments:number}>('audit_stitches');
   const tips=[plan.stitches.toLocaleString()+' planned points · '+plan.blocks.length+' color blocks · '+plan.trims+' trims.'];
   if(outside||machineExceeded||incompatibleHoop||invalidField)tips.push('Resolve the hoop or machine fit warning before export.');
   if(a.long>0)tips.push(a.long+' movements exceed 12 mm. Review long stitches and satin split settings.');
   if(a.short>30&&a.short/Math.max(1,a.segments)>.1)tips.push('Many short stitches: inspect tight corners and dense areas.');
   if(a.zero>0)tips.push('Near-zero movements found; some may be intentional ties.');
   if(plan.trims/Math.max(1,plan.stitches)*1000>8)tips.push('Frequent trims relative to stitch count. Inspect isolated regions and thread sequencing.');
   tips.push('These are screening heuristics, not a guarantee of sewability. Test sew before production.');
   setAssistantReply(tips.join(' '));
  }catch(e){setAssistantReply(String(e))}
  return;
 }

 if(intent.kind==='recommendHoop'){
  if(!designBounds){setAssistantReply('No stitch bounds available.');return}
  const w=designBounds.width,h=designBounds.height;
  const choices=compatibleHoops.filter(hp=>hp.width>=w+4&&hp.height>=h+4).sort((a,b)=>a.width*a.height-b.width*b.height);
  const best=choices[0];
  setAssistantReply(best?'Recommended saved hoop: '+best.name+' ('+best.width+' × '+best.height+' mm). Center the design before sewing.':'No saved compatible hoop has at least 2 mm of margin per side. Choose a larger compatible hoop or reduce the design.');
  return;
 }
 if(intent.kind==='recolor'&&!plan.blocks.some(b=>b.color.join(',')===intent.previous?.join(','))){setAssistantReply('The original RGB color is not in this design. Use an exact six-digit hex color from the design palette.');return}
 if((intent.kind==='fabric'||intent.kind==='optimize')&&!objects.some(o=>o.kind!=='manual'&&o.kind!=='skip')){setAssistantReply('Optimization needs editable artwork, not fixed stitches.');return}

 if(intent.kind==='audit'){setAssistantReply('Running the native stitch-quality check. Review the result in the editor status.');await audit();return}
 if(!await confirmAction('Apply to the whole design: '+input+'? You can undo this change.'))return;
 setAssistantReply('Command submitted. Review the canvas and editor status for the result.');
 switch(intent.kind){
 case 'optimize':await edit('optimize_editable_design',{});break;
 case 'fabric':await edit('apply_fabric_profile',{fabric:intent.fabric});break;
 case 'recolor':await edit('replace_design_color',{previous:intent.previous,color:intent.color});break;
 case 'center':await edit('center_design',{});break;
 case 'fit':if(invalidField||machineExceeded||incompatibleHoop){setAssistantReply('Choose a valid compatible hoop first.');return}fit();break;
 case 'rotate':await transform(1,intent.value!,0,0);break;
 case 'scale':await transform(intent.value!,0,0,0);break;
 case 'flipH':await edit('mirror_design',{horizontal:true});break;
 case 'flipV':await edit('mirror_design',{horizontal:false});break;
 case 'undo':await edit('history_step',{redo:false});break;
 case 'redo':await edit('history_step',{redo:true});break;
 }
}

function fit(){if(!points.length)return;const maxX=points.reduce((m,p)=>Math.max(m,Math.abs(p[0])),0),maxY=points.reduce((m,p)=>Math.max(m,Math.abs(p[1])),0);const s=Math.min(width*.45/Math.max(maxX,.01),height*.45/Math.max(maxY,.01),10);if(s>=.1)void transform(s,0,0,0);else setMessage('Design is too large for a single fit operation.')}
useEffect(()=>{const m=machines.find(p=>p.id===machine);const h=hoops.find(p=>p.id===hoop);if(!m)setMachine('');if(h&&hoopFits(h,m)){setWidth(h.width);setHeight(h.height)}else{setHoop('');if(m){setWidth(m.width);setHeight(m.height)}}if(m?.format)setFormat(m.format.toLowerCase());try{const target=sessionStorage.getItem('studio-digitizer-output-format');if(target){if(['dst','pes','pec','jef','exp','vp3'].includes(target))setFormat(target);sessionStorage.removeItem('studio-digitizer-output-format')}const raw=sessionStorage.getItem('studio-open-project-settings');if(raw){const p=JSON.parse(raw);setWidth(p.width);setHeight(p.height);setFormat(p.format);setThreadAssignments(p.thread_assignments??{});sessionStorage.removeItem('studio-open-project-settings')}}catch{}let active=true;invoke<Plan|null>('current_preview').then(p=>{if(active&&p)setPlan(p)}).catch(()=>{});return ()=>{active=false}},[]);
useEffect(()=>{let active=true;invoke<EditableObject[]>('editable_objects').then(items=>{if(active){setObjects(items);setSelectedObject(old=>items.some(o=>o.uid===old)?old:null)}}).catch(()=>{if(active){setObjects([]);if(plan)setLayerTab('threads')}});return()=>{active=false}},[plan]);
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
const [historyLabels,setHistoryLabels]=useState<[string[],string[]]>([[],[]]);
useEffect(()=>{if(busy)return;let active=true;invoke<[string[],string[]]>('history_labels').then(h=>{if(active)setHistoryLabels(h)}).catch(()=>{if(active)setHistoryLabels([[],[]])});return()=>{active=false}},[plan,busy]);

const [sewingSpm,setSewingSpm]=useState(()=>{const n=Number(localStorage.getItem('studio-sewing-spm')||800);return Number.isFinite(n)&&n>=100&&n<=1500?n:800});
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
  if(object)setCanvasMode('select');
  setMulti([]);setContext(null);
  const request=++selectionRequest.current;
  setSelectedObject(object?.uid??null);
  if(object){setObjectKind(object.kind);setRight(true);setInspectorTab(object.kind==="manual"?"transform":"stitches");void invoke<unknown>("lettering_settings",{uid:object.uid}).then(settings=>{if(settings&&request===selectionRequest.current)openText(object.uid)}).catch(()=>{});}
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
    const key=event.target.getAttribute('data-design-group');const group=independentGroups?designGroups.find(g=>g.key===key):undefined;setActiveGroup(group?.key??designGroups[0]?.key??null);setInspectorTab('transform');setRight(true);designGesture.current={pointer:event.pointerId,x:position.x,y:position.y,uids:group?.members.map(o=>o.uid)};
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
  if(rotationGesture.current?.pointer===event.pointerId){setRotationPreview(rotationAt(position,event.shiftKey));return}
  if(groupResizeGesture.current?.pointer===event.pointerId){setGroupScalePreview(groupScaleAt(position));return}
  if(designGesture.current?.pointer===event.pointerId){
    const offset=snapped(position.x-designGesture.current.x,position.y-designGesture.current.y,designGesture.current.uids,true) as [number,number];if(designGesture.current.uids)setObjectOffset(offset);else setDesignOffset(offset);
    return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    setResizePreview(resizeAt(position));
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId===event.pointerId){
    setObjectOffset(snapped(position.x-gesture.x,position.y-gesture.y,selectionIds.includes(gesture.uid)?selectionIds:[gesture.uid],true));
  }else if(drag){
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const start=new DOMPoint(drag.x,drag.y).matrixTransform(matrix.inverse());
    setPan([drag.px-(position.x-start.x),drag.py-(position.y-start.y)]);
  }
}

function finishCanvasGesture(event:ReactPointerEvent<SVGSVGElement>,commit:boolean) {
  setGuides({x:null,y:null});
  if(rotationGesture.current?.pointer===event.pointerId){
    const g=rotationGesture.current,position=commit?pointerPosition(event):null;
    const degrees=position?rotationAt(position,event.shiftKey):0;rotationGesture.current=null;
    if(Math.abs(degrees)>.5){setRotationPreview(degrees);void edit('transform_artwork_group',{uids:g.uids,scale:1,rotation:degrees})}else setRotationPreview(0);
    return;
  }
  if(groupResizeGesture.current?.pointer===event.pointerId){
    const g=groupResizeGesture.current,position=commit?pointerPosition(event):null;
    const factor=position?groupScaleAt(position):1;groupResizeGesture.current=null;
    if(Math.abs(factor-1)>.007){setGroupScalePreview(factor);void edit('transform_artwork_group',{uids:g.uids,scale:factor,rotation:0})}else setGroupScalePreview(1);
    return;
  }
  if(designGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const start=designGesture.current;
    designGesture.current=null;
    if(position){
      const [dx,dy]=snapped(position.x-start.x,position.y-start.y,start.uids);
      if(Math.hypot(dx,dy)>=.05){if(start.uids){setObjectOffset([dx,dy]);void edit('move_artwork_objects',{uids:start.uids,dx,dy})}else{setDesignOffset([dx,dy]);void transform(1,0,dx,dy)}return;}
    }
    setDesignOffset([0,0]);setObjectOffset([0,0]);return;
  }
  if(resizeGesture.current?.pointer===event.pointerId){
    const position=commit?pointerPosition(event):null;
    const result=position?resizeAt(position):null;
    const uid=resizeGesture.current.uid;
    resizeGesture.current=null;
    if(result&&(Math.abs(result.sx-1)>.007||Math.abs(result.sy-1)>.007)){setResizePreview(result);editSelection(result,uid);}else setResizePreview(null);
    return;
  }
  const gesture=objectGesture.current;
  if(gesture&&gesture.pointerId!==event.pointerId)return;
  const position=commit&&gesture?pointerPosition(event):null;
  objectGesture.current=null;
  if(!gesture){setDrag(null);return;}
  setDrag(null);
  if(gesture&&position){
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
  setZoom(Math.max(25,Math.min(400,Math.min(width/Math.max(1,w),height/Math.max(1,h))*88)));
  setPan([left+w/2,top+h/2]);
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
if(e.key==='Escape'&&focusCanvas){changeFocus(false);return;}
if((e.target as HTMLElement)?.closest("input,select,textarea")||e.repeat)return;
if(e.key==='F11'){e.preventDefault();toggleFocus();return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='i'){e.preventDefault();openInsertDialog();return;}
if(e.key==='Delete'||e.key==='Backspace'){if(deletionTarget()){e.preventDefault();void deleteDesign()}return;}
if(!selectionIds.length&&selectedObject!==null&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();editSelection({kind:'duplicate'});return;}
if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if(plan)void projectSave()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();if(plan)void edit("history_step",{redo:e.shiftKey})}else if(e.key==="Escape"){setContext(null);setMulti([]);setExportOpen(false);setDrag(null)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[plan,busy,width,height,format,focusCanvas,selectedObject,left,right,multi,activeGroup,canvasMode,objects]);return <><InsertDesignDialog<Plan> dialogRef={insertDialog} onInsert={result=>{
  setThreadAssignments({});setPlan(result);setPlayhead(null);setPlaying(false);setHidden([]);setMessage('');
}}/><div className={`studio-edit-bar ${focusCanvas?'studio-focus-active':''}`} role="group" aria-label="Design commands">
  {focusCanvas&&<button className="studio-exit-focus" onClick={()=>changeFocus(false)}><Minimize size={16}/> Exit focus</button>}
  <div className="studio-document">
    <Layers3 size={17} aria-hidden="true"/>
    <h1 title={plan?.name || 'Untitled design'}>{plan?.name || 'Untitled design'}</h1>{plan&&<small className="document-recovery" title={recoveryStatus}>{busy?"Working…":recoveryStatus==="Recovery copy saved"?"Recovery saved":"Design open"}</small>}
  </div>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title="Open artwork" aria-label="Open artwork" disabled={busy} onClick={open}><FolderOpen size={18}/></button>
    <button className="studio-insert-action" title="Insert design (Ctrl+I or Cmd+I)" aria-label="Insert design" disabled={busy} onClick={openInsertDialog}><FilePlus size={18}/><span>Insert design</span></button>
    
  </div>
  <div className="studio-command-group">
    <button className="studio-tool-icon" title={historyLabels[0].length?"Undo: "+historyLabels[0].at(-1):"Undo"} aria-label="Undo" disabled={!historyLabels[0].length||busy} onClick={()=>edit('history_step',{redo:false})}><Undo2 size={17}/></button>
    <button className="studio-tool-icon" title={historyLabels[1].length?"Redo: "+historyLabels[1].at(-1):"Redo"} aria-label="Redo" disabled={!historyLabels[1].length||busy} onClick={()=>edit('history_step',{redo:true})}><Redo2 size={17}/></button>
  </div>
  <div className="studio-command-group studio-design-tools" role="group" aria-label="Create and edit"><button className="studio-add-text" disabled={busy} onClick={()=>openText()}><Type size={17}/> Add Text</button>
    <button className="studio-tool-icon" title="Center design in hoop" aria-label="Center design" disabled={!plan||busy} onClick={()=>edit('center_design',{})}><Scan size={18}/></button>
    <button className="studio-tool-icon" title="Transform design" aria-label="Transform design" disabled={!plan} onClick={()=>{setRight(true);setInspectorTab('transform')}}><Move size={17}/></button>
    
    <button className="studio-tool-icon" title="Stitch tools" aria-label="Stitch tools" disabled={!plan} onClick={()=>{setRight(true);setInspectorTab('stitches')}}><Scissors size={17}/></button>
  </div>
  <div className="studio-command-group studio-view-tools" role="group" aria-label="Workspace view">
    <button className="studio-tool-icon" title="Layers" aria-label="Layers" aria-pressed={left} onClick={()=>setLeft(value=>!value)}><PanelLeft size={18}/></button>
    <button className="studio-tool-icon" title="Inspector" aria-label="Inspector" aria-pressed={right} onClick={()=>setRight(value=>!value)}><PanelRight size={18}/></button>
    <button className="studio-tool-icon" title={focusCanvas?'Exit focus view (Esc)':'Full-screen canvas (F11)'} aria-label={focusCanvas?'Exit focus view':'Focus canvas'} aria-pressed={focusCanvas} onClick={toggleFocus}>{focusCanvas?<Minimize size={18}/>:<Maximize size={18}/>}</button>
  </div>
  <div className="studio-command-group studio-intelligence-tools" role="group" aria-label="Design intelligence"><button className="studio-tool-icon studio-assistant-action" title="Offline design assistant" aria-label="Offline design assistant" aria-pressed={inspectorTab==='assistant'} onClick={()=>{setRight(true);setInspectorTab('assistant')}}><Sparkles size={17}/></button></div>
  <CommandPalette commands={[
    {label:'Move whole design',group:'Edit',run:()=>setCanvasMode('design'),disabled:!plan},
    {label:'Fit artwork',group:'View',run:fitArtwork,disabled:!plan},
    {label:'Fit hoop',group:'View',run:()=>{setZoom(100);setPan([0,0])}},
    {label:focusCanvas?'Exit focus view':'Focus canvas',group:'View',run:toggleFocus},
    {label:'Layers',group:'View',run:()=>setLeft(value=>!value)},
    {label:'Offline design assistant',group:'Inspector',run:()=>{setRight(true);setInspectorTab('assistant')}},
    {label:'Hoop and machine',group:'Inspector',run:()=>{setRight(true);setInspectorTab('hoop')}},
    {label:'Transform and resize',group:'Inspector',run:()=>{setRight(true);setInspectorTab('transform')},disabled:!plan},
    {label:'Stitch tools and quality',group:'Inspector',run:()=>{setRight(true);setInspectorTab('stitches')},disabled:!plan},
    {label:'Add Text',group:'Create',run:()=>openText(),disabled:busy},
    {label:'Insert design',group:'File',run:openInsertDialog,disabled:busy},
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
      <label><span>Layers panel width</span><input aria-label="Left panel width" type="range" min="160" max="340" value={leftWidth} onChange={e=>setLeftWidth(Number(e.target.value))}/></label>
      <label><span>Inspector width</span><input aria-label="Right panel width" type="range" min="180" max="460" value={rightWidth} onChange={e=>setRightWidth(Number(e.target.value))}/></label>
    </div>
  </details>
  {plan&&<GarmentPreview blocks={plan.blocks}/>}
  {plan&&<ThreadOrder assignments={threadAssignments} onAssign={(index,value)=>setThreadAssignments(old=>({...old,[index]:value}))} blocks={plan.blocks} format={format} machine={machines.find(profile=>profile.id===machine)?.name??''}/>}
  <button title="Delete selected design or objects (Delete)" aria-label="Delete selection" disabled={busy||!deletionTarget()} onClick={()=>void deleteDesign()}><Trash2 size={17}/> Delete</button><button className="studio-save-design" title="Save editable Stitch Studio project (Ctrl+S or Cmd+S)" disabled={!plan||busy} onClick={projectSave}><Save size={17}/> Save design</button><button className="primary studio-export" disabled={!plan?.stitches||outside||busy||machineExceeded||incompatibleHoop||invalidField} onClick={()=>setExportOpen(true)}><Download size={16}/> Export design</button>
</div>
{context&&<div className="studio-context-menu" style={{left:Math.max(8,Math.min(context.x,window.innerWidth-190)),top:Math.max(8,Math.min(context.y,window.innerHeight-210))}} role="group" aria-label="Object actions"><button onClick={()=>{const uid=context.uid;setContext(null);void invoke<unknown>('lettering_settings',{uid}).then(s=>{if(s)openText(uid);else{setRight(true);setInspectorTab('transform')}}).catch(e=>setMessage(String(e)))}}>Object properties</button><button onClick={()=>{editSelection({kind:'duplicate'},context.uid);setContext(null)}}>Duplicate</button><button onClick={()=>{editSelection({kind:'rotate'},context.uid);setContext(null)}}>Rotate 90°</button><button onClick={()=>{editSelection({kind:'delete'},context.uid);setContext(null)}}>Delete object</button><button onClick={()=>setContext(null)}>Close menu</button></div>}{busy&&!inlineWork&&<div className="processing-overlay"><section className="processing-card" role="status"><div className="studio-spinner"/><h2>Working on your design</h2><progress aria-label="Processing"/></section></div>}<div className={`editor-grid studio-canvas-layout ${focusCanvas?'canvas-focus':''} ${left?'':'hide-left'} ${right?'':'hide-right'}`} style={{gridTemplateColumns:`${focusCanvas?'0px':'clamp(48px,5vw,80px)'} ${left?`min(${leftWidth}px, 24vw)`:'0px'} minmax(0,1fr) ${right?`min(${rightWidth}px, 27vw)`:'0px'}`}}>
<div className="editor-toolrail" role="group" aria-label="Editor tools">
<button aria-pressed={left} onClick={()=>setLeft(v=>!v)}><Layers3 size={24}/><small>Layers</small></button>
<button disabled={busy} onClick={openInsertDialog}><FilePlus size={23}/><small>Insert</small></button>
<button onClick={()=>{setRight(true);setInspectorTab('transform')}}><Scissors size={23}/><small>Edit</small></button>
<button disabled={busy} onClick={()=>openText()}><Type size={23}/><small>Text</small></button>
<button disabled={busy} onClick={openInsertDialog} title="Browse shapes and templates"><Shapes size={23}/><small>Shapes</small></button>
<button disabled={busy} onClick={()=>{const command=navigation.find(n=>n.label==='Digitize an image');if(command)command.run();else void open()}}><Wrench size={23}/><small>Digitize</small></button>
<button onClick={()=>{setRight(true);setInspectorTab('threads')}}><Palette size={23}/><small>Color</small></button>
<button onClick={()=>{setRight(true);setInspectorTab('stitches')}} title="Additional stitch tools"><MoreHorizontal size={23}/><small>More</small></button>
</div>
<article className="workspace-sidebar studio-layers-dock" style={{width:`min(${leftWidth}px, 28vw)`}}>
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
        return <button key={object.uid} aria-pressed={selectionIds.length?selectionIds.includes(object.uid):selectedObject===object.uid} onClick={e=>e.shiftKey?toggleMulti(object.uid):selectObject(object)} className="object-layer-row" title={name}>
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
        setThreadAssignments(old=>{const next={...old};delete next[index];return next});
        void edit('recolor_block',{index,color:[1,3,5].map(position=>parseInt(value.slice(position,position+2),16))});
      }
      return <div className="thread-row layers-thread-row" key={index}>
        <input aria-label={`Thread ${index+1} color`} type="color" disabled={busy} value={color} onChange={event=>recolor(event.target.value)}/>
        <div className="layers-row-text"><strong>Block {index+1}</strong><small>{color.toUpperCase()}</small></div>
        <button title={concealed?'Show this thread in the preview':'Hide this thread in the preview'} aria-label={concealed?'Show thread preview':'Hide thread preview'}
          onClick={()=>setHidden(items=>concealed?items.filter(item=>item!==index):[...items,index])}>{concealed?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        {!!threadLibrary.length&&<select aria-label={`Assign saved thread ${index+1}`} value="" disabled={busy} onChange={event=>{
          const thread=threadLibrary.find(item=>item.id===event.target.value);
          if(thread){recolor(thread.color);setThreadAssignments(old=>({...old,[index]:[thread.brand,thread.code,thread.name].filter(Boolean).join(' ')}));}
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
{left&&panelResizeHandle("left")}{right&&panelResizeHandle("right")}<article className="canvas-panel">
<div className="studio-camera studio-camera-docked" role="group" aria-label="Canvas view">
  
  <button className="studio-selection-mode" title="Select and move the entire design" aria-pressed={canvasMode==='design'} onClick={()=>{selectObject(null);setCanvasMode('design');setPlaying(false);setPlayhead(null)}}><Group size={17}/><span className="camera-label">Design</span></button>
  <button className="studio-selection-mode" title="Select individual objects; Shift-click to select several" aria-pressed={canvasMode==='select'} onClick={()=>{setCanvasMode('select');setPlaying(false);setPlayhead(null)}}><MousePointer2 size={17}/><span className="camera-label">Objects</span></button>
  <button className="studio-tool-icon" title="Pan canvas" aria-label="Pan canvas" aria-pressed={canvasMode==='pan'} onClick={()=>setCanvasMode('pan')}><Hand size={17}/></button>
  <button className="studio-tool-icon" title="Zoom out" aria-label="Zoom out" disabled={zoom<=25} onClick={()=>setZoom(value=>Math.max(25,value-25))}><ZoomOut size={17}/></button>
  <button className="camera-zoom-value" title="Reset zoom to 100%" aria-label="Reset zoom to 100%" onClick={()=>{setZoom(100);setPan([0,0])}}>{Math.round(zoom)}%</button>
  <button className="studio-tool-icon" title="Zoom in" aria-label="Zoom in" disabled={zoom>=400} onClick={()=>setZoom(value=>Math.min(400,value+25))}><ZoomIn size={17}/></button>
  <button title="Fit artwork" aria-label="Fit artwork" disabled={!points.length} onClick={fitArtwork}><Maximize size={16}/><span className="camera-label">Fit</span></button>
  <button title="Fit hoop view" aria-label="Fit hoop view" onClick={()=>{setZoom(100);setPan([0,0])}}><SquareDashed size={16}/><span className="camera-label">Hoop</span></button>
  <button className="studio-tool-icon" title="Hoop grid" aria-label="Hoop grid" aria-pressed={grid} onClick={()=>setGrid(value=>!value)}><Grid size={16}/></button>
  <button title="Thread view" aria-label="Thread view" aria-pressed={realistic} onClick={()=>setRealistic(value=>!value)}><Eye size={16}/><span className="camera-label">Thread</span></button>
<button title="Show sampled stitch directions" aria-label="Show stitch directions" aria-pressed={showDirections} onClick={()=>setShowDirections(v=>!v)}><Waypoints size={16}/><span className="camera-label">Direction</span></button>
</div>
<div className="workspace-canvas">
<svg aria-label="Stitch preview; drag the background to pan" data-mode={canvasMode}
 onPointerDown={startCanvasGesture} onPointerMove={moveCanvasGesture}
 onPointerUp={event=>finishCanvasGesture(event,true)}
 onPointerCancel={event=>finishCanvasGesture(event,false)}
 onLostPointerCapture={event=>finishCanvasGesture(event,false)} viewBox={[pan[0]-width*.56*100/zoom,pan[1]-height*.56*100/zoom,width*1.12*100/zoom,height*1.12*100/zoom].join(' ')} className="design-canvas" onWheel={e=>{const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const anchor=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());const next=Math.max(25,Math.min(400,zoom*(e.deltaY<0?1.1:1/1.1)));if(next===zoom)return;const ratio=zoom/next;setPan([anchor.x+(pan[0]-anchor.x)*ratio,anchor.y+(pan[1]-anchor.y)*ratio]);setZoom(next)}} style={{width:'100%',background:'var(--lav-bg,var(--canvas,#edf1ed))'}}><defs><pattern id="hoop-fabric" width="1.4" height="1.4" patternUnits="userSpaceOnUse"><path d="M0 .2H1.4 M.2 0V1.4" fill="none" stroke="#967a68" strokeWidth=".075" opacity=".18"/></pattern><pattern id="hoop-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#d8cce6" strokeWidth=".75" vectorEffect="non-scaling-stroke"/></pattern></defs><rect x={-width/2} y={-height/2} width={width} height={height} fill="#fffdf5" stroke="#ad8cd1" strokeWidth="1.6" rx={4} vectorEffect="non-scaling-stroke" className="studio-hoop"/><rect x={-width/2} y={-height/2} width={width} height={height} fill="url(#hoop-fabric)" rx={2}/><rect x={-width/2} y={-height/2} width={width} height={height} fill={grid?"url(#hoop-grid)":"none"}/>{grid&&<g stroke="#896d98" opacity=".6" pointerEvents="none">
<path d={`M ${-width/2} 0 H ${width/2} M 0 ${-height/2} V ${height/2}`} strokeDasharray="4 5" strokeWidth=".6" vectorEffect="non-scaling-stroke"/>
</g>}<g transform={`translate(${designOffset.join(' ')})`}>{plan?.blocks.map((b,i)=><g key={i} opacity={hidden.includes(i)?0:1} fill="none" strokeLinecap={realistic?"round":"butt"} strokeLinejoin="round">{b.runs.map((_r,j)=>{const visible=renderedRuns[i]?.[j];if(!visible)return null;const color='rgb('+b.color.join(',')+')';return realistic?<g key={j} pointerEvents="none"><polyline points={visible} stroke={color} strokeWidth=".46"/><polyline points={visible} stroke="#ffffff" opacity=".17" strokeWidth=".12" transform="translate(-.06 -.07)"/></g>:<polyline key={j} points={visible} stroke={color} vectorEffect="non-scaling-stroke" strokeWidth="1"/>})}</g>)}{showDirections&&<g pointerEvents="none" fill="none" stroke="#663399" strokeWidth="1.2">{directionSamples.filter(d=>d.index<stitchIndex&&!hidden.includes(d.block)).map(d=><path key={d.index} d="M-1.1 0H1.1M.4 -.65L1.1 0L.4 .65" transform={`translate(${d.x} ${d.y}) rotate(${d.angle}) scale(${100/zoom})`} vectorEffect="non-scaling-stroke"/>)}</g>}{canvasMode==='design'&&!independentGroups&&designBounds&&<rect
  data-design-group x={designBounds.left-2} y={designBounds.top-2}
  width={designBounds.width+4} height={designBounds.height+4} rx={1}
  fill="transparent" pointerEvents="all" stroke="#8543aa" strokeWidth="1.5"
  vectorEffect="non-scaling-stroke" strokeDasharray="5 4"><title>Drag to move the whole design</title></rect>}</g>
{canvasMode==='design'&&independentGroups&&designGroups.map((group,i)=>{const b=group.bounds;if(!b)return null;return <g key={group.key} transform={activeGroup===group.key?'translate('+objectOffset.join(' ')+')':undefined}><rect data-design-group={group.key} x={b[0]-1} y={b[1]-1} width={b[2]+2} height={b[3]+2} fill="transparent" pointerEvents="all" stroke={activeGroup===group.key?'#754bb0':'#b49acb'} strokeDasharray="5 4" vectorEffect="non-scaling-stroke"><title>Move design {i+1}</title></rect></g>})}
{canvasMode==='design'&&designGroups.filter(g=>g.key===activeGroup&&g.bounds&&g.bounds[2]>.01&&g.bounds[3]>.01).map(g=>{const [x,y,w,h]=g.bounds!;const cx=x+w/2,cy=y+h/2;const s=groupScalePreview;const tx=cx-w*s/2+objectOffset[0],ty=cy-h*s/2+objectOffset[1];return <g key={'resize-'+g.key} transform={`rotate(${rotationPreview} ${cx} ${cy})`}>{(s!==1||rotationPreview!==0||objectOffset.some(v=>v!==0))&&<g pointerEvents="none" transform={`translate(${objectOffset.join(' ')}) translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`}>{g.members.filter(o=>o.path).map(o=><path key={o.uid} d={o.path} fill={o.fill_rule?'rgb('+o.color.join(',')+')':'none'} fillRule={o.fill_rule} stroke={'rgb('+o.color.join(',')+')'} strokeWidth={o.stroke_width||.3} opacity=".55"/>)}</g>}<rect x={tx} y={ty} width={w*s} height={h*s} fill="none" stroke="#754bb0" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>{[0,1,2,3].map(i=><circle key={i} cx={tx+(i%2)*w*s} cy={ty+Math.floor(i/2)*h*s} r={Math.max(.65,1.2*100/zoom)} fill="white" stroke="#754bb0" vectorEffect="non-scaling-stroke" data-group-resize={i} style={{cursor:i===0||i===3?'nwse-resize':'nesw-resize'}}><title>Drag to resize proportionally</title></circle>)}<line x1={tx+w*s/2} x2={tx+w*s/2} y1={ty} y2={ty-Math.max(3,9*100/zoom)} stroke="#754bb0" vectorEffect="non-scaling-stroke" pointerEvents="none"/><circle cx={tx+w*s/2} cy={ty-Math.max(3,9*100/zoom)} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" style={{cursor:'grab'}}><title>Rotate design · Shift snaps to 15°</title></circle></g>})}
{snap&&<g pointerEvents="none" stroke="#a84bc5" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke">{guides.x!==null&&<line x1={guides.x} x2={guides.x} y1={-height/2} y2={height/2} vectorEffect="non-scaling-stroke"/>}{guides.y!==null&&<line x1={-width/2} x2={width/2} y1={guides.y} y2={guides.y} vectorEffect="non-scaling-stroke"/>}</g>}
{canvasMode==='select'&&stitchIndex===points.length&&<g className="studio-hit-targets">
 {objects.filter(object=>object.path).map(object=><path key={object.uid} d={object.path}
   data-artwork-uid={object.uid} onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!busy){selectObject(object);setContext({uid:object.uid,x:e.clientX,y:e.clientY})}}} onDoubleClick={e=>{e.stopPropagation();void invoke<unknown>('lettering_settings',{uid:object.uid}).then(s=>{if(s){setSelectedObject(object.uid);openText(object.uid)}}).catch(()=>{})}} fill={object.fill_rule?'transparent':'none'}
   fillRule={object.fill_rule} stroke={object.fill_rule?'none':'transparent'}
   strokeWidth={object.stroke_width} pointerEvents={object.fill_rule?'fill':'stroke'}/>)}
</g>}
{selectionIds.length>0&&canvasMode==='select'&&multiBounds&&(()=>{const [x,y,w,h]=multiBounds;const cx=x+w/2,cy=y+h/2,scale=groupScalePreview;const tx=cx-w*scale/2,ty=cy-h*scale/2;const lift=Math.max(3,9*100/zoom);const moving=objectOffset.some(v=>v!==0)||scale!==1||rotationPreview!==0;return <g pointerEvents="none" transform={`translate(${objectOffset.join(' ')}) rotate(${rotationPreview} ${cx} ${cy})`}>
 {moving&&<g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>{objects.filter(o=>selectionIds.includes(o.uid)&&o.path).map(o=><path key={o.uid} d={o.path} fill={o.fill_rule?'rgb('+o.color.join(',')+')':'none'} fillRule={o.fill_rule} stroke={'rgb('+o.color.join(',')+')'} strokeWidth={o.stroke_width||.3} opacity=".55"/>)}</g>}
 <rect x={tx} y={ty} width={w*scale} height={h*scale} fill="none" stroke="#754bb0" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>
 {[0,1,2,3].map(i=><circle key={i} cx={tx+(i%2)*w*scale} cy={ty+Math.floor(i/2)*h*scale} r={Math.max(.65,1.2*100/zoom)} fill="white" stroke="#754bb0" vectorEffect="non-scaling-stroke" data-multi-resize={i} pointerEvents={busy?'none':'all'} style={{cursor:i===0||i===3?'nwse-resize':'nesw-resize'}}><title>Resize selected objects proportionally</title></circle>)}
 <line x1={cx} x2={cx} y1={ty} y2={ty-lift} stroke="#754bb0" vectorEffect="non-scaling-stroke"/><circle cx={cx} cy={ty-lift} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" pointerEvents={busy?'none':'all'} style={{cursor:'grab'}}><title>Rotate selection · Shift snaps to 15°</title></circle></g>})()}
{!selectionIds.length&&selected?.bounds&&canvasMode==='select'&&<g className="studio-selection" pointerEvents="none" transform={selectionTransform+(rotationPreview?` rotate(${rotationPreview} ${selected.bounds[0]+selected.bounds[2]/2} ${selected.bounds[1]+selected.bounds[3]/2})`:'')}>
 {(objectGesture.current||resizePreview||rotationPreview!==0||objectOffset.some(v=>v!==0))&&<path d={selected.path} fill={selected.fill_rule?'#8d53a333':'none'} fillRule={selected.fill_rule}
   stroke="#8d53a3" strokeWidth={selected.stroke_width||.3}/>}
 <rect x={selected.bounds[0]-.6} y={selected.bounds[1]-.6} width={selected.bounds[2]+1.2} height={selected.bounds[3]+1.2}
   fill="none" stroke="#8543aa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4 3"/>
 {resizeHandles.map((handle,index)=><circle key={index} cx={handle.x} cy={handle.y}
   r={Math.max(.65,1.2*100/zoom)} fill="#fff" stroke="#6945a2" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
   data-resize-handle={index} pointerEvents={busy?'none':'all'} style={{cursor:handle.cursor}}>
   <title>{handle.dx&&handle.dy?'Drag corner to resize':'Drag side to resize'}</title>
 </circle>)}
<line x1={selected.bounds[0]+selected.bounds[2]/2} x2={selected.bounds[0]+selected.bounds[2]/2} y1={selected.bounds[1]} y2={selected.bounds[1]-Math.max(3,9*100/zoom)} stroke="#754bb0" vectorEffect="non-scaling-stroke"/><circle cx={selected.bounds[0]+selected.bounds[2]/2} cy={selected.bounds[1]-Math.max(3,9*100/zoom)} r={Math.max(.8,1.7*100/zoom)} fill="#754bb0" stroke="white" vectorEffect="non-scaling-stroke" data-rotation-handle="true" pointerEvents={busy?'none':'all'} style={{cursor:'grab'}}><title>Rotate object · Shift snaps to 15°</title></circle>
</g>}</svg>{selected&&canvasMode==='select'&&<div className="studio-selection-actions" role="group" aria-label="Selected object actions">
  <span>{selected.label||'Object '+selected.uid}</span>
  <button className="studio-tool-icon" title="Rotate selection 90°" aria-label="Rotate selection 90 degrees" disabled={busy} onClick={()=>editSelection({kind:'rotate'})}><RotateCw size={16}/></button>
  <button className="studio-tool-icon" title="Duplicate selection" aria-label="Duplicate selection" disabled={busy} onClick={()=>editSelection({kind:'duplicate'})}><Copy size={16}/></button>
  <button className="studio-tool-icon" title="Delete selection" aria-label="Delete selection" disabled={busy||!deletionTarget()} onClick={()=>void deleteDesign()}><Trash2 size={16}/></button>
</div>}
{!plan&&<div className="workspace-empty">
  <SquareDashed size={31}/>
  <strong>Start with a design</strong>
  <p>Open artwork or insert a library template.</p>
  <button onClick={openInsertDialog}><FilePlus size={16}/> Browse designs</button>
</div>}</div>

</article><article className="workspace-sidebar workspace-inspector studio-inspector-dock" style={{width:`min(${rightWidth}px, 30vw)`}}>
  <h2 className="editor-visually-hidden">Inspector</h2>
  <div className="workspace-segments" role="group" aria-label="Inspector">
    <button aria-pressed={inspectorTab==='hoop'} onClick={()=>setInspectorTab('hoop')}><Layers3 size={19}/>Design</button>
    <button aria-pressed={inspectorTab==='sequence'} onClick={()=>setInspectorTab('sequence')}><Waypoints size={19}/>Sequence</button>
    <button aria-pressed={inspectorTab==='threads'} onClick={()=>setInspectorTab('threads')}><Palette size={19}/>Threads</button>
    <button aria-pressed={inspectorTab==='text'} onClick={()=>openText(selectedObject)}><Type size={19}/>Text</button><button aria-pressed={inspectorTab==='transform'} onClick={()=>setInspectorTab('transform')}><Move size={19}/>Properties</button>
  </div>
  {inspectorTab==='transform'&&<section className="workspace-inspector-group multi-align"><h3>{selectionIds.length>1?selectionIds.length+' objects selected':selected?'Object properties':'Design properties'}</h3>{canvasMode==='design'&&designGroups.length>0&&<><label>Design group<select value={activeGroup??''} disabled={busy} onChange={e=>{setActiveGroup(e.target.value||null);setCanvasMode('design');setMulti([]);setSelectedObject(null)}}><option value="">Choose a design</option>{designGroups.map((g,i)=><option key={g.key} value={g.key}>Design {i+1} · {g.members.length} objects</option>)}</select></label>{designGroups.filter(g=>g.key===activeGroup).map(g=><div key={g.key}><small>{g.bounds?(g.bounds[2]/25.4).toFixed(2)+' × '+(g.bounds[3]/25.4).toFixed(2)+' in':''}</small>{g.bounds&&g.bounds[2]>0&&<><label>Target width (in)<input type="number" min=".05" step=".01" value={groupWidth} placeholder={(g.bounds[2]/25.4).toFixed(2)} onChange={e=>setGroupWidth(e.target.value)}/></label><button disabled={busy||!groupWidth||!Number.isFinite(Number(groupWidth))||Number(groupWidth)*25.4/g.bounds[2]<.1||Number(groupWidth)*25.4/g.bounds[2]>10} onClick={()=>{if(g.bounds){void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:Number(groupWidth)*25.4/g.bounds[2],rotation:0});setGroupWidth('')}}}>Apply width proportionally</button></>}<label>Rotate by (degrees)<input type="number" min="-360" max="360" step="1" value={groupRotation} onChange={e=>setGroupRotation(e.target.value)}/></label><button disabled={busy||!Number(groupRotation)||!Number.isFinite(Number(groupRotation))||Math.abs(Number(groupRotation))>360} onClick={()=>{void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:1,rotation:Number(groupRotation)});setGroupRotation('0')}}>Apply rotation</button><div className="alignment-pair">{[{label:'Smaller 10%',scale:.9,rotation:0},{label:'Larger 10%',scale:1.1,rotation:0},{label:'Rotate left',scale:1,rotation:-90},{label:'Rotate right',scale:1,rotation:90}].map(a=><button key={a.label} disabled={busy} onClick={()=>void edit('transform_artwork_group',{uids:g.members.map(o=>o.uid),scale:a.scale,rotation:a.rotation})}>{a.label}</button>)}</div><button disabled={busy} onClick={()=>{setMulti(g.members.map(o=>o.uid));setSelectedObject(null);setCanvasMode('select')}}>Select group objects</button><button disabled={busy||g.members.length<2} onClick={()=>{void edit('set_artwork_group',{uids:g.members.map(o=>o.uid),group:false});setActiveGroup(null)}}>Ungroup design</button><details><summary>Group thread colors</summary>{Array.from(new Map(g.members.map(o=>[o.color.join(','),o.color])).values()).map(color=><PaletteRow key={color.join(',')} color={color} count={g.members.filter(o=>o.color.join(',')===color.join(',')).length} disabled={busy} library={threadLibrary} onSelectObjects={()=>{setMulti(g.members.filter(o=>o.color.join(',')===color.join(',')).map(o=>o.uid));setSelectedObject(null);setCanvasMode('select')}} onReplace={next=>void edit('recolor_artwork_group',{uids:g.members.map(o=>o.uid),previous:color,color:next})}/>)}</details></div>)}</>}<details className="studio-inspector-section" open={selectionIds.length>1||snap}><summary>Alignment & snapping</summary><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap to grid, hoop and design edges</label><small>Shift-click objects or layers to select multiple.</small>{selectionIds.length>0&&<><strong>{selectionIds.length} selected</strong><div className="alignment-pair">{[{mode:'center_x',label:'Align X'},{mode:'center_y',label:'Align Y'},{mode:'distribute_x',label:'Distribute X'},{mode:'distribute_y',label:'Distribute Y'}].map(a=><button key={a.mode} disabled={busy||selectionIds.length<(a.mode.startsWith('distribute')?3:2)} onClick={()=>void edit('align_artwork_objects',{uids:selectionIds,mode:a.mode})}>{a.label}</button>)}</div><button disabled={busy||selectionIds.length<2} onClick={()=>{void edit('set_artwork_group',{uids:selectionIds,group:true});setActiveGroup(null);setCanvasMode('design');setMulti([])}}>Group selected objects</button><button onClick={()=>setMulti([])}>Clear selection</button></>}</details></section>}
  {inspectorTab==='text'&&<InlineLettering key={textSession} uid={textTarget} disabled={busy} onBusy={setBusy} onDone={uid=>{if(uid!==null){setSelectedObject(uid);setLayerTab('objects')}void invoke<Plan|null>('current_preview').then(p=>{if(p){if(p.blocks.length!==plan?.blocks.length||p.blocks.some((b,i)=>b.color.join(',')!==plan?.blocks[i]?.color.join(',')))setThreadAssignments({});setPlan(p);setPlayhead(null);setPlaying(false);setHidden([])}}).catch(e=>setMessage(String(e)))}}/>}
  {inspectorTab==='assistant'&&<section className="workspace-inspector-group"><h3>Design assistant</h3><small>Offline commands · no model download</small><p role="status">{assistantReply}</p><form className="workspace-stack" onSubmit={e=>{e.preventDefault();void runAssistant(assistantText)}}><label>Describe your edit<input value={assistantText} maxLength={160} onChange={e=>setAssistantText(e.target.value)} placeholder="Rotate 90 degrees"/></label><button className="primary" disabled={busy||!assistantText.trim()}>Run command</button></form><div className="workspace-stack">{['Select all satin objects','Move selected objects 5 mm right','Make selected objects 20% larger','Rotate selected objects 90 degrees','Clear selection','Optimize design','Review design','Add text "Hello" at 12 mm','Center design','Fit to hoop','Check stitch quality','Recommend a hoop','Optimize for sweatshirt','Explain underlay','Rotate 90 degrees','Scale to 80%','Flip horizontally','Undo'].map(s=><button key={s} disabled={busy} onClick={()=>{setAssistantText(s);void runAssistant(s)}}>{s}</button>)}</div></section>}
  {inspectorTab==='hoop'&&<section className="workspace-inspector-group">
    <h3><SquareDashed size={18}/> Machine setup</h3><label>Machine<select value={machine} onChange={e=>{setMachine(e.target.value);const m=machines.find(p=>p.id===e.target.value);const preferred=hoops.find(h=>h.id===hoop&&hoopFits(h,m))||hoops.find(h=>h.id===localStorage.getItem("studio-default-hoop")&&hoopFits(h,m));if(preferred){setHoop(preferred.id);setWidth(preferred.width);setHeight(preferred.height)}else{setHoop("");if(m){setWidth(m.width);setHeight(m.height)}}if(m?.format)setFormat(m.format.toLowerCase())}}><option value="">Manual setup</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Saved hoop<select value={hoop} onChange={e=>{setHoop(e.target.value);const h=hoops.find(p=>p.id===e.target.value);if(h){setWidth(h.width);setHeight(h.height)}}}><option value="">Custom dimensions</option>{compatibleHoops.map(h=><option key={h.id} value={h.id}>{h.name} — {h.width} × {h.height}</option>)}</select></label>{selectedMachine&&<small>{compatibleHoops.length} compatible saved hoops · {hoops.length-compatibleHoops.length} excluded by field size or mounting assignment.</small>}<div className="workspace-hoop-fields"><label>Width (in) <small>({width.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((width/25.4).toFixed(3))} onChange={e=>{setHoop("");setWidth(Number(e.target.value)*25.4)}}/></label><label>Height (in) <small>({height.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((height/25.4).toFixed(3))} onChange={e=>{setHoop("");setHeight(Number(e.target.value)*25.4)}}/></label></div>
    <details className="studio-inspector-section"><summary><Clock3 size={15}/> Sewing time estimate</summary><p className="workspace-helper">Adjust to your machine and workflow. Estimated sewing time excludes setup, hooping, bobbin changes and interruptions.</p><label>Effective speed (stitches/min)<input type="number" min="100" max="1500" step="50" value={sewingSpm} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setSewingSpm(Math.max(100,Math.min(1500,n)))}}/></label><div className="workspace-hoop-fields"><label>Trim (sec)<input type="number" min="0" max="30" value={trimSeconds} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setTrimSeconds(Math.max(0,Math.min(30,n)))}}/></label><label>Color change (sec)<input type="number" min="0" max="120" value={changeSeconds} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setChangeSeconds(Math.max(0,Math.min(120,n)))}}/></label></div><strong>{plan?'Estimated sewing time: '+sewingDuration:'Load a design to estimate time'}</strong></details>
<label>Export format<select value={format} onChange={e=>setFormat(e.target.value)}>
      {['dst','pes','jef','exp','vp3','pec'].map(f=><option value={f} key={f}>{f.toUpperCase()}</option>)}
    </select></label>
    {plan&&<div className="inspector-design-info"><h3><Layers3 size={18}/> Design information</h3><dl><dt><Waypoints size={15}/> Stitch points</dt><dd>{plan.stitches.toLocaleString()}</dd><dt><Layers3 size={15}/> Color blocks</dt><dd>{plan.blocks.length}</dd><dt><Scissors size={15}/> Trims</dt><dd>{plan.trims}</dd></dl></div>}{(incompatibleHoop||invalidField)&&<p className="workspace-warning" role="alert">Select a compatible hoop and positive usable dimensions before exporting.</p>}{machineExceeded&&<p className="workspace-warning" role="alert">Selected field exceeds {selectedMachine?.name}: maximum {selectedMachine?.width} × {selectedMachine?.height} mm. Choose a smaller hoop or correct the machine profile.</p>}{outside?<p className="workspace-warning" role="alert">Design exceeds the hoop.</p>:plan&&!machineExceeded&&!incompatibleHoop&&!invalidField&&<div className="workspace-fit-card"><CheckCircle2 size={30}/><div><strong>Fits selected hoop</strong><small>Review export settings before sewing.</small></div></div>}
  </section>}
  {inspectorTab==='sequence'&&<section className="workspace-inspector-group"><h3>Sewing sequence</h3>{plan?.blocks.map((b,i)=><div className="sequence-item" key={i}><span>{i+1}</span><i style={{background:`rgb(${b.color.join(',')})`}}/><strong>{b.runs.reduce((n,r)=>n+r.length,0).toLocaleString()} points</strong></div>)}{!plan&&<p className="workspace-helper">Open a design to see its sewing sequence.</p>}</section>}
  {inspectorTab==='threads'&&<section className="workspace-inspector-group palette-editor"><h3><Palette size={18}/> Design palette</h3>{plan&&<ReferenceColorPanel plan={plan} busy={busy} onApply={(original,colors)=>edit('apply_reference_colors',{original,colors})}/>}<p className="muted">Replace a color everywhere in the design, or edit individual sewing blocks in Layers.</p>{Array.from(new Map((plan?.blocks??[]).map(b=>[b.color.join(','),b.color])).values()).map(color=><PaletteRow key={color.join(',')} color={color} count={plan?.blocks.filter(b=>b.color.join(',')===color.join(',')).length??0} disabled={busy} library={threadLibrary} onSelectObjects={()=>{const ids=objects.filter(o=>o.color.join(',')===color.join(',')).map(o=>o.uid);if(ids.length){setCanvasMode('select');setMulti(ids);setSelectedObject(null);setLeft(true);setLayerTab('objects')}}} onReplace={next=>void edit('replace_design_color',{previous:color,color:next})}/>)}<button onClick={()=>{setLeft(true);setLayerTab('threads')}}>Individual sewing blocks</button></section>}
  {inspectorTab==='stitches'&&<section className="workspace-inspector-group">
    <h3>Generation settings</h3>
    <button onClick={()=>setAdvanced(v=>!v)} aria-expanded={advanced}>{advanced?'Hide stitch parameters':'Show stitch parameters'}</button>
    <FabricPicker value={fabric} disabled={busy||!plan||!objects.length}
      onChange={id=>void edit('apply_fabric_profile',{fabric:id})}/>
    {advanced&&<>{([{label:'Row spacing (mm)',value:spacing,set:setSpacing,min:.15,max:2,step:.05},{label:'Stitch length (mm)',value:length,set:setLength,min:.5,max:7,step:.1},{label:'Fill angle (°)',value:angle,set:setAngle,min:0,max:360,step:5},{label:'Pull compensation (mm)',value:pull,set:setPull,min:0,max:1,step:.05}]).map(f=><label key={f.label}>{f.label}<input type="number" min={f.min} max={f.max} step={f.step} value={f.value} onChange={e=>f.set(Number(e.target.value))}/></label>)}<label><input type="checkbox" checked={underlay} onChange={e=>setUnderlay(e.target.checked)}/> Underlay</label></>}{advanced&&<><label>Apply settings to<select value={scope} onChange={e=>setScope(e.target.value)}><option value="all">Entire design</option><option value="object" disabled={selectedObject===null}>Selected object</option></select></label><button disabled={!plan||busy||(scope==='object'&&selectedObject===null)} onClick={()=>edit('apply_stitch_properties',{uid:scope==='object'?selectedObject:null,fabric,spacing,length,angle,pull,underlay})}>Apply stitch parameters</button></>}
    <h3>Quality</h3><div className="workspace-stack"><button disabled={busy||!plan?.stitches||!objects.some(o=>o.kind!=='manual'&&o.kind!=='skip')} onClick={()=>void runAssistant('Optimize design')}>Optimize design density</button><small>Compares a conservative alternative and preserves the original if checks fail.</small><button disabled={!plan?.stitches||busy||objects.length>0} title={objects.length?"Editable artwork: adjust stitch settings instead.":"Split long fixed stitches without removing tie stitches."} onClick={async()=>{if(await confirmAction("Split fixed stitches longer than 10 mm? Original tie stitches are retained. You can undo this change."))void edit("repair_stitches",{})}}>Repair fixed stitches</button>{objects.length>0&&<small>For editable artwork, adjust stitch properties and regenerate the design. Fixed-stitch repair is disabled to preserve editable objects.</small>}<button disabled={!plan||busy} onClick={audit}>Check stitch quality</button></div>
    {plan&&<details className="workspace-disclosure"><summary>Stitch-length report</summary><section><h3>Quality review</h3>{(()=>{let short=0,long=0;for(const b of plan.blocks)for(const r of b.runs)for(let i=1;i<r.length;i++){const d=Math.hypot(r[i][0]-r[i-1][0],r[i][1]-r[i-1][1]);if(d<.3)short++;if(d>7)long++;}return <><p>{short} stitch segments shorter than 0.3 mm</p><p>{long} stitch segments longer than 7 mm</p>{short>0&&<p className="muted">Inspect tiny stitches for thread buildup.</p>}{long>0&&<p className="muted">Inspect long spans for snagging. Export may subdivide these.</p>}{plan.trims>50&&<p className="muted">Many trims: inspect artwork fragmentation and sewing order.</p>}</>})()}<small>Heuristic review of planned stitches, not a guarantee of sewability.</small></section></details>}
  </section>}
  {inspectorTab==='transform'&&<section className="workspace-inspector-group">
    <details className="studio-inspector-section" open><summary>Placement & size</summary><div className="workspace-stack placement-actions"><button onClick={()=>setInspectorTab('stitches')}>Stitch properties & quality</button><button disabled={!plan||busy} title="Move the design to the center of the selected hoop" onClick={()=>edit("center_design",{})}><Scan size={16}/> Center in hoop</button><div className="alignment-pair"><button disabled={!plan||busy} onClick={()=>edit("center_design_axis",{horizontal:true})}>Center horizontally</button><button disabled={!plan||busy} onClick={()=>edit("center_design_axis",{horizontal:false})}>Center vertically</button></div><button disabled={!plan||busy} title="Resize the design to fit the hoop" onClick={fit}><Maximize size={16}/> Resize to fit hoop</button><button disabled={!plan||busy} onClick={()=>transform(1,90,0,0)}><RotateCw size={16}/> Rotate 90°</button><button disabled={!plan||busy} title="Mirror the design left to right" onClick={()=>edit("mirror_design",{horizontal:true})}><FlipHorizontal size={16}/> Flip horizontal</button><button disabled={!plan||busy} title="Mirror the design top to bottom" onClick={()=>edit("mirror_design",{horizontal:false})}><FlipVertical size={16}/> Flip vertical</button></div>
    </details><details className="studio-inspector-section"><summary>Precise transformation</summary><div className="workspace-transform-fields"><label>Scale (%)<input type="number" min="10" max="1000" value={scale} onChange={e=>setScale(Number(e.target.value))}/></label><label>Rotation (°)<input type="number" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label><label>Move X (in) <small>({dx.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dx/25.4).toFixed(3))} onChange={e=>{setDx(Number(e.target.value)*25.4)}}/></label><label>Move Y (in) <small>({dy.toFixed(1)} mm)</small><input type="number" step=".01" value={Number((dy/25.4).toFixed(3))} onChange={e=>{setDy(Number(e.target.value)*25.4)}}/></label><button disabled={!plan||busy} onClick={()=>transform(scale/100,rotation,dx,dy)}>Apply transform to design</button>
    {selected&&canvasMode==='select'&&<button disabled={busy} onClick={()=>editSelection({kind:'scale',factor:scale/100})}>Scale selected object</button>}</div>
    <p className="workspace-helper">Editable artwork regenerates when resized. Test sew machine-only files after scaling.</p></details>
  </section>}
</article></div><div className="playback-tools">
  <button disabled={!points.length} onClick={()=>{if(stitchIndex===points.length)setPlayhead(0);setPlaying(!playing)}}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?"Pause":"Play"}</button>
  <button aria-label="Restart simulation" title="Restart simulation" disabled={!points.length} onClick={()=>{setPlaying(false);setPlayhead(0)}}><RotateCcw size={15}/></button>
  <button title="Previous stitch" aria-label="Previous stitch" disabled={stitchIndex===0} onClick={()=>stepStitch(-1)}><StepBack size={15}/></button>
  <button title="Next stitch" aria-label="Next stitch" disabled={stitchIndex===points.length} onClick={()=>stepStitch(1)}><StepForward size={15}/></button>
  <label><span className="screen-reader-only">Planned stitch position</span><input type="range" min="0" max={points.length} disabled={!points.length} value={stitchIndex} onChange={e=>{setPlaying(false);setPlayhead(Number(e.target.value))}}/></label>
  <select aria-label="Playback speed" value={playbackSpeed} onChange={event=>setPlaybackSpeed(Number(event.target.value))}>
    <option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option><option value={64}>64×</option>
  </select>
  <span className="stitch-playhead">{stitchIndex.toLocaleString()} / {points.length.toLocaleString()}</span>{plan&&<span className="simulation-fit" data-outside={outside}>{outside?"Outside hoop":"Fits hoop"}</span>}
</div><footer className="workspace-status">{inlineWork&&<span className="inline-work-status" role="status"><span className="inline-work-spinner"/>{inlineWork}</span>}
  <span><SquareDashed size={16}/>{width>0&&height>0?`Hoop ${(width/25.4).toFixed(2)} × ${(height/25.4).toFixed(2)} in`:'Set a hoop size'}</span>
  {plan&&<div className="status-metrics"><span><Waypoints size={16}/>{plan.stitches.toLocaleString()} points</span><span><Layers3 size={16}/>{plan.blocks.length} color blocks</span><span title="Unique RGB thread colors">{uniqueColors} colors</span><span><Scissors size={16}/>{plan.trims} trims</span><button className="sewing-estimate" title={'Estimated machine time at '+sewingSpm+' stitches/min, '+trimSeconds+' seconds per trim and '+changeSeconds+' seconds per block transition. Excludes hooping, setup and interruptions.'} onClick={()=>{setRight(true);setInspectorTab('hoop')}}><Clock3 size={15}/> Est. {sewingDuration}</button></div>}
  <span className="workspace-fit-status" data-outside={outside}>{outside?'Outside hoop':plan?'Fits hoop · '+recoveryStatus:recoveryStatus}</span>
</footer>
{exportOpen&&plan&&<ExportCenter assignments={threadAssignments} plan={plan} width={width} height={height} format={format} setFormat={setFormat} machine={machines.find(m=>m.id===machine)?.name||""} blocked={outside||machineExceeded||incompatibleHoop||invalidField} busy={busy} onExport={save} onClose={()=>setExportOpen(false)}/>}{message&&<p role="status">{message}</p>}</>}

function PaletteRow({color,count,disabled,library,onSelectObjects,onReplace}:{color:number[];count:number;disabled:boolean;library:ReturnType<typeof readThreads>;onSelectObjects:()=>void;onReplace:(color:number[])=>void}){
 const original='#'+color.map(v=>v.toString(16).padStart(2,'0')).join('');
 const [value,setValue]=useState(original);
 const [expanded,setExpanded]=useState(false);
 return <article className="palette-edit-row"><button className="palette-row-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><i style={{backgroundColor:original}}/><span><strong>{original.toUpperCase()}</strong><small>{count} sewing {count===1?'block':'blocks'}</small></span><Palette size={16}/></button>{expanded&&<div className="palette-row-controls"><button disabled={disabled} onClick={onSelectObjects}>Select matching objects</button><label>Replacement color<input type="color" value={value} onChange={e=>setValue(e.target.value)}/></label><div className="inline-color-presets">{['#111111','#ffffff','#754bb0','#ae294f','#24558c','#34754b','#d5a52e'].map(v=><button key={v} aria-label={'Choose '+v} aria-pressed={value===v} style={{backgroundColor:v}} onClick={()=>setValue(v)}/>)}</div>{!!library.length&&<select aria-label="Choose saved thread" value="" onChange={e=>{const t=library.find(t=>t.id===e.target.value);if(t)setValue(t.color)}}><option value="">Choose saved thread…</option>{library.map(t=><option key={t.id} value={t.id}>{t.brand} {t.code} {t.name}</option>)}</select>}<button className="primary" disabled={disabled||value===original} onClick={()=>onReplace([1,3,5].map(i=>parseInt(value.slice(i,i+2),16)))}>Replace all {count} {count===1?'block':'blocks'}</button></div>}</article>
}
