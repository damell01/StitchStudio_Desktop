import {expect,test} from '@playwright/test';

test('applies satin options and picks an open path for new lettering', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const calls:{command:string;args:Record<string,unknown>}[]=[];
    const plan={name:'Ribbon study',stitches:3,trims:0,blocks:[{color:[105,69,162],runs:[[[-15,0],[0,0],[15,0]]]}]};
    const body={uid:4,label:'Ribbon path',kind:'satin',color:[105,69,162],bounds:[-15,0,30,0],path:'M-15 0H15',stroke_width:2};
    let inserted=false;
    Object.assign(window,{advancedCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      calls.push({command,args});
      if(command==='workspace_overview')return {current:plan.name,recovery:false};
      if(command==='current_preview'||command==='set_advanced_stitches'||command==='preview_lettering')return {...plan};
      if(command==='editable_objects')return inserted?[body,{...body,uid:5,label:'Curve text'}]:[body];
      if(command==='advanced_stitch_settings')return {kind:'satin',style:'satin',split:7,underlay:null,shortStitches:true};
      if(command==='lettering_fonts')return ['Arial'];
      if(command==='lettering_baseline')return 'M-15 0H15';
      if(command==='insert_lettering_settings'){inserted=true;return plan;}
      if(command==='history_labels')return [[],[]];
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  const canvas=page.locator('.design-canvas');
  async function selectPath(){
    const point=await canvas.evaluate(element=>{
      const p=new DOMPoint(-8,0).matrixTransform((element as unknown as SVGSVGElement).getScreenCTM()!);
      return [p.x,p.y];
    });
    await page.mouse.click(point[0],point[1]);
  }
  const calls=()=>page.evaluate(()=>(window as unknown as {advancedCalls:{command:string;args:unknown}[]}).advancedCalls);
  await canvas.locator('[data-artwork-uid="4"]').first().waitFor({state:"attached"});
  await selectPath();
  await page.getByRole('group',{name:'Editor tools'}).getByRole('button',{name:'Stitches'}).click();
  await page.getByRole('button',{name:'Advanced stitch settings'}).click();
  const detail=page.getByRole('dialog',{name:'Advanced stitch settings'});
  await detail.getByLabel('Pattern').selectOption('s');
  await detail.getByRole('combobox',{name:'Underlay',exact:true}).selectOption('5');
  await detail.getByLabel('Split long stitches (mm)').fill('5');
  await detail.getByRole('button',{name:'Apply advanced settings'}).click();
  await expect(detail.getByRole('status')).toHaveText('Stitches updated.');
  expect((await calls()).find(call=>call.command==='set_advanced_stitches')?.args).toMatchObject({
    uid:4,settings:{kind:'satin',style:'s',split:5,underlay:5},
  });
  await detail.getByRole('button',{name:'Close advanced stitch settings'}).click();

  await page.getByRole('button',{name:'Add text',exact:true}).click();
  const lettering=page.locator('.inline-lettering');
  await lettering.getByRole('button',{name:'Pick a baseline on canvas'}).click();
  await selectPath();
  await expect(lettering).toContainText('Baseline from Ribbon path');
  await lettering.getByRole('textbox',{name:'Text',exact:true}).fill('Ribbon');
  await lettering.getByRole('button',{name:'Add text to design',exact:true}).click();
  await expect.poll(async ()=>(await calls()).find(call=>call.command==='insert_lettering_settings')?.args).toMatchObject({
    settings:{text:'Ribbon',path:'M-15 0H15',path_offset:.5},
  });
});
