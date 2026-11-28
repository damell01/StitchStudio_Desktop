import {expect,test,type Locator,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.use({launchOptions:{executablePath:process.env.STITCH_TEST_CHROMIUM,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});

async function readProof(page:Page,dialog:Locator,filename:string) {
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button',{name:'Save mockup PNG'}).click(),
  ]);
  expect(download.suggestedFilename()).toBe(filename);
  const file=await download.path();
  expect(file).not.toBeNull();
  const png=await readFile(file!);
  expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  return page.evaluate(async encoded=>{
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const {width,height}=bitmap;
    const buffer=new OffscreenCanvas(width,height);
    const context=buffer.getContext('2d')!;
    context.drawImage(bitmap,0,0);
    bitmap.close();
    const {data}=context.getImageData(0,0,width,height);
    let green=0,red=0,pixelHash=2166136261;
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      if(g>r+30&&g>b+25)green++;
      if(r>g+25&&r>b+10)red++;
      pixelHash=Math.imul(pixelHash^(r|g<<8|b<<16),16777619);
    }
    return {width,height,green,red,pixelHash};
  },png.toString('base64'));
}

test('garment choices and placement offsets update the preview without editing design data', async ({page})=>{
  test.setTimeout(60000);
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
  const original=await page.locator('.design-canvas [data-stitch-block]').first().getAttribute('d');
  await page.getByRole('button',{name:'Garment mockup'}).click();
  const dialog=page.getByRole('dialog',{name:'Garment mockup'});
  const image=dialog.locator('canvas');
  await expect(image).toHaveAccessibleName('Design on adult T-shirt, left chest (wearer)');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('cap');
  await expect(image).toHaveAccessibleName('Design on adult Cap, cap front');
  await dialog.getByLabel('Garment',{exact:true}).selectOption('shorts');
  await dialog.getByLabel('Placement',{exact:true}).selectOption('1');
  await expect(image).toHaveAccessibleName('Design on adult Shorts, right leg (wearer)');
  await dialog.getByLabel('Garment size',{exact:true}).selectOption('toddler');
  await expect(image).toHaveAccessibleName('Design on toddler Shorts, right leg (wearer)');
  const canvas=dialog.locator('canvas');
  await expect.poll(()=>canvas.evaluate(element=>(element as HTMLCanvasElement).getContext('2d')?.getImageData(418,588,1,1).data[3])).toBeGreaterThan(0);
  await dialog.getByLabel('Fabric color').fill('#17a34a');
  const proof=await readProof(page,dialog,'stitch-studio-shorts-toddler-mockup.png');
  expect(proof).toMatchObject({width:1200,height:880});
  expect(proof.green).toBeGreaterThan(10000);
  await dialog.getByText('Precise placement (optional)',{exact:true}).click();
  await dialog.getByLabel('Horizontal').fill('8');
  await expect(dialog.getByRole('status')).toContainText('beyond');
  const movedProof=await readProof(page,dialog,'stitch-studio-shorts-toddler-mockup.png');
  expect(movedProof.green).toBeGreaterThan(10000);
  expect(movedProof.pixelHash).not.toEqual(proof.pixelHash);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.design-canvas [data-stitch-block]').first()).toHaveAttribute('d',original!);
  const changes=await page.evaluate(()=>(window as unknown as {mockupCalls:string[]}).mockupCalls);
  expect(changes).not.toContain('transform_design');
  expect(changes).not.toContain('edit_artwork_object');
});

test('renders the offline model and responds to rotation and fabric color',async({page})=>{
    test.setTimeout(60000);
    await page.addInitScript(()=>{
      localStorage.setItem('studio-tour-seen','1');
      Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string){
        if(command==='current_preview')return {name:'Test design',stitches:3,trims:0,blocks:[
          {color:[115,62,154],runs:[[[-18,0],[18,0],[0,20]]]},
        ]};
        return command==='editable_objects'||command==='fabric_catalog'?[]:null;
      }}});
    });
    await page.goto('/');
    await page.getByRole('button',{name:/Blank design/}).last().click();
    await page.getByRole('button',{name:'Garment mockup'}).click();
    const dialog=page.getByRole('dialog',{name:'Garment mockup'});
    await dialog.getByLabel('Garment',{exact:true}).selectOption('hoodie');
    const model=dialog.getByRole('img',{name:'Rotatable 3D hoodie with the current design'});
    await expect(model).toHaveAttribute('aria-busy','false',{timeout:18000});
    const original=await model.screenshot();
    await dialog.getByLabel('Fabric color').fill('#983b58');
    expect((await model.screenshot()).equals(original)).toBe(false);
    await dialog.getByRole('slider',{name:'Rotate hoodie'}).fill('45');
    await expect(dialog.getByRole('slider',{name:'Rotate hoodie'})).toHaveValue('45');
    const proof=await readProof(page,dialog,'stitch-studio-hoodie-adult-mockup.png');
    expect(proof).toMatchObject({width:1200,height:880});
    expect(proof.red).toBeGreaterThan(10000);
    await dialog.getByRole('button',{name:'Flat view'}).click();
    await expect(dialog.getByRole('img',{name:'Design on adult Hoodie, left chest (wearer)'})).toBeVisible();
  });
