import {expect,test} from '@playwright/test';

test('garment choices and placement offsets update the preview without editing design data', async ({page})=>{
  await page.setViewportSize({width:900,height:650});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const plan={name:'Two color design',stitches:4,trims:0,blocks:[
      {color:[115,62,154],runs:[[[-18,0],[18,0]]]},
      {color:[186,79,113],runs:[[[0,-10],[0,18]]]},
    ]};
    const calls:string[]=[];
    Object.assign(window,{mockupCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string){
      calls.push(command);
      if(command==='current_preview')return plan;
      if(command==='editable_objects'||command==='fabric_catalog')return [];
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const original=await page.locator('.design-canvas polyline').first().getAttribute('points');
  await page.getByRole('button',{name:'Garment mockup'}).click();
  const dialog=page.getByRole('dialog',{name:'Garment mockup'});
  const image=dialog.locator('canvas');
  await expect(image).toHaveAccessibleName('Design on adult T-shirt, left chest (wearer)');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('cap');
  await expect(image).toHaveAccessibleName('Design on adult Cap, cap front');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('shorts');
  await dialog.getByLabel('Placement',{exact:true}).selectOption('1');
  await expect(image).toHaveAccessibleName('Design on adult Shorts, right leg (wearer)');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('hoodie');
  await dialog.getByLabel('Garment size',{exact:true}).selectOption('toddler');
  await expect(image).toHaveAccessibleName('Design on toddler Hoodie, left chest (wearer)');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('shorts');
  await dialog.getByLabel('Placement',{exact:true}).selectOption('1');
  const canvas=dialog.locator('canvas');
  await expect.poll(()=>canvas.evaluate(element=>(element as HTMLCanvasElement).getContext('2d')?.getImageData(418,588,1,1).data[3])).toBeGreaterThan(0);
  await dialog.getByLabel('Horizontal').fill('8');
  await expect(dialog.getByRole('status')).toContainText('beyond');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.design-canvas polyline').first()).toHaveAttribute('points',original!);
  const changes=await page.evaluate(()=>(window as unknown as {mockupCalls:string[]}).mockupCalls);
  expect(changes).not.toContain('transform_design');
  expect(changes).not.toContain('edit_artwork_object');
});
