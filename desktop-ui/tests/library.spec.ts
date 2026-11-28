import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const plan = { name: 'Thread spool', stitches: 900, trims: 0, blocks: [{ color: [66, 42, 90], runs: [[[0, 0], [15, 20]]] }] };
    let current: unknown = null;
    const host = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    host.__TAURI_INTERNALS__ = {
      async invoke(command) {
        if (command === 'preview_template') return plan;
        if (command === 'load_template' || command === 'insert_embroidery') return current = plan;
        if (command === 'current_preview') return current;
        if (command === 'personal_designs') return ['football.dst', 'star.pes'];
        return ['editable_objects', 'character_list'].includes(command) ? [] : null;
      },
    };
  });
  await page.goto('/');
});

test('the compact template library previews stitches before opening a template', async ({ page }) => {
  await page.getByRole('button', { name: /Template Library/ }).last().click();
  await page.getByRole('button', { name: 'Starter templates', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search templates' }).fill('thread spool');
  await page.getByRole('button', { name: 'Preview Thread spool' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thread spool' });
  await expect(dialog.getByLabel('Generated template stitches')).toBeVisible();
  await expect(dialog.getByText('900 stitch points', { exact: false })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThan(760);
  expect(bounds!.height).toBeLessThan(540);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Preview Thread spool' }).click();
  await dialog.getByRole('button', { name: 'Open in design studio' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(async()=>(await page.locator('.design-canvas [data-stitch-block]').evaluateAll(els=>els.reduce((n,e)=>n+Number(e.getAttribute('data-runs')),0)))).toBe(1);
  await page.getByRole('button',{name:'Previous stitch'}).click();
  await expect(page.getByLabel('Planned stitch position')).toHaveValue('1');
  await page.getByRole('button',{name:'Next stitch'}).click();
  await expect(page.getByLabel('Planned stitch position')).toHaveValue('2');
  const nav = page.locator('.studio-topbar');
  await page.getByRole('button', { name: 'Focus canvas' }).click();
  await expect(nav).toBeHidden();
  const canvas = page.locator('.design-canvas');
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(730);
  await page.keyboard.press('Escape');
  await expect(nav).toBeVisible();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const inspector = page.getByRole('group', { name: 'Inspector' });
  await inspector.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Maximize in hoop' })).toBeVisible();
  await page.getByRole('group', { name: 'Embroidery settings' }).getByRole('button', { name: 'Stitches' }).click();
  await expect(page.getByRole('button', { name: /audit|check stitch/i })).toBeVisible();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Blocks' }).click();
  await expect(page.getByLabel('Thread 1 color')).toBeVisible();

});

test('the design library finds a personal machine file and inserts it', async ({ page }) => {
  await page.getByRole('button', { name: /Design Library/ }).last().click();
  await page.getByRole('button', { name: 'Embroidery files', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search designs' }).fill('football');
  await expect(page.getByText('football.dst')).toBeVisible();
  await expect(page.getByText('star.pes')).toBeHidden();
  await page.getByRole('button', { name: 'Insert football.dst' }).click();
  await expect.poll(async()=>(await page.locator('.design-canvas [data-stitch-block]').evaluateAll(els=>els.reduce((n,e)=>n+Number(e.getAttribute('data-runs')),0)))).toBe(1);
});
test('premium artwork finds the grouped boutique designs and shows the stitch preview', async ({page})=>{
  await page.getByRole('button',{name:/Template Library/}).last().click();
  await page.getByRole('button',{name:'Boutique collection',exact:true}).click();
  const results=page.getByRole('region',{name:'Template results'});
  await expect(results.getByRole('heading',{name:'Heirloom goose ribbon crest'})).toBeVisible();
  await expect(results.getByRole('heading',{name:'Thread spool'})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Search templates'}).fill('goose');
  await results.getByRole('button',{name:'Preview Heirloom goose ribbon crest'}).click();
  await expect(page.getByRole('dialog',{name:'Heirloom goose ribbon crest'}).getByLabel('Generated template stitches')).toBeVisible();
});
