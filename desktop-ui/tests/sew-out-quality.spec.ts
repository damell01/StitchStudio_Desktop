import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    localStorage.setItem('studio-machines',JSON.stringify([{id:'eom',name:'Poolin EOM',width:130,height:180,format:'dst'}]));
    localStorage.setItem('studio-default-machine','eom');
    const color=[80,56,102];
    const block={color,runs:[Array.from({length:30},(_,i)=>[.1+i*.02,.2+i*.015])]};
    let plan={name:'Sample lettering',stitches:30,trims:1,blocks:[block]};
    const objects=[{uid:12,label:'Fill sample',kind:'fill',color,bounds:[-5,-5,10,10],fill_rule:'nonzero',path:'M-5 -5H5V5H-5Z'}];
    const calls:{command:string;args:Record<string,unknown>}[]=[];
    Object.assign(window,{sewOutCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      calls.push({command,args});
      if(command==='current_preview')return plan;
      if(command==='workspace_overview')return {current:plan.name,recovery:false};
      if(command==='editable_objects')return objects;
      if(command==='coverage_gap_preview')return [{uid:12,points:[[.5,.5]],percent:22}];
      if(command==='design_issues')return [];
      if(command==='recognize_selected_lettering')return sessionStorage.getItem('sew-out-no-ocr')?[]:[{text:'SEEO',font:'Arial'}];
      if(command==='lettering_fonts')return ['Arial'];
      if(command==='preview_selected_lettering')return {id:7,uid:12,view:[-5,-5,10,10],before:plan,after:plan};
      if(command==='preview_density_repair')return {id:8,before:plan,after:{...plan,stitches:26},hits_before:30,hits_after:26,footprint_overlap:97};
      if(command==='preview_coverage_repair')return {id:9,before:plan,after:{...plan,stitches:28},warnings_before:1,warnings_after:0,lettering_before:1,lettering_after:0};
      if(command==='apply_stitch_review'){plan={...plan,stitches:26};return plan;}
      if(command==='fabric_catalog')return [];
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
});

const logged=(page:import('@playwright/test').Page)=>page.evaluate(()=>
  (window as unknown as {sewOutCalls:{command:string;args:Record<string,unknown>}[]}).sewOutCalls);
async function inspector(page:import('@playwright/test').Page){
  const group=page.getByRole('group',{name:'Inspector',exact:true});
  if(!await group.isVisible())await page.getByRole('button',{name:'Inspector',exact:true}).click();
  return group;
}

test('corrects a misread word only after confirmation and can keep the original shapes',async({page})=>{
  // Selecting one shape no longer runs OCR by itself; recognition is an explicit step.
  await page.locator('.design-canvas [data-artwork-uid="12"]').click();
  await (await inspector(page)).getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:'Recognize selected word'}).click();
  let review=page.getByRole('region',{name:'Review recognized lettering'});
  await expect(review.getByRole('textbox',{name:'Original word'})).toHaveValue('SEEO');
  await review.getByRole('textbox',{name:'Original word'}).fill('SEED');
  await expect(review.getByRole('textbox',{name:'Replacement text'})).toHaveValue('SEED');
  await review.getByRole('button',{name:'Keep traced shapes'}).click();
  await expect(review).toHaveCount(0);
  expect((await logged(page)).some(call=>call.command==='preview_selected_lettering')).toBe(false);
  await page.locator('.design-canvas [data-artwork-uid="12"]').click();
  await page.getByRole('button',{name:'Recognize selected word'}).click();
  review=page.getByRole('region',{name:'Review recognized lettering'});
  await review.getByRole('textbox',{name:'Original word'}).fill('SEED');
  await review.getByRole('textbox',{name:'Replacement text'}).fill('GROW');
  await review.getByRole('button',{name:'Preview lettering'}).click();
  await expect(review.getByRole('img',{name:'Editable lettering stitch paths'})).toBeVisible();
  expect((await logged(page)).some(call=>call.command==='apply_stitch_review')).toBe(false);
  await review.getByRole('button',{name:'Replace with editable text'}).click();
  await expect.poll(async()=>(await logged(page)).find(call=>call.command==='apply_stitch_review')?.args).toEqual({id:7});
  await expect.poll(async()=>(await logged(page)).find(call=>call.command==='preview_selected_lettering')?.args)
    .toEqual({uids:[12],text:'SEED',font:'Arial',replacement:'GROW'});
});

test('accepts manual lettering when recognition cannot read the traced shapes',async({page})=>{
  await page.evaluate(()=>sessionStorage.setItem('sew-out-no-ocr','1'));
  await page.locator('.design-canvas [data-artwork-uid="12"]').click();
  await (await inspector(page)).getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:'Recognize selected word'}).click();
  const review=page.getByRole('region',{name:'Review recognized lettering'});
  await expect(review.getByRole('textbox',{name:'Original word'})).toHaveValue('');
  await review.getByRole('textbox',{name:'Original word'}).fill('SEED');
  await review.getByRole('button',{name:'Preview lettering'}).click();
  await expect(review.getByRole('img',{name:'Editable lettering stitch paths'})).toBeVisible();
  expect((await logged(page)).some(call=>call.command==='apply_stitch_review')).toBe(false);
  await review.getByRole('button',{name:'Replace with editable text'}).click();
  await expect.poll(async()=>(await logged(page)).find(call=>call.command==='apply_stitch_review')?.args).toEqual({id:7});
  await expect.poll(async()=>(await logged(page)).find(call=>call.command==='preview_selected_lettering')?.args)
    .toEqual({uids:[12],text:'SEED',font:'Arial',replacement:'SEED'});
});

test('locates a density hotspot and applies the exact reviewed proposal',async({page})=>{
  await page.getByRole('button',{name:'Inspect stitch quality',exact:true}).click();
  await expect(page.getByText('1 objects with suspected coverage gaps')).toBeVisible();
  await page.getByRole('button',{name:'Density map'}).click();
  await page.getByRole('button',{name:'Locate hotspot 1, 30 needle points'}).click();
  await page.getByRole('button',{name:'Preview local repair'}).click();
  const dialog=page.getByRole('dialog',{name:'Local density repair'});
  await dialog.getByRole('button',{name:'Generate comparison'}).click();
  await expect(dialog.getByRole('img',{name:'Proposed local stitch paths'})).toBeVisible();
  await expect(dialog.getByText('Stitch footprint overlap across the design: 97.0%.')).toBeVisible();
  await dialog.getByRole('button',{name:'Apply previewed repair'}).click();
  const calls=await logged(page);
  expect(calls.find(call=>call.command==='preview_density_repair')?.args).toEqual({cell:[0,0],uids:[12]});
  expect(calls.find(call=>call.command==='apply_stitch_review')?.args).toEqual({id:8});
});

test('previews lettering balance separately from coverage repairs',async({page})=>{
  await (await inspector(page)).getByRole('button',{name:'Quality',exact:true}).click();
  await page.getByRole('button',{name:'Preview lettering balance'}).click();
  await expect(page.getByText('Lettering consistency warnings: 1 → 0')).toBeVisible();
  await page.getByRole('button',{name:'Apply quality repair'}).click();
  expect((await logged(page)).find(call=>call.command==='preview_coverage_repair')?.args).toEqual({letteringOnly:true});
  expect((await logged(page)).find(call=>call.command==='apply_stitch_review')?.args).toEqual({id:9});
});

test('shows Poolin mapping, foam and appliqué checks in export review',async({page})=>{
  await page.getByRole('button',{name:'Export design',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Export review'});
  await expect(dialog.getByText('Poolin sew-out checks')).toBeVisible();
  await expect(dialog.getByText('1 of 1 blocks have no spool or needle assignment.')).toBeVisible();
  await expect(dialog.getByText('Puffy lettering',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Appliqué',{exact:true})).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Save sew-out checklist'}).click()]);
  expect(download.suggestedFilename()).toBe('poolin-sew-out-worksheet.html');
});
