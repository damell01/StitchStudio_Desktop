import {expect,test} from '@playwright/test';

test('thread order numbers repeated colors and lets the operator record a needle',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const colors=[[128,20,40],[255,255,255],[128,20,40]];
    const plan={name:'Three thread blocks',stitches:6,trims:0,blocks:colors.map(color=>({color,runs:[[[0,0],[10,12]]]}))};
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string){
      if(command==='current_preview')return plan;
      if(command==='editable_objects'||command==='fabric_catalog')return [];
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const order=page.getByRole('button',{name:'Thread order',exact:true});
  await order.click();
  const dialog=page.getByRole('dialog',{name:'Thread order'});
  await expect(dialog.getByRole('row')).toHaveCount(4);
  await expect(dialog.getByRole('cell',{name:'#801428'})).toHaveCount(2);
  await dialog.getByLabel('Needle or spool for block 3').fill('2');
  await page.keyboard.press('Escape');
  await order.click();
  await expect(dialog.getByLabel('Needle or spool for block 3')).toHaveValue('2');
});
