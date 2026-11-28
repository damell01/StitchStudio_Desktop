import {expect,test} from '@playwright/test';

test('types lettering at the clicked design coordinates and preserves existing stitches', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const block={color:[10,50,80],runs:[[[-25,0],[-20,2],[-15,1]]]};
    let current={name:'Existing design',stitches:3,trims:0,blocks:[block]};
    const calls:Record<string,unknown>[]=[];
    Object.assign(window,{letteringCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='workspace_overview')return {current:current.name,recovery:false};
      if(command==='current_preview')return current;
      if(command==='editable_objects')return [];
      if(command==='lettering_fonts')return ['Arial'];
      if(command==='insert_lettering_settings'){
        calls.push(args);
        const [x,y]=args.placement as number[];
        current={...current,stitches:6,blocks:[block,{color:[105,69,162],runs:[[[x,y],[x+1,y],[x+1,y+1]]]}]};
        return current;
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Continue current design/}).click();
  const canvas=page.locator('.design-canvas');
  const existing=canvas.locator('[data-stitch-block]').first();
  await expect(existing).toBeVisible();
  const initial=await existing.getAttribute('d');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.locator('summary[aria-label="Create and edit tools"]').click();
  await page.getByRole('button',{name:'Type on canvas',exact:true}).click();
  const point=await canvas.evaluate(element=>{
    const p=new DOMPoint(12,-13).matrixTransform((element as unknown as SVGSVGElement).getScreenCTM()!);
    return [p.x,p.y];
  });
  await page.mouse.click(point[0],point[1]);
  const input=page.getByRole('textbox',{name:'Canvas lettering'});
  await expect(input).toBeFocused();
  await input.fill('New text');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(existing).toHaveAttribute('d',initial!);
  const [call]=await page.evaluate(()=>(window as unknown as {letteringCalls:Record<string,unknown>[]}).letteringCalls);
  expect(call.settings).toMatchObject({text:'New text',font:'Arial'});
  expect((call.placement as number[])[0]).toBeCloseTo(12,0);
  expect((call.placement as number[])[1]).toBeCloseTo(-13,0);
});
