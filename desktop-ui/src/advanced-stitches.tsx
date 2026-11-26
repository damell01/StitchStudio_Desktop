import {invoke} from '@tauri-apps/api/core';
import {Plus,X} from 'lucide-react';
import {useEffect,useState} from 'react';
import {InspectorDialog} from './workspace-inspector';

type RGB=[number,number,number];
export type AdvancedStitchSettings =
  | {kind:'satin';style:string;split:number;shortStitches:boolean;underlay:number|null}
  | {kind:'contour';spiral:boolean}
  | {kind:'cross';cell:number}
  | {kind:'run';repeats:number}
  | {kind:'tartan';stripes:[RGB,number][]};

const kinds=new Set(['satin','contour','ripple','cross','run','tartan']);
const underlayOptions=[
  ['', 'Automatic'],['0','None'],['1','Center walk'],['2','Contour'],['3','Center + contour'],
  ['4','Zigzag'],['5','Center + zigzag'],['6','Contour + zigzag'],['7','Center + contour + zigzag'],
];
const labels={satin:'Satin',contour:'Contour or ripple',cross:'Cross-stitch',run:'Running stitch',tartan:'Tartan'};

export function AdvancedStitches({object,disabled,onApply}:{
  object:{uid:number;kind:string}|null;disabled:boolean;onApply:(uid:number,settings:AdvancedStitchSettings)=>Promise<string|null>;
}){
  if(!object||!kinds.has(object.kind))return null;
  const uid=object.uid;
  return <InspectorDialog label="Advanced stitch settings" title="Advanced stitch settings" disabled={disabled}>
    <AdvancedFields key={uid+':'+object.kind} uid={uid} disabled={disabled} onApply={onApply}/>
  </InspectorDialog>;
}

function AdvancedFields({uid,disabled,onApply}:{
  uid:number;disabled:boolean;onApply:(uid:number,settings:AdvancedStitchSettings)=>Promise<string|null>;
}){
  const [settings,setSettings]=useState<AdvancedStitchSettings|null>(null);
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    void invoke<AdvancedStitchSettings|null>('advanced_stitch_settings',{uid})
      .then(value=>{if(active)setSettings(value);})
      .catch(error=>{if(active)setMessage(String(error));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[uid]);
  if(loading)return <p role="status">Loading stitch settings…</p>;
  if(!settings)return <p role="status">{message||'Choose a supported stitch type in the Edit inspector.'}</p>;
  async function apply(){
    if(!settings)return;
    const error=await onApply(uid,settings);
    setMessage(error??'Stitches updated.');
  }

  return <div className="inspector-dialog-fields">
    <h3>{labels[settings.kind]}</h3>
    {settings.kind==='satin'&&<>
      <label>Pattern<select value={settings.style} onChange={e=>setSettings({...settings,style:e.target.value})}>
        <option value="satin">Satin</option><option value="s">S-stitch</option><option value="zigzag">Open zigzag</option>
      </select></label>
      <label>Split long stitches (mm)<input type="number" min={0} max={12} step=".5" value={settings.split}
        onChange={e=>setSettings({...settings,split:Number(e.target.value)})}/></label>
      <small>Use 0 to turn off splitting, or choose 3–12 mm.</small>
      <label>Underlay<select value={settings.underlay??''} onChange={e=>setSettings({...settings,underlay:e.target.value===''?null:Number(e.target.value)})}>
        {underlayOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="inspector-checkbox"><input type="checkbox" checked={settings.shortStitches}
        onChange={e=>setSettings({...settings,shortStitches:e.target.checked})}/> Short stitches on tight curves</label>
    </>}
    {settings.kind==='contour'&&<label>Path layout<select value={settings.spiral?'spiral':'rings'}
      onChange={e=>setSettings({...settings,spiral:e.target.value==='spiral'})}>
      <option value="rings">Concentric rows</option><option value="spiral">Spiral</option>
    </select></label>}
    {settings.kind==='cross'&&<label>Cell size (mm)<input type="number" min=".5" max="10" step=".1" value={settings.cell}
      onChange={e=>setSettings({...settings,cell:Number(e.target.value)})}/></label>}
    {settings.kind==='run'&&<label>Passes<select value={settings.repeats} onChange={e=>setSettings({...settings,repeats:Number(e.target.value)})}>
      {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
    </select></label>}
    {settings.kind==='tartan'&&<>
      <div className="workspace-stack">{settings.stripes.map(([color,width],i)=>{
        function replace(stripe:[RGB,number]){
          setSettings(previous=>previous?.kind==='tartan'?{...previous,stripes:previous.stripes.map((existing,index)=>index===i?stripe:existing)}:previous);
        }
        return <div className="advanced-stitch-stripe" key={i}>
          <label>Stripe {i+1}<input type="color" value={'#'+color.map(v=>v.toString(16).padStart(2,'0')).join('')}
            onChange={e=>replace([[1,3,5].map(n=>parseInt(e.target.value.slice(n,n+2),16)) as RGB,width])}/></label>
          <label>Width (mm)<input type="number" min=".5" max="20" step=".1" value={width}
            onChange={e=>replace([color,Number(e.target.value)])}/></label>
          <button disabled={settings.stripes.length<=1} aria-label={'Remove stripe '+(i+1)}
            onClick={()=>setSettings({...settings,stripes:settings.stripes.filter((_,index)=>index!==i)})}><X size={15}/></button>
        </div>;
      })}</div>
      <button disabled={settings.stripes.length>=8} onClick={()=>setSettings({...settings,stripes:[...settings.stripes,[[105,69,162],2]]})}>
        <Plus size={16}/> Add stripe
      </button>
    </>}
    <button className="primary" disabled={disabled} onClick={()=>void apply()}>Apply advanced settings</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}
