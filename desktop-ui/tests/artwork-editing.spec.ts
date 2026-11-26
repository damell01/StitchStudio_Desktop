import { expect, test } from '@playwright/test';

for (const mode of ['selection','oval'] as const) {
test('solid fill from '+mode+' previews only the chosen artwork until applied', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen','1');
    const plan = {name:'Bow logo', stitches:120, trims:8, blocks:[{color:[88,52,108],runs:[[[-16,-5],[-5,4]]]}]};
    const objects = [
      {uid:10,label:'Bow',kind:'fill',color:[88,52,108],bounds:[-16,-5,11,9],path:'M-16 -5H-5V4H-16Z',fill_rule:'nonzero'},
      {uid:11,label:'Lettering',kind:'fill',color:[88,52,108],bounds:[8,-3,10,11],path:'M8 -3H18V8H8Z',fill_rule:'nonzero'},
    ];
    const calls: unknown[]=[];
    const solid={...plan,stitches:65,trims:2};
    Object.assign(window,{solidCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:unknown) {
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return objects;
      if(command==='preview_simplification'){
        calls.push([command,args]);return {id:71,variants:[{strength:4,plan:solid,reason:null,quality:{coverage:93,density_peak:12}}]};
      }
      if(command==='apply_simplification'){calls.push([command,args]);return solid;}
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  if (mode === 'selection') {
    await page.locator('.design-canvas [data-artwork-uid="10"]').click();
    await page.getByRole('button',{name:'Make selection solid'}).click();
  } else {
    await page.getByRole('button',{name:'Solid area',exact:true}).click();
    await page.getByRole('button',{name:'Oval',exact:true}).click();
    const [start,end] = await page.locator('svg.design-canvas').evaluate(svg => {
      const matrix = (svg as SVGSVGElement).getScreenCTM()!;
      return [new DOMPoint(-24,-13),new DOMPoint(3,12)].map(point => {
        const {x,y} = point.matrixTransform(matrix);
        return {x,y};
      });
    });
    await page.mouse.move(start.x,start.y);
    await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:5});
    await page.mouse.up();
  }
  const dialog=page.getByRole('dialog',{name:'Simplify design'});
  await expect(dialog.getByText('65 stitches')).toBeVisible();
  const calls=()=>page.evaluate(()=>(window as unknown as {solidCalls:unknown[]}).solidCalls);
  expect(await calls()).toEqual([['preview_simplification',expect.objectContaining({uids:[10],options:expect.objectContaining({solidOnly:true})})]]);
  if (mode === 'oval') {
    await dialog.getByLabel('Fill thread color').fill('#2050aa');
    await expect.poll(async ()=>(await calls()).at(-1)).toEqual(
      ['preview_simplification',expect.objectContaining({uids:[10],options:expect.objectContaining({solidColor:[32,80,170]})})],
    );
    await expect(dialog.getByText('65 stitches')).toBeVisible();
  }
  await dialog.getByRole('button',{name:'Apply selected design'}).click();
  await expect(dialog).toBeHidden();
  expect((await calls()).at(-1)).toEqual(['apply_simplification',{id:71,strength:4}]);
});

}

test('canvas selection edits the chosen vector and the pan tool only changes the camera', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen','1');
    const moves:unknown[]=[];
    const calls: {uid:number; operation:{kind:string; dx?:number; dy?:number}}[] = [];
    const plan = {name:'Two shapes', stitches:4, trims:0, blocks:[{color:[88,52,108], runs:[[[-16,-5],[-5,4]],[[8,-3],[18,8]]]}]};
    const objects = [
      {uid:10,label:'Plum rectangle',kind:'fill',color:[88,52,108],bounds:[-16,-5,11,9],path:'M-16 -5H-5V4H-16Z',fill_rule:'nonzero',stroke_width:0},
      {uid:11,label:'Companion',kind:'fill',color:[88,52,108],bounds:[8,-3,10,11],path:'M8 -3H18V8H8Z',fill_rule:'nonzero',stroke_width:0},
    ];
    Object.assign(window,{objectEdits:calls,groupMoves:moves,__TAURI_INTERNALS__:{async invoke(command:string,args:typeof calls[number]) {
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return objects;
      if(command==='transform_design'){moves.push(args);return plan;}
      if(command==='edit_artwork_object'){calls.push(args);return plan;}
      if(command==='resize_artwork_selection'){calls.push({uid:10,operation:{kind:'resize'}});return plan;}
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
  expect(await page.evaluate(()=>(window as unknown as {objectEdits:unknown[]}).objectEdits)).toHaveLength(0);
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
  await expect(resize).toHaveAttribute('pointer-events','all');
  const handle=(await resize.boundingBox())!;
  const hx=handle.x+handle.width/2,hy=handle.y+handle.height/2;
  await page.mouse.move(hx,hy);
  await page.mouse.down();
  await page.mouse.move(hx+30,hy+20,{steps:4});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {objectEdits:{operation:{kind:string;sx?:number;sy?:number}}[]}).objectEdits.at(-1)?.operation)).toMatchObject({kind:'resize'});
  await page.getByRole('button',{name:'Move camera controls to bottom'}).click();
  await expect(page.getByRole('group',{name:'Canvas view'})).toHaveClass(/studio-camera-bottom/);
  await page.getByRole('button',{name:'Move camera controls to top'}).click();
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
  await page.getByRole('button',{name:'Move whole design',exact:true}).click();
  const group=canvas.locator('[data-design-group]');
  await expect(group).toBeVisible();
  const groupBox=(await group.boundingBox())!;
  const gx=groupBox.x+groupBox.width/2,gy=groupBox.y+groupBox.height/2;
  await page.mouse.move(gx,gy);
  await page.mouse.down();
  await page.mouse.move(gx+28,gy+18,{steps:4});
  await page.mouse.up();
  const moves=await page.evaluate(()=>(window as unknown as {groupMoves:{dx:number;dy:number}[]}).groupMoves);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({scale:1,rotation:0,dx:expect.any(Number),dy:expect.any(Number)});
  expect(moves[0].dx).toBeGreaterThan(0);

});
