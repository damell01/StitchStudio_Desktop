import {expect,test} from '@playwright/test';

test('an installed build pairs once and requires approval before updating',async ({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    let paired=false;
    const operations:string[]=[];
    Object.assign(window,{updateOperations:operations,__TAURI_INTERNALS__:{
      async invoke(command:string,args?:{key?:string;version?:string}) {
        if (command==='plugin:app|version') return '0.1.1';
        if (command==='check_update') {
          return {configured:true,requiresAccessKey:true,hasAccessKey:paired,version:paired?'0.1.2':null,error:null};
        }
        if (command==='save_update_access_key') {
          if (args?.key?.length!==64) throw new Error('Invalid access key.');
          paired=true;
          operations.push('paired');
        }
        if (command==='install_update') operations.push('install '+args?.version);
        return null;
      },
    }});
  });
  await page.goto('/');
  await page.locator('.desktop-nav summary').filter({hasText:'Settings'}).hover();
  await page.locator('.desktop-nav').getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.locator('#beta-access');
  await settings.getByRole('button',{name:'Check for updates'}).click();
  await expect(settings.getByRole('status')).toContainText('Enter your access key');
  const key=settings.getByLabel('Update access key');
  await key.fill('a'.repeat(64));
  await settings.getByRole('button',{name:'Save access key'}).click();
  await expect(key).toHaveValue('');
  await expect(settings.getByRole('status')).toContainText('0.1.2');
  await settings.getByRole('button',{name:'Install and restart'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  const operations=()=>page.evaluate(()=>(window as unknown as {updateOperations:string[]}).updateOperations);
  expect(await operations()).toEqual(['paired']);
  await settings.getByRole('button',{name:'Install and restart'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Continue'}).click();
  await expect.poll(operations).toEqual(['paired','install 0.1.2']);
});
