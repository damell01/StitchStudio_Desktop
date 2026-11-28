import {expect,test,type Page} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    localStorage.setItem('studio-auto-detect-text','1');
    const calls:{command:string;args:Record<string,unknown>}[]=[];
    const plan={name:'Mia bow',stitches:120,trims:0,blocks:[
      {color:[60,40,90],runs:[[[0,0],[6,0],[6,8]],[[8,0],[14,0],[14,8]],[[16,0],[22,0],[22,8]]]},
      {color:[230,120,150],runs:[[[0,12],[22,12]]]},
    ]};
    const objects=[0,8,16].map((x,i)=>({uid:i+1,label:'Letter '+(i+1),kind:'fill',color:[60,40,90],fill_rule:'nonzero',bounds:[x,0,6,8],path:`M${x} 0H${x+6}V8H${x}Z`,locked:false,hidden:false}))
      .concat([{uid:4,label:'Bow',kind:'satin',color:[230,120,150],fill_rule:'nonzero',bounds:[0,11,22,3],path:'M0 11H22V14H0Z',locked:false,hidden:false}]);
    Object.assign(window,{editCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      calls.push({command,args});
      if(command==='workspace_overview')return {current:'Mia bow',recovery:false};
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return objects;
      if(command==='lettering_fonts')return ['Arial','Georgia'];
      if(command==='lettering_settings')return null;
      if(command==='recognize_selected_lettering')return [{text:'Mia',font:'Georgia'}];
      if(command==='preview_selected_lettering')return {id:7,uid:9,before:plan,after:plan,view:[0,0,22,8]};
      if(['apply_stitch_review','replace_design_color','recolor_artwork_group'].includes(command))return plan;
      return ['character_list','personal_designs'].includes(command)?[]:null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
});

const calls=(page:Page,command:string)=>page.evaluate(c=>(window as unknown as {editCalls:{command:string;args:Record<string,unknown>}[]}).editCalls.filter(x=>x.command===c).map(x=>x.args),command);

test('design colors list every thread color and recolor the whole design in one step',async({page})=>{
  const bar=page.getByRole('group',{name:'Design colors'});
  await expect(bar.getByRole('button',{name:/^Change #/})).toHaveCount(2);
  await bar.getByRole('button',{name:'Change #e67896'}).click();
  const picker=page.getByRole('dialog',{name:'Change color #e67896'});
  await picker.getByRole('button',{name:'Use #1f6fb2'}).click();
  await expect.poll(async()=>(await calls(page,'replace_design_color')).length).toBe(1);
  expect((await calls(page,'replace_design_color'))[0]).toEqual({previous:[230,120,150],color:[31,111,178]});
});

test('double-clicking a detected word opens an inline editor that restitches it as lettering',async({page})=>{
  await expect(page.locator('.studio-detected-text summary')).toContainText('1');
  const box=(await page.locator('[data-artwork-uid="2"]').first().boundingBox())!;
  await page.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);
  const editor=page.getByRole('form',{name:'Edit this word'});
  await expect(editor.getByLabel('New word')).toHaveValue('Mia');
  await expect(editor.getByLabel('Font')).toHaveValue('Georgia');
  await editor.getByLabel('New word').fill('Ava');
  await editor.getByLabel('New word').press('Enter');
  await expect.poll(async()=>(await calls(page,'apply_stitch_review')).length).toBe(1);
  expect((await calls(page,'preview_selected_lettering'))[0]).toMatchObject({uids:[1,2,3],text:'Mia',font:'Georgia',replacement:'Ava'});
  await expect(editor).toBeHidden();
});

test('words in an already-stitched machine file can be clicked and retyped',async({page})=>{
  await page.evaluate(()=>{
    // Re-shape the mock: a DST opens as fixed-stitch objects (no fill), one per sewn run.
    const w=window as unknown as {__TAURI_INTERNALS__:{invoke:(c:string,a:Record<string,unknown>)=>Promise<unknown>}};
    const original=w.__TAURI_INTERNALS__.invoke;
    const stitched=[0,8,16].map((x,i)=>({uid:i+1,label:'stitches_1_'+(i+1)+'_manual',kind:'manual',color:[60,40,90],bounds:[x,0,6,8],
      path:`M${x} 8L${x+3} 0L${x+6} 8M${x+1} 5H${x+5}`,stroke_width:0.4,locked:false,hidden:false}));
    w.__TAURI_INTERNALS__.invoke=async(c,a)=>c==='editable_objects'?stitched:original(c,a);
  });
  await page.getByRole('button',{name:'Home',exact:true}).click();
  await page.getByRole('button',{name:/Continue current design/}).click();
  await expect(page.locator('.studio-detected-text summary')).toContainText('1');
  const box=(await page.locator('[data-artwork-uid="2"]').first().boundingBox())!;
  await page.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);
  const editor=page.getByRole('form',{name:'Edit this word'});
  await expect(editor.getByLabel('New word')).toHaveValue('Mia');
  await editor.getByLabel('New word').fill('Ava');
  await editor.getByLabel('New word').press('Enter');
  await expect.poll(async()=>(await calls(page,'apply_stitch_review')).length).toBe(1);
  expect((await calls(page,'preview_selected_lettering'))[0]).toMatchObject({uids:[1,2,3],replacement:'Ava'});
});
