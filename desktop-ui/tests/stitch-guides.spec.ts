import {expect, test} from '@playwright/test';

test('reuses object settings and drags a pinned sewing entry in design units', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const calls: {command:string;args:Record<string,unknown>}[]=[];
    const plan={name:'Sewing guides',stitches:8,trims:0,blocks:[{color:[90,50,110],runs:[
      [[-22,-8],[-8,-8],[-8,8],[-22,8]],[[8,-8],[22,-8],[22,8],[8,8]],
    ]}]};
    const objects=[
      {uid:10,label:'Source patch',kind:'fill',color:[90,50,110],bounds:[-22,-8,14,16],path:'M-22 -8H-8V8H-22Z'},
      {uid:11,label:'Target patch',kind:'fill',color:[90,50,110],bounds:[8,-8,14,16],path:'M8 -8H22V8H8Z'},
    ];
    Object.assign(window,{guideCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      calls.push({command,args});
      if(command==='current_preview'||command==='paste_object_stitch_settings'||command==='edit_object_stitch_controls')return {...plan};
      if(command==='editable_objects')return objects;
      if(command==='object_stitch_guides'){
        return {order:args.order?[[1,[-15,0]],[2,[15,0]]]:[],
          center:args.uid===11?[15,0]:[-15,0],angle:0,entry:args.uid===11?[8,-8]:[-22,-8],exit:args.uid===11?[22,8]:[-8,8],
          pinnedEntry:false,pinnedExit:false,rails:[],rungs:[],textForm:null,reverses:false};
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const canvas=page.locator('.design-canvas');
  const select=(uid:number)=>canvas.locator('[data-artwork-uid="'+uid+'"]').click();
  const calls=()=>page.evaluate(()=>(window as unknown as {guideCalls:{command:string;args:Record<string,unknown>}[]}).guideCalls);
  await select(10);
  await page.getByRole('group',{name:'Editor tools'}).getByRole('button',{name:'Stitches'}).click();
  await page.getByRole('button',{name:'Object stitch tools'}).click();
  const dialog=page.getByRole('dialog',{name:'Object stitch tools'});
  await dialog.getByRole('button',{name:'Copy stitch settings'}).click();
  await dialog.getByRole('button',{name:'Show sewing order'}).click();
  await dialog.getByRole('button',{name:'Show stitch guides'}).click();
  await dialog.getByRole('button',{name:'Close object stitch tools'}).click();
  await expect(canvas.locator('.stitch-order-marker')).toHaveCount(2);
  await select(11);
  await page.getByRole('button',{name:'Object stitch tools'}).click();
  await dialog.getByRole('button',{name:'Paste stitch settings'}).click();
  await dialog.getByRole('button',{name:'Close object stitch tools'}).click();

  const entry=canvas.locator('[data-stitch-handle="entry"]');
  await expect(entry).toHaveAttribute('cx','8');
  const start=(await entry.boundingBox())!;
  const target=await canvas.evaluate(element=>{
    const point=new DOMPoint(19,-8).matrixTransform((element as unknown as SVGSVGElement).getScreenCTM()!);
    return [point.x,point.y];
  });
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.mouse.move(target[0],target[1],{steps:4});
  await page.mouse.up();
  expect((await calls()).find(call=>call.command==='copy_object_stitch_settings')?.args).toEqual({uid:10});
  expect((await calls()).find(call=>call.command==='paste_object_stitch_settings')?.args).toEqual({uids:[11]});
  const edit=(await calls()).find(call=>call.command==='edit_object_stitch_controls')?.args;
  expect(edit).toMatchObject({uid:11,action:{type:'entry'}});
  const point=(edit!.action as {point:number[]}).point;
  expect(point[0]).toBeCloseTo(19,0);
  expect(point[1]).toBeCloseTo(-8,0);
});
