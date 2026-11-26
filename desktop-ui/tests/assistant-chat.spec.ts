import {expect, test} from '@playwright/test';

test('the offline assistant previews requests and runs only the confirmed change', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen','1');
    const plan = {name:'Bow sample',stitches:8500,trims:16,blocks:[
      {color:[0,0,0],runs:[[[-11,-6],[11,-6],[11,6],[-11,6],[-11,-6]]]},
      {color:[105,69,162],runs:[[[-8,0],[0,-2],[8,0]]]},
    ]};
    const compact = {...plan,stitches:5600,trims:6};
    const calls: {command:string; args:Record<string,unknown>}[] = [];
    Object.assign(window,{assistantCalls:calls,__TAURI_INTERNALS__:{
      async invoke(command:string,args:Record<string,unknown>) {
        calls.push({command,args});
        if (command==='current_preview'||command==='replace_design_color') return plan;
        if (command==='editable_objects') return [
          {uid:8,label:'Bow outline',kind:'satin',color:[0,0,0],bounds:[-11,-6,22,12]},
          {uid:9,label:'Bow center',locked:true,kind:'fill',color:[105,69,162],bounds:[-3,-3,6,6]},
        ];
        if (command==='audit_stitches') return {short:4,long:1,zero:0,segments:7099};
        if (command==='preview_simplification') return {id:17,variants:[
          {strength:2,plan:compact,reason:null,quality:{coverage:97}},
          {strength:4,plan:compact,reason:null,quality:{coverage:86}},
        ]};
        if (command==='apply_simplification'||command==='maximize_in_hoop') return compact;
        if (command==='history_labels') return [[],[]];
        return null;
      },
    }});
  });

  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await expect(page.locator('.design-canvas polyline').first()).toBeVisible();
  const open = page.getByRole('button',{name:'Offline design assistant'});
  await open.click();
  const dialog = page.getByRole('dialog',{name:'Design assistant'});
  const conversation = dialog.getByRole('log',{name:'Assistant conversation'});
  const prompt = dialog.getByRole('textbox',{name:'Ask the design assistant'});
  const proposal = dialog.getByRole('region',{name:'Proposed change'});
  const callsOf = (...commands:string[]) => page.evaluate(allowed => (window as unknown as {
    assistantCalls:{command:string; args:Record<string,unknown>}[];
  }).assistantCalls.filter(call => allowed.includes(call.command)), commands);
  const mutations = () => callsOf('center_design','replace_design_color','apply_simplification');
  async function ask(text:string) {
    await prompt.fill(text);
    await prompt.press('Enter');
  }

  await expect(prompt).toBeFocused();
  await dialog.getByRole('button',{name:'Center in hoop'}).click();
  await expect(proposal).toContainText('center of the current hoop');
  expect(await mutations()).toEqual([]);
  await dialog.getByRole('button',{name:'Skip',exact:true}).click();
  await expect(conversation).toContainText('Change skipped.');

  await ask('Could you replace black with navy blue?');
  await expect(proposal).toContainText('#000000 → #000080');
  expect(await mutations()).toEqual([]);
  await dialog.getByRole('button',{name:'Apply change'}).click();
  await expect(conversation).toContainText('Replace thread color applied.');
  expect(await mutations()).toEqual([{command:'replace_design_color',args:{previous:[0,0,0],color:[0,0,128]}}]);

  await dialog.getByRole('button',{name:'Review stitches'}).click();
  await expect(conversation).toContainText('1 over 12 mm');
  await ask('Can you design a robot in this window?');
  await expect(conversation).toContainText('I couldn’t match that request');

  await ask('Make this design take less than 6 minutes');
  await expect(proposal.getByRole('img',{name:'Current stitch paths'})).toBeVisible();
  await expect(proposal.getByRole('img',{name:'Proposed stitch paths'})).toBeVisible();
  await expect(proposal).toContainText('5,600 points');
  expect((await callsOf('preview_simplification')).at(-1)?.args.options).toMatchObject({targetMinutes:6});
  expect(await mutations()).toHaveLength(1);
  await dialog.getByRole('button',{name:'Apply change'}).click();
  await expect(conversation).toContainText('Balanced stitch plan applied.');
  expect((await mutations()).at(-1)).toEqual({command:'apply_simplification',args:{id:17,strength:2}});

  await ask('Make my design fit my 8 x 9 hoop');
  await expect(proposal).toContainText('203.2 × 228.6 mm');
  await expect(proposal).toContainText('usable sewing field');
  expect(await callsOf('maximize_in_hoop')).toEqual([]);
  await dialog.getByRole('button',{name:'Apply change'}).click();
  await expect(conversation).toContainText('Fit design to hoop applied.');
  const [fit] = await callsOf('maximize_in_hoop');
  expect(fit.args.widthMm).toBeCloseTo(203.2);
  expect(fit.args.heightMm).toBeCloseTo(228.6);
  expect(fit.args.marginMm).toBe(2);

  await ask('Simplify the bow into a solid shape');
  await expect(proposal).toContainText('1 matching layer');
  expect((await callsOf('preview_simplification')).at(-1)?.args.uids).toEqual([8]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open.click();
  await expect(proposal).toBeHidden();
  await expect(conversation).toContainText('Change skipped.');
  expect(await mutations()).toHaveLength(2);
});
