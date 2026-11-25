import { expect, test } from '@playwright/test';

test('canvas selection edits the chosen vector and the pan tool only changes the camera', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen','1');
    const calls: {uid:number; operation:{kind:string; dx?:number; dy?:number}}[] = [];
    const plan = {name:'Two shapes', stitches:4, trims:0, blocks:[{color:[88,52,108], runs:[[[-16,-5],[-5,4]],[[8,-3],[18,8]]]}]};
    const objects = [
      {uid:10,label:'Plum rectangle',kind:'fill',color:[88,52,108],bounds:[-16,-5,11,9],path:'M-16 -5H-5V4H-16Z',fill_rule:'nonzero',stroke_width:0},
      {uid:11,label:'Companion',kind:'fill',color:[88,52,108],bounds:[8,-3,10,11],path:'M8 -3H18V8H8Z',fill_rule:'nonzero',stroke_width:0},
    ];
    Object.assign(window,{objectEdits:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:typeof calls[number]) {
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return objects;
      if(command==='edit_artwork_object'){calls.push(args);return plan;}
      return command==='character_list'?[]:null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const canvas=page.locator('.design-canvas');
  const rect=canvas.locator('[data-artwork-uid="10"]');
  await rect.click();
  const selection=page.getByRole('group',{name:'Selected object actions'});
  await expect(selection).toContainText('Plum rectangle');
  const box=(await rect.boundingBox())!;
  const x=box.x+box.width/2, y=box.y+box.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+25,y+15,{steps:4});
  await page.mouse.up();
  await selection.getByRole('button',{name:'Duplicate selection'}).click();
  await expect.poll(()=>page.evaluate(()=> (window as unknown as {objectEdits:{uid:number;operation:{kind:string}}[]}).objectEdits.map(edit=>[edit.uid,edit.operation.kind]))).toEqual([[10,'move'],[10,'duplicate']]);
  const resize=canvas.locator('[data-resize-handle="4"]');
  await expect(resize).toBeVisible();
  const handle=(await resize.boundingBox())!;
  const hx=handle.x+handle.width/2,hy=handle.y+handle.height/2;
  await page.mouse.move(hx,hy);
  await page.mouse.down();
  await page.mouse.move(hx+30,hy+20,{steps:4});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {objectEdits:{operation:{kind:string;sx?:number;sy?:number}}[]}).objectEdits.at(-1)?.operation)).toMatchObject({kind:'resize'});
  await page.getByRole('button',{name:'Move camera controls to top'}).click();
  await expect(page.getByRole('group',{name:'Canvas view'})).toHaveClass(/studio-camera-top/);
  const points=await canvas.locator('polyline').evaluateAll(lines=>lines.map(line=>line.getAttribute('points')));
  await page.getByRole('button',{name:'Pan canvas',exact:true}).click();
  const view=await canvas.getAttribute('viewBox');
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x-50,y+20,{steps:4});
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('viewBox',view!);
  for(let step=0;step<4;step++){
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  }
  expect(await canvas.locator('polyline').evaluateAll(lines=>lines.map(line=>line.getAttribute('points')))).toEqual(points);
  expect(await page.evaluate(()=>(window as unknown as {objectEdits:unknown[]}).objectEdits.length)).toBe(3);
});
