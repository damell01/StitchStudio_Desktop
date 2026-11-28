import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    localStorage.setItem('studio-threads',JSON.stringify([
      {id:'green',brand:'Demo',code:'17',name:'Garden green',color:'#207043',stock:1},
      {id:'purple',brand:'Demo',code:'42',name:'Lilac',color:'#9971cc',stock:1},
    ]));
    let layers=Array.from({length:8},(_,uid)=>({
      uid,label:`Petal ${uid+1}`,kind:'fill',color:[130,92,157],locked:false,hidden:false,
      path:'M0 0H15V12H0Z',fill_rule:'nonzero',bounds:[0,0,15,12],
    }));
    const preview=()=>({
      name:'Garden',stitches:20,trims:0,
      blocks:[{color:[130,92,157],runs:[[[0,0],[15,12]]]}],
    });
    const calls:unknown[]=[];
    Object.assign(window,{layerCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:{
      uid:number;name?:string;locked?:boolean;hidden?:boolean;direction?:string;targetUid?:number;
    }){
      if(command==='current_preview')return preview();
      if(command==='workspace_tabs')return {active:'garden',tabs:[{id:'garden',name:'Garden',has_design:true}]};
      if(command==='editable_objects')return layers.map(layer=>({...layer}));
      if(command==='set_artwork_layer'){
        calls.push(args);
        layers=layers.map(layer=>layer.uid===args.uid?{
          ...layer,label:args.name??layer.label,locked:args.locked??layer.locked,hidden:args.hidden??layer.hidden,
        }:layer);
        return preview();
      }
      if(command==='reorder_artwork_object'||command==='recolor_block'){calls.push(args);return preview();}
      return null;
    }}});
  });
});

test('desktop keeps the canvas central and puts layer tools in compact dialogs',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const canvas=page.locator('.workspace-canvas');
  const docks=page.getByRole('group',{name:'Workspace view'});
  const layers = docks.getByRole('button',{name:'Layers',exact:true});
  const inspector = docks.getByRole('button',{name:'Inspector',exact:true});
  await expect(layers).toHaveAttribute('aria-pressed','false');
  await expect(inspector).toHaveAttribute('aria-pressed','false');
  await layers.click();
  await inspector.click();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(840);

  const dock=page.locator('.studio-layers-dock');
  await expect(dock.getByRole('button',{name:/Petal 1 Fill/i})).toBeVisible();
  await dock.getByRole('button',{name:'Next page'}).click();
  await expect(dock.getByRole('button',{name:/Petal 7 Fill/i})).toBeVisible();
  const search=dock.getByRole('searchbox',{name:'Search objects'});
  await search.fill('petal 2');
  await dock.getByRole('button',{name:/Petal 2 Fill/i}).click();
  await expect(page.locator('.inspector-context')).toContainText('Petal 2');
  await dock.getByRole('button',{name:'Layer settings'}).click();
  const settings=page.getByRole('dialog',{name:'Layer settings'});
  await settings.getByRole('textbox',{name:'Layer name'}).fill('Middle petal');
  await settings.getByRole('button',{name:'Rename layer'}).click();
  await expect(settings).toBeHidden();
  await search.fill('middle');
  const renamed=dock.getByRole('button',{name:/Middle petal Fill/i});
  await expect(renamed).toBeVisible();
  await dock.getByRole('button',{name:'Lock Middle petal'}).click();
  await expect(renamed).toBeDisabled();
  await dock.getByRole('button',{name:'Unlock Middle petal'}).click();
  await expect(renamed).toBeEnabled();
  await dock.getByRole('button',{name:'Hide Middle petal'}).click();
  await expect(canvas.locator('[data-artwork-uid="1"]')).toHaveCount(0);
  await dock.getByRole('button',{name:'Show Middle petal'}).click();
  await expect(canvas.locator('[data-artwork-uid="1"]')).toBeVisible();

  await search.fill('');
  await dock.getByRole('button',{name:'Previous page'}).click();
  const source=dock.locator('.studio-layer-item').filter({hasText:'Petal 1'}).locator('.studio-layer-grip');
  const target=dock.locator('.studio-layer-item').filter({hasText:'Middle petal'});
  const targetBox=(await target.boundingBox())!;
  await source.dragTo(target,{targetPosition:{x:Math.round(targetBox.width/2),y:Math.round(targetBox.height*.8)}});
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {layerCalls:unknown[]}).layerCalls.at(-1)))
    .toEqual({uid:0,direction:'after',targetUid:1});

  await dock.getByRole('button',{name:'Blocks'}).click();
  await dock.getByRole('button',{name:'Assign saved thread 1'}).click();
  const picker=page.getByRole('dialog',{name:'Choose saved thread for color 1'});
  await picker.getByRole('searchbox',{name:'Search saved threads'}).fill('lilac');
  await expect(picker.getByRole('button',{name:/Garden green/})).toHaveCount(0);
  await picker.getByRole('button',{name:/Lilac/}).click();
  await expect(dock.getByRole('button',{name:'Blocks'})).toHaveAttribute('aria-pressed','true');
});

test('narrow windows offer one tool drawer at a time and keep the camera toolbar outside the artwork',async({page})=>{
  await page.setViewportSize({width:900,height:650});
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const canvas=page.locator('.workspace-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.studio-layers-dock')).toBeHidden();
  await expect(page.locator('.studio-inspector-dock')).toBeHidden();
  const canvasBox=(await canvas.boundingBox())!;
  expect(canvasBox.width).toBeGreaterThan(880);
  const docks=page.getByRole('group',{name:'Workspace view'});
  await docks.getByRole('button',{name:'Layers',exact:true}).click();
  await expect(page.locator('.studio-layers-dock')).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBe(canvasBox.width);
  await docks.getByRole('button',{name:'Inspector',exact:true}).click();
  await expect(page.locator('.studio-layers-dock')).toBeHidden();
  await expect(page.locator('.studio-inspector-dock')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio-inspector-dock')).toBeHidden();

  const toolbar=page.getByRole('group',{name:'Canvas view'});
  await toolbar.getByRole('button',{name:'Move camera controls to bottom'}).click();
  await expect(toolbar).toHaveClass(/studio-camera-bottom/);
  const before=(await canvas.boundingBox())!;
  expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(before.y+before.height-1);
  await toolbar.getByRole('button',{name:'Move camera controls to top'}).click();
  await expect(toolbar).toHaveClass(/studio-camera-top/);
  const top=(await toolbar.boundingBox())!;
  expect(top.y+top.height).toBeLessThanOrEqual((await canvas.boundingBox())!.y+1);
});

test('the canvas occupies at least three quarters of the window with both docks closed',async({page})=>{
  await page.setViewportSize({width:1280,height:668});
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await expect(page.getByRole('heading',{name:'Garden'})).toBeVisible();
  await expect(page.getByRole('tab',{name:'Garden'})).toBeVisible();
  const canvas=page.locator('.design-canvas');
  const zoom=page.getByRole('button',{name:'Reset zoom to 100%'});
  await expect(zoom).toHaveText('350%');

  const canvasBox=(await canvas.boundingBox())!;
  expect(canvasBox.width*canvasBox.height/(1280*668)).toBeGreaterThanOrEqual(.75);
  const stitch=canvas.locator('[data-stitch-block]').first();
  const originalPoints=await stitch.getAttribute('d');

  await page.getByRole('button',{name:'Fit hoop view'}).click();
  const hoop=(await canvas.locator('.studio-hoop').boundingBox())!;
  expect(hoop.height).toBeGreaterThan(canvasBox.height*.8);
  expect(hoop.y+hoop.height).toBeLessThanOrEqual(canvasBox.y+canvasBox.height);
  await page.getByRole('button',{name:'Fit artwork'}).click();
  await expect(zoom).toHaveText('400%');
  await expect(stitch).toHaveAttribute('d',originalPoints!);
});
