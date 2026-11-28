import {expect,test} from '@playwright/test';

test('types lettering at the clicked design coordinates and preserves existing stitches', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const block={color:[10,50,80],runs:[[[-25,0],[-20,2],[-15,1]]]};
    let current={name:'Existing design',stitches:3,trims:0,blocks:[block]};
    const calls:Record<string,unknown>[]=[];
    Object.assign(window,{letteringCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='workspace_overview')return {current:current.name,recovery:false};
      if(command==='current_preview')return current;
      if(command==='editable_objects')return [];
      if(command==='lettering_fonts')return ['Arial'];
      if(command==='insert_lettering_settings'){
        calls.push(args);
        const [x,y]=args.placement as number[];
        current={...current,stitches:6,blocks:[block,{color:[105,69,162],runs:[[[x,y],[x+1,y],[x+1,y+1]]]}]};
        return current;
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  const canvas=page.locator('.design-canvas');
  const existing=canvas.locator('[data-stitch-block]').first();
  await expect(existing).toBeVisible();
  const initial=await existing.getAttribute('d');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.locator('summary[aria-label="Create and edit tools"]').click();
  await page.getByRole('button',{name:'Type on canvas',exact:true}).click();
  const point=await canvas.evaluate(element=>{
    const p=new DOMPoint(12,-13).matrixTransform((element as unknown as SVGSVGElement).getScreenCTM()!);
    return [p.x,p.y];
  });
  await page.mouse.click(point[0],point[1]);
  const input=page.getByRole('textbox',{name:'Canvas lettering'});
  await expect(input).toBeFocused();
  await input.fill('New text');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(existing).toHaveAttribute('d',initial!);
  const [call]=await page.evaluate(()=>(window as unknown as {letteringCalls:Record<string,unknown>[]}).letteringCalls);
  expect(call.settings).toMatchObject({text:'New text',font:'Arial'});
  expect((call.placement as number[])[0]).toBeCloseTo(12,0);
  expect((call.placement as number[])[1]).toBeCloseTo(-13,0);
});
test('opens contextual lettering tools on the canvas and preserves advanced settings',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    localStorage.setItem('studio-review-lettering','0');
    const color=[105,69,162];
    const plan={name:'Lettering design',stitches:4,trims:0,blocks:[{color,runs:[[[-10,-4],[10,-4],[10,4],[-10,4]]]}]};
    const object={uid:7,label:'Little Seed',kind:'fill',bounds:[-10,-4,20,8],path:'M-10 -4H10V4H-10Z',fill_rule:'nonzero',color};
    const settings={text:'Little Seed',font:'Arial',size:12,spacing:.4,arc:0,bold:true,italic:false,color,align:'right',kind:'satin',h_scale:96,kern:[[0,1],[8,.5]]};
    const calls:Record<string,unknown>[]=[];
    Object.assign(window,{letteringEditCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='workspace_overview')return {current:plan.name,recovery:false};
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return [object];
      if(command==='object_stitch_guides')return {textForm:'text',order:[],center:null,entry:null,exit:null,rails:[]};
      if(command==='lettering_settings')return settings;
      if(command==='lettering_fonts')return ['Arial','Georgia'];
      if(command==='update_lettering'){calls.push(args);return true;}
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  await page.locator('.design-canvas [data-artwork-uid="7"]').click();
  const actions=page.getByRole('group',{name:'Selected object actions'});
  await actions.getByRole('button',{name:'Edit text',exact:true}).click();
  const form=page.getByRole('form',{name:'Canvas lettering'});
  const text=form.getByRole('textbox',{name:'Canvas lettering'});
  await expect(text).toHaveValue('Little Seed');
  await text.fill('Seed');
  await form.getByRole('combobox',{name:'Font',exact:true}).selectOption('Georgia');
  await form.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(form).toBeHidden();
  const [call]=await page.evaluate(()=>(window as unknown as {letteringEditCalls:Record<string,unknown>[]}).letteringEditCalls);
  expect(call).toMatchObject({uid:7,settings:{text:'Seed',font:'Georgia',arc:0,align:'right',kind:'satin',h_scale:96,kern:[[0,1]]}});
});
