import {expect,test} from '@playwright/test';

test('Home links open a file or blank workspace and launch the offline assistant', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const log:string[]=[];
    const badge={name:'Aurora badge',stitches:3,trims:0,blocks:[{color:[105,69,162],runs:[[[0,0],[12,0],[12,6]]]}]};
    let plan:typeof badge|null=badge;
    Object.assign(window,{homeCalls:log,__TAURI_INTERNALS__:{async invoke(command:string){
      log.push(command);
      if(command==='workspace_overview')return {current:plan?.name??null,recovery:true};
      if(command==='new_blank_design'||command==='change_workspace_tab'){plan=null;return null;}
      if(command==='open_svg'){plan={...badge,name:'Imported design'};return plan;}
      if(command==='open_project'||command==='recovery_open'){
        plan={...badge,name:command==='open_project'?'Saved project':'Recovered project'};
        return {plan,width:150,height:210,format:'dst',thread_assignments:{0:'Indigo'}};
      }
      if(command==='current_preview')return plan;
      if(command==='editable_objects')return [];
      return null;
    }}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Start a design'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Continue current design/})).toContainText('Aurora badge');
  await expect(page.getByRole('img',{name:/Lavender sprigs/})).toBeVisible();

  await page.getByRole('button',{name:'Open project',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Saved project'})).toBeVisible();
  await page.getByRole('button',{name:'Home',exact:true}).click();
  await expect(page.getByRole('button',{name:/Continue current design/})).toContainText('Saved project');
  await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Recovered project'})).toBeVisible();

  await page.getByRole('button',{name:'Home',exact:true}).click();
  await expect(page.getByRole('button',{name:/Continue current design/})).toContainText('Recovered project');
  await page.getByRole('button',{name:'Blank design',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your hoop is ready'})).toBeVisible();
  await page.getByRole('button',{name:'Home',exact:true}).click();
  await page.getByRole('button',{name:/Design with the assistant/}).click();
  await expect(page.getByRole('dialog',{name:'Design assistant'})).toBeVisible();
});
