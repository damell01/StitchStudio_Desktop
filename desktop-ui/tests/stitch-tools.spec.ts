import {expect,test} from '@playwright/test';

test('locate an issue, export a separate swatch sheet, and call a shared path tool',async ({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const calls:{command:string;args:Record<string,unknown>}[]=[];
    const plan={name:'Badge',stitches:150,trims:1,blocks:[{color:[88,52,108],runs:[[[0,0],[8,8]]]}]};
    const ids=[{uid:12,label:'Badge fill',kind:'fill',color:[88,52,108],bounds:[-5,-5,10,10],path:'M-5 -5H5V5H-5Z'}];
    Object.assign(window,{toolCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>) {
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return ids;
      if(command==='coverage_gap_preview')return [];
      if(command==='design_issues')return [{uid:12,label:'Badge fill',severity:'warning',message:'Inspect this dense fill.'}];
      if(command==='preview_test_swatches'){
        calls.push({command,args});return {revision:'22',width:35,height:20,plan,values:[.32,.4,.48]};
      }
      if(command==='export_test_swatches'){calls.push({command,args});return true;}
      if(command==='apply_path_tool'){calls.push({command,args});return {...plan,stitches:160};}
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const inspector=page.locator('.workspace-inspector');
  const stitchSettings=inspector.getByRole('button',{name:'Stitches',exact:true});
  if(!await inspector.isVisible())await page.getByRole('button',{name:'Inspector',exact:true}).click();
  await stitchSettings.click();
  await inspector.getByRole('button',{name:'Design issues',exact:true}).click();
  const issues=page.getByRole('dialog',{name:'Design issues'});
  await expect(issues.getByText('Inspect this dense fill.')).toBeVisible();
  await issues.getByRole('button',{name:'Locate Badge fill'}).click();
  await expect(issues).toBeHidden();
  await expect(inspector.locator('.inspector-context')).toContainText('Badge fill');

  await stitchSettings.click();
  await inspector.getByRole('button',{name:'Test swatches'}).click();
  const swatches=page.getByRole('dialog',{name:'Test swatches'});
  await swatches.getByRole('button',{name:'Preview swatches'}).click();
  await expect(swatches.getByRole('img',{name:'Test sheet stitch preview'})).toBeVisible();
  await swatches.getByRole('button',{name:'Save DST test sheet'}).click();
  await expect(swatches.getByText('Test swatch file saved.')).toBeVisible();
  await swatches.getByRole('button',{name:'Close test swatches'}).click();

  await inspector.getByRole('button',{name:'Edit',exact:true}).click();
  await inspector.getByRole('button',{name:'Path tools'}).click();
  const paths=page.getByRole('dialog',{name:'Path tools'});
  await expect(paths.getByRole('button',{name:'Unite'})).toBeDisabled();
  await paths.getByRole('button',{name:'Add offset path'}).click();
  await expect(paths.getByRole('status')).toContainText('Path updated');
  const calls=await page.evaluate(()=>(window as unknown as {toolCalls:unknown[]}).toolCalls);
  expect(calls).toEqual([
    {command:'preview_test_swatches',args:{request:{uid:12,setting:'spacing',from:.32,to:.48,steps:3,columns:3}}},
    {command:'export_test_swatches',args:expect.objectContaining({revision:'22',format:'dst'})},
    {command:'apply_path_tool',args:{uids:[12],operation:{kind:'offset',millimeters:1}}},
  ]);
});
