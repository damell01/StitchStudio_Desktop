import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const calls:{command:string;args:Record<string,unknown>}[]=[];
    const plan={name:'Hoop',stitches:40,trims:0,blocks:[{color:[105,69,162],runs:[[[0,0],[10,0],[10,10]]]}]};
    Object.assign(window,{createCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      calls.push({command,args});
      if(command==='lettering_fonts')return ['Arial','Georgia','Segoe Script'];
      if(command==='insert_svg_artwork'||command==='insert_lettering_settings')return plan;
      if(command==='current_preview')return null;
      return ['editable_objects','character_list','personal_designs'].includes(command)?[]:null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
});

const calls=(page:import('@playwright/test').Page,command:string)=>page.evaluate(c=>(window as unknown as {createCalls:{command:string;args:Record<string,unknown>}[]}).createCalls.filter(x=>x.command===c).map(x=>x.args),command);

test('the editor rail stays visible and the Templates panel adds a design at the hoop center',async({page})=>{
  const rail=page.getByRole('group',{name:'Editor tools'});
  await expect(rail).toBeVisible();
  await rail.getByRole('button',{name:'Templates'}).click();
  const panel=page.getByRole('region',{name:'Templates panel'});
  await panel.getByLabel('Search templates').fill('pink floral crest');
  await panel.getByRole('button',{name:'Add Pink Floral Crest'}).click();
  await expect.poll(async()=>(await calls(page,'insert_svg_artwork')).length).toBe(1);
  const [args]=await calls(page,'insert_svg_artwork');
  expect(args).toMatchObject({name:'Pink Floral Crest',xMm:0,yMm:0});
  expect((args.bytes as number[]).length).toBeGreaterThan(1000);
  expect(args.widthMm as number).toBeGreaterThan(10);
});

test('the Text panel adds styled embroidery lettering with installed fonts',async({page})=>{
  await page.getByRole('group',{name:'Editor tools'}).getByRole('button',{name:'Text'}).click();
  const panel=page.getByRole('region',{name:'Text panel'});
  await panel.getByRole('button',{name:'Add Varsity arc'}).click();
  await expect.poll(async()=>(await calls(page,'insert_lettering_settings')).length).toBe(1);
  const [args]=await calls(page,'insert_lettering_settings');
  expect(args.settings).toMatchObject({text:'WILDCATS',font:'Arial',arc:70,bold:true});
  await panel.getByRole('button',{name:'Add Script name'}).click();
  await expect.poll(async()=>(await calls(page,'insert_lettering_settings')).length).toBe(2);
  expect((await calls(page,'insert_lettering_settings'))[1].settings).toMatchObject({text:'Emily',font:'Segoe Script'});
});
