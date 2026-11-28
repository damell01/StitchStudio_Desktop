import {expect,test} from '@playwright/test';

test.use({storageState:{cookies:[],origins:[]}});

test('the editor starts in simple mode with labelled everyday actions and reveals every tool on request',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const plan={name:'Mia bow',stitches:5,trims:0,blocks:[{color:[230,120,150],runs:[[[0,0],[10,0]]]}]};
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(c:string){
      if(c==='workspace_overview')return {current:'Mia bow',recovery:false};
      if(c==='current_preview')return plan;
      return ['editable_objects','character_list','personal_designs'].includes(c)?[]:null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  const bar=page.getByRole('group',{name:'Design commands'});
  for(const name of ['Insert design','Undo','Add editable text','Save design','Export design'])
    await expect(bar.getByRole('button',{name,exact:true})).toBeVisible();
  for(const name of ['Garment mockup','Thread order','Center design in hoop','Search commands'])
    await expect(bar.getByRole('button',{name,exact:true})).toBeHidden();
  await expect(page.getByRole('group',{name:'Editor tools'}).getByRole('button',{name:'Quality panel'})).toBeHidden();

  await bar.getByRole('button',{name:'More tools'}).click();
  await expect(bar.getByRole('button',{name:'Garment mockup',exact:true})).toBeVisible();
  await expect(bar.getByRole('button',{name:'Fewer tools'})).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await page.getByRole('button',{name:/Continue current design/}).click();
  await expect(bar.getByRole('button',{name:'Garment mockup',exact:true})).toBeVisible();
});
