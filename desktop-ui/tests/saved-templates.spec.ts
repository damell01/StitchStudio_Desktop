import {expect,test} from '@playwright/test';

test('imports a ZIP into editable templates and opens a selected layout in the studio',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const layout={name:'Birthday layout',stitches:2,trims:0,blocks:[{color:[105,69,162],runs:[[[0,0],[15,12]]]}]};
    let imported=false;
    let opened=false;
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string,args?:{file:string}){
      if(command==='import_template_archive'){imported=true;return {imported:2,duplicates:0,skipped:1};}
      if(command==='saved_templates')return imported?['Birthday layout.stitchstudio','Spring layout.stitchstudio']:[];
      if(command==='preview_saved_template'&&args?.file==='Birthday layout.stitchstudio')return layout;
      if(command==='open_saved_template'&&args?.file==='Birthday layout.stitchstudio'){
        opened=true;
        return {plan:layout,width:100,height:100,format:'pes'};
      }
      if(command==='current_preview'&&opened)return layout;
      return ['editable_objects','character_list','fabric_catalog'].includes(command)?[]:null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Template Library/}).last().click();
  await page.getByRole('button',{name:'My editable templates'}).click();
  await page.getByRole('button',{name:'Import template ZIP'}).click();
  await expect(page.getByRole('status')).toContainText('2 imported');
  await page.getByRole('searchbox',{name:'Search my templates'}).fill('birthday');
  await expect(page.getByRole('button',{name:/Preview Spring/})).toBeHidden();
  await page.getByRole('button',{name:'Preview Birthday layout.stitchstudio'}).click();
  await expect(page.getByRole('img',{name:'Template stitch preview'})).toBeVisible();
  await page.getByRole('button',{name:'Use as new design'}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Birthday layout'})).toBeVisible();
  await expect(page.locator('.design-canvas polyline')).toHaveCount(1);
});
