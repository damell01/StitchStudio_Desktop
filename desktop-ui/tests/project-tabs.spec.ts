import {chooseZoom,zoomReadout} from './helpers';
import {expect,test} from '@playwright/test';

test('opens a separate project tab with its own viewport, history and recovery', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const design=(name:string)=>({name,stitches:3,trims:0,blocks:[{color:[105,69,162],runs:[[[0,0],[15,0],[15,6]]]}]});
    let active='primary';
    const primary={plan:design('First design'),history:['First edit']};
    const slots=new Map<string,{plan:ReturnType<typeof design>|null;history:string[]}>([['primary',primary]]);
    const recovery=new Map<string,string>();
    const list=()=>({active,tabs:[...slots].map(([id,v])=>({id,name:v.plan?.name??'Untitled design',has_design:!!v.plan}))});
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='workspace_overview')return {current:slots.get(active)?.plan?.name??null,recovery:false};
      if(command==='workspace_tabs')return list();
      if(command==='change_workspace_tab'){
        const action=args.action as {type:string;id?:string};
        if(action.type==='new'){slots.set('second',{plan:null,history:[]});active='second';}
        if(action.type==='select')active=action.id!;
        if(action.type==='close'){slots.delete(action.id!);if(active===action.id)active='primary';}
        return list();
      }
      if(command==='current_preview')return slots.get(active)?.plan;
      if(command==='editable_objects')return [];
      if(command==='history_labels')return [slots.get(active)?.history??[],[]];
      if(command==='draw_canvas_shape'){
        const slot=slots.get(active)!;
        slot.plan=design('Second design');
        slot.history.push('Draw on canvas');
        return slot.plan;
      }
      if(command==='recovery_save'){
        if(args.expectedTab===active&&slots.get(active)?.plan)recovery.set(active,slots.get(active)!.plan!.name);
        return null;
      }
      if(command==='recoverable_workspace_tabs')return [...recovery].map(([id,name])=>({id,name}));
      if(command==='restore_workspace_tab'){
        const id=String(args.id);active=id;
        slots.set(id,{plan:design(recovery.get(id)!),history:[]});
        return {tabs:list(),project:{width:130,height:180,format:'dst'}};
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  const tabs=page.getByRole('tablist',{name:'Project tabs'});
  await expect(tabs.getByRole('tab',{name:'First design'})).toHaveAttribute('aria-selected','true');
  await chooseZoom(page,100);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(zoomReadout(page)).toContainText('125%');
  await page.getByRole('button',{name:'New project tab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your hoop is ready'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();

  await page.locator('.canvas-drawing-menu summary').click();
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  const canvas=page.locator('.design-canvas');
  const screen=await canvas.evaluate(element=>{
    const matrix=(element as unknown as SVGSVGElement).getScreenCTM()!;
    const a=new DOMPoint(-12,-5).matrixTransform(matrix),b=new DOMPoint(12,5).matrixTransform(matrix);
    return [a.x,a.y,b.x,b.y];
  });
  await page.mouse.move(screen[0],screen[1]);await page.mouse.down();
  await page.mouse.move(screen[2],screen[3],{steps:5});await page.mouse.up();
  await expect(tabs.getByRole('tab',{name:'Second design'})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toHaveAttribute('title','Undo: Draw on canvas');
  await tabs.getByRole('tab',{name:'First design'}).click();
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toHaveAttribute('title','Undo: First edit');
  await expect(zoomReadout(page)).toContainText('125%');
  await page.getByRole('button',{name:'Close Second design',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(tabs.getByRole('tab',{name:'Second design'})).toHaveCount(0);
  await page.getByRole('button',{name:'Restore a project tab',exact:true}).click();
  await page.getByRole('dialog',{name:'Restore a project tab'}).getByRole('button',{name:'Second design'}).click();
  await expect(tabs.getByRole('tab',{name:'Second design'})).toHaveAttribute('aria-selected','true');
});

test('restores the previous tab order and active project after a restart',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const plan=(name:string)=>({name,stitches:3,trims:0,blocks:[{color:[20,30,40],runs:[[[0,0],[2,2],[3,1]]]}]});
    const projects=[
      {id:'primary',name:'First design',has_design:true},
      {id:'second',name:'Second design',has_design:true},
    ];
    let list={active:'primary',tabs:[{id:'primary',name:'Untitled design',has_design:false}]};
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='workspace_overview')return {current:null,recovery:true};
      if(command==='workspace_tabs')return list;
      if(command==='current_preview')return list.tabs.find(tab=>tab.id===list.active)?.has_design?
        plan(list.tabs.find(tab=>tab.id===list.active)!.name):null;
      if(command==='editable_objects'||command==='recoverable_workspace_tabs')return [];
      if(command==='restore_workspace_session'){
        if(JSON.stringify(args.ids)!==JSON.stringify(['primary','second'])||args.active!=='second')throw Error('Unexpected tabs');
        list={active:'second',tabs:projects};
        return {tabs:list,projects:{
          primary:{width:130,height:180,format:'dst'},
          second:{width:200,height:230,format:'pes'},
        },skipped:0};
      }
      if(command==='change_workspace_tab'){
        list={...list,active:(args.action as {id:string}).id};
        return list;
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.evaluate(()=>localStorage.setItem('studio-previous-project-tabs',JSON.stringify({ids:['primary','second'],active:'second'})));
  await page.reload();
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await page.getByRole('button',{name:'Restore a project tab',exact:true}).click();
  await page.getByRole('button',{name:'Restore previous workspace',exact:true}).click();
  const tabs=page.getByRole('tablist',{name:'Project tabs'});
  await expect(tabs.getByRole('tab')).toHaveText(['First design','Second design']);
  await expect(tabs.getByRole('tab',{name:'Second design'})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.studio-document h1')).toHaveText('Second design');
  await tabs.getByRole('tab',{name:'First design'}).click();
  await expect(page.locator('.studio-document h1')).toHaveText('First design');
});
