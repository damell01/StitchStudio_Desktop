import {expect, test} from '@playwright/test';

test('canvas drops digitize immediately and add the draft to the open project', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const block = {color:[105,69,162],runs:[[[0,0],[10,12]]]};
    const draft = {name:'Flower',stitches:2,trims:0,blocks:[block]};
    const original = {...draft, name:'Working design'};
    Object.assign(window, {__TAURI_INTERNALS__: {
      async invoke(command: string, args: Record<string, unknown>) {
        if (command === 'current_preview') return original;
        if (command === 'digitize_artwork') return {
          id: 9, plan: draft, quality:{short:0,long:0,zero:0,sewn_mm:12}, warnings:[],
          density:[], jumps:0, dst_stitches:2, color_changes:0,
        };
        if (command === 'insert_digitizer_draft' && args.id === 9)
          return {...original, stitches:4, blocks:[block, {...block, color:[200,95,105]}]};
        return ['editable_objects','fabric_catalog','character_list','lettering_fonts','recognize_artwork_lettering','compare_digitizer_draft'].includes(command) ? [] : null;
      },
    }});
  });
  await page.goto('/');
  await page.getByRole('button', {name:/Blank design/}).last().click();
  const button = page.getByRole('button', {name:'Import image and digitize',exact:true});
  await button.click();
  const dialog = page.getByRole('dialog', {name:'Digitize an image'});
  await expect(dialog.getByRole('button', {name:'Choose or drop an image'})).toBeVisible();
  await dialog.getByRole('button', {name:'Close',exact:true}).click();

  await page.locator('.design-canvas').evaluate(canvas => {
    const transfer = new DataTransfer();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="10"/></svg>';
    transfer.items.add(new File([svg], 'flower.svg', {type:'image/svg+xml'}));
    canvas.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(dialog.getByRole('button', {name:'Add to current design'})).toBeEnabled();
  await dialog.getByRole('button', {name:'Add to current design'}).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', {name:'Working design'})).toBeVisible();
  await expect(page.locator('.design-canvas polyline:not([opacity])')).toHaveCount(2);
});

test('dropping an image on Home starts a digitizer draft', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    Object.assign(window, {__TAURI_INTERNALS__: {
      async invoke(command: string) {
        if (command === 'digitize_artwork') return {
          id: 10, plan:{name:'Photo',stitches:2,trims:0,blocks:[{color:[50,20,70],runs:[[[0,0],[3,4]]]}]},
          quality:{short:0,long:0,zero:0,sewn_mm:5}, warnings:[], density:[], jumps:0, dst_stitches:2, color_changes:0,
        };
        return ['character_list','lettering_fonts','recognize_artwork_lettering','compare_digitizer_draft','fabric_catalog'].includes(command) ? [] : null;
      },
    }});
  });
  await page.goto('/');
  await page.locator('.studio-home-hero').evaluate(hero => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['mock image bytes'], 'photo.png', {type:'image/png'}));
    hero.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(page.getByRole('button', {name:'Open in design studio'})).toBeEnabled();
});
