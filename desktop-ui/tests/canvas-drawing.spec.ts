import {expect, test} from '@playwright/test';

test('measures without altering stitches and commits a dragged shape in physical coordinates', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const edits:unknown[]=[];
    const plan={name:'Drawing',stitches:3,trims:0,blocks:[{color:[105,69,162],runs:[[[0,0],[15,0],[15,6]]]}]};
    Object.assign(window,{canvasEdits:edits,__TAURI_INTERNALS__:{async invoke(command:string,args:unknown){
      if(command==='editable_objects')return [];
      if(command==='draw_canvas_shape'){edits.push(args);return plan;}
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  const canvas=page.locator('.design-canvas');
  const edits=()=>page.evaluate(()=>(window as unknown as {canvasEdits:unknown[]}).canvasEdits);
  await canvas.waitFor();
  const xy=await canvas.evaluate(el=>{
    const svg=el as unknown as SVGSVGElement;
    const start=new DOMPoint(-12,-6).matrixTransform(svg.getScreenCTM()!);
    const end=new DOMPoint(14,8).matrixTransform(svg.getScreenCTM()!);
    return [start.x,start.y,end.x,end.y];
  });
  async function draw(){
    await page.mouse.move(xy[0],xy[1]);
    await page.mouse.down();
    await page.mouse.move(xy[2],xy[3],{steps:5});
    await page.mouse.up();
  }

  const menu=page.locator('.canvas-drawing-menu summary');
  await menu.click();
  await page.getByRole('button',{name:'Measure',exact:true}).click();
  await draw();
  await expect(canvas.locator('[aria-label="Diagonal measurement"]')).toContainText('mm');
  expect(await edits()).toHaveLength(0);

  await menu.click();
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await draw();
  await expect.poll(async ()=>(await edits()).length).toBe(1);
  const [request]=await edits() as {tool:string;points:number[][]}[];
  expect(request.tool).toBe('rectangle');
  expect(request.points[0][0]).toBeCloseTo(-12,0);
  expect(request.points[1][1]).toBeCloseTo(8,0);

  await menu.click();
  await page.getByRole('button',{name:'Satin column',exact:true}).click();
  async function dragLine(from:number[],to:number[]){
    const screen=await canvas.evaluate((element,pair)=>{
      const matrix=(element as unknown as SVGSVGElement).getScreenCTM()!;
      return pair.map(point=>{
        const p=new DOMPoint(point[0],point[1]).matrixTransform(matrix);
        return [p.x,p.y];
      });
    },[from,to]);
    await page.mouse.move(screen[0][0],screen[0][1]);
    await page.mouse.down();
    await page.mouse.move(screen[1][0],screen[1][1],{steps:8});
    await page.mouse.up();
  }
  await dragLine([-10,-4],[12,-4]);
  await dragLine([-10,0],[12,0]);
  await dragLine([0,-5],[0,1]);
  expect(await edits()).toHaveLength(1);
  await page.getByRole('button',{name:'Finish satin column'}).click();
  await expect.poll(async ()=>(await edits()).length).toBe(2);
  const column=(await edits())[1] as {tool:string;subpaths:number[][][]};
  expect(column.tool).toBe('satinColumn');
  expect(column.subpaths).toHaveLength(3);

});
