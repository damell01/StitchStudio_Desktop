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

test('the rail Templates button opens the design collection and inserts the chosen design',async({page})=>{
  const rail=page.getByRole('group',{name:'Editor tools'});
  await expect(rail).toBeVisible();
  await rail.getByRole('button',{name:'Templates'}).click();
  const dialog=page.getByRole('dialog',{name:'Insert a design'});
  await dialog.getByRole('button',{name:'Design collection',exact:true}).click();
  await dialog.getByLabel('Search artwork').fill('pelican');
  await dialog.getByRole('button',{name:'Select design: Pelican'}).click();
  await dialog.getByRole('button',{name:'Insert design',exact:true}).click();
  await expect.poll(async()=>(await calls(page,'insert_svg_artwork')).length).toBe(1);
  const [args]=await calls(page,'insert_svg_artwork');
  expect(args).toMatchObject({name:'Pelican'});
  expect((args.bytes as number[]).length).toBeGreaterThan(1000);
});

test('the rail Text button opens lettering editing',async({page})=>{
  await page.getByRole('group',{name:'Editor tools'}).getByRole('button',{name:'Text'}).click();
  await expect(page.getByRole('heading',{name:'Lettering'}).first()).toBeVisible();
});
