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
        if (command==='current_preview'||command==='replace_design_color'||command==='compose_assistant_design') return plan;
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
  const mutations = async () => (await callsOf('center_design','replace_design_color','apply_simplification','compose_assistant_design')).filter(call=>call.command!=='compose_assistant_design'||call.args.apply);
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
  await expect(proposal).toContainText('1 unlocked matching objects');
  expect(await mutations()).toEqual([]);
  await dialog.getByRole('button',{name:'Apply change'}).click();
  await expect(conversation).toContainText('Recolor editable artwork applied.');
  expect(await mutations()).toMatchObject([{command:'compose_assistant_design',args:{apply:true,composition:{edits:[{type:'recolor',uid:8,color:[0,0,128]}]}}}]);

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
  await expect(dialog.getByRole('button',{name:'Skip',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open.click();
  await expect(proposal).toBeHidden();
  await expect(conversation).toContainText('Change skipped.');
  expect(await mutations()).toHaveLength(2);
});

test('offline commands and MCP advice still need approval before editing', async ({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const calls:string[]=[];
    let incoming:string|null='Center design';
    const plan={name:'Badge',stitches:400,trims:1,blocks:[{color:[88,52,108],runs:[[[0,0],[8,8]]]}]};
    Object.assign(window,{assistantCalls:calls,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>) {
      calls.push(command);
      if(command==='current_preview'||command==='center_design')return plan;
      if(command==='editable_objects')return [];
      if(command==='agent_bridge_edit'){
        const result=incoming;
        if(args.consume)incoming=null;
        return result;
      }
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await page.getByRole('button',{name:'Offline design assistant'}).click();
  const dialog=page.getByRole('dialog',{name:'Design assistant'});
  const prompt=dialog.getByRole('textbox',{name:'Ask the design assistant'});
  await prompt.fill('Center design');
  await prompt.press('Enter');
  const proposal=dialog.getByRole('region',{name:'Proposed change'});
  await expect(proposal).toContainText('center of the current hoop');
  const calls=()=>page.evaluate(()=>(window as unknown as {assistantCalls:string[]}).assistantCalls);
  expect(await calls()).not.toContain('center_design');
  await dialog.getByRole('button',{name:'Skip',exact:true}).click();

  await dialog.getByRole('button',{name:'Review agent edit'}).click();
  await expect(proposal).toContainText('center of the current hoop');
  expect(await calls()).not.toContain('center_design');
  await dialog.getByRole('button',{name:'Apply change'}).click();
  await expect.poll(async ()=>(await calls()).filter(name=>name==='center_design')).toEqual(['center_design']);
});

test('reviews motif placement around lettering and resolves imported characters by name', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen','1');
    const plan = {name:'Lettering',stitches:450,trims:1,blocks:[
      {color:[0,0,0],runs:[[[-11,-6],[11,-6],[11,6],[-11,6],[-11,-6]]]},
    ]};
    const proposal = {...plan,stitches:900,blocks:[
      ...plan.blocks,{color:[145,119,184],runs:[[[-32,-12],[-19,-10]],[[19,-10],[32,-12]]]},
    ]};
    const calls: {command:string; args:Record<string,unknown>}[] = [];
    Object.assign(window,{motifCalls:calls,__TAURI_INTERNALS__:{
      async invoke(command:string,args:Record<string,unknown>) {
        calls.push({command,args});
        if (command==='current_preview') return plan;
        if (command==='compose_assistant_design') return proposal;
        if (command==='editable_objects') return [
          {uid:3,label:'Lettering',kind:'satin',groups:['tl-lettering-1'],color:[0,0,0],bounds:[-11,-6,22,12]},
        ];
        if (command==='character_list') return [{group:'My imported artwork',name:'Bluey',file:'Bluey.png'}];
        if (command==='trace_assistant_motif') return '<svg/>';
        if (command==='history_labels') return [[],[]];
        return null;
      },
    }});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await expect(page.locator('.design-canvas polyline').first()).toBeVisible();
  await page.getByRole('button',{name:'Offline design assistant'}).click();
  const dialog = page.getByRole('dialog',{name:'Design assistant'});
  const prompt = dialog.getByRole('textbox',{name:'Ask the design assistant'});
  const review = dialog.getByRole('region',{name:'Proposed change'});
  const calls = () => page.evaluate(()=>(window as unknown as {
    motifCalls:{command:string; args:Record<string,unknown>}[],
  }).motifCalls);
  await prompt.fill('Add lavender bows on both top corners of the lettering');
  await prompt.press('Enter');
  await expect(review).toContainText('2 copies');
  await expect(review.getByRole('img',{name:'Proposed stitch paths'})).toBeVisible();
  expect((await calls()).filter(call=>call.command==='compose_assistant_design'&&call.args.apply)).toHaveLength(0);
  const preview = (await calls()).find(call=>call.command==='compose_assistant_design'&&!call.args.apply)!;
  expect(preview.args.composition).toMatchObject({motifs:[{position:'topCorners',anchor:[-11,-6,22,12],color:[145,119,184],applique:false}]});
  expect((await calls()).some(call=>call.command==='interpret_with_local_model')).toBe(false);
  await review.getByRole('button',{name:'Apply change'}).click();
  await expect(dialog.getByRole('log')).toContainText('Add design motif applied');
  expect((await calls()).find(call=>call.command==='compose_assistant_design'&&call.args.apply)?.args).toEqual({...preview.args,apply:true});

  await prompt.fill('Add Bluey above the design as appliqué');
  await prompt.press('Enter');
  await expect(review).toContainText('Add appliqué motif');
  const trace = (await calls()).find(call=>call.command==='trace_assistant_motif');
  expect(trace?.args).toMatchObject({group:'My imported artwork',file:'Bluey.png',width:30});
  await review.getByRole('button',{name:'Skip',exact:true}).click();
  expect((await calls()).filter(call=>call.command==='compose_assistant_design'&&call.args.apply)).toHaveLength(1);
});

test('creates a whole editable design from a single assistant prompt after approval', async ({page}) => {
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    const requests:unknown[]=[];
    const plan={name:'Little Seed',stitches:1234,trims:3,blocks:[{color:[105,69,162],runs:[[[0,0],[10,14]]]}]};
    Object.assign(window,{compositionRequests:requests,__TAURI_INTERNALS__:{async invoke(command:string,args:Record<string,unknown>){
      if(command==='editable_objects')return [];
      if(command==='lettering_fonts')return ['Arial'];
      if(command==='assistant_compose'){requests.push(args);return plan;}
      return null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Blank design/}).last().click();
  await page.getByRole('button',{name:'Offline design assistant'}).click();
  const dialog=page.getByRole('dialog',{name:'Design assistant'});
  await dialog.getByRole('button',{name:'Create a name patch'}).click();
  const proposal=dialog.getByRole('region',{name:'Proposed change'});
  await expect(proposal).toContainText('Little Seed');
  await expect(proposal).toContainText('scalloped border');
  const requests=()=>page.evaluate(()=>(window as unknown as {compositionRequests:unknown[]}).compositionRequests);
  expect(await requests()).toMatchObject([{apply:false,composition:{width:expect.any(Number),
    lettering:{text:'Little Seed'},accents:[{position:'above'}],frame:{style:'scalloped'}}}]);
  await proposal.getByRole('button',{name:'Apply change'}).click();
  await expect(dialog.getByRole('log')).toContainText('Create embroidery design applied.');
  const [preview,apply]=(await requests()) as {apply:boolean;composition:unknown}[];
  expect(apply).toEqual({apply:true,composition:preview.composition});
});
