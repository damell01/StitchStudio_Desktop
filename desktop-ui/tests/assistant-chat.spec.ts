import {expect,test} from '@playwright/test';

test('the assistant remains hidden from the Studio toolbar and command palette',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string){
      if(command==='editable_objects')return [];
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Blank design',exact:true}).last().click();
  await expect(page.locator('.design-canvas')).toBeVisible();
  await expect(page.getByRole('button',{name:'Offline design assistant'})).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog',{name:'Search commands'})).toBeVisible();
  await page.getByRole('textbox',{name:'Find an action or page'}).fill('design assistant');
  await expect(page.getByRole('dialog',{name:'Search commands'}).getByText('No matching commands.')).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Design assistant'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/design assistant/i})).toHaveCount(0);
});
