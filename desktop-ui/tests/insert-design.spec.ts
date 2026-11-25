import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 540 });
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    let attempts = 0;
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const original = { name: 'Existing design', stitches: 2, trims: 0, blocks: [{ color: [66, 42, 90], runs: [[[0, 0], [15, 20]]] }] };
    const added = { ...original, stitches: 4, blocks: [...original.blocks, { color: [120, 60, 80], runs: [[[22, 20], [34, 28]]] }] };
    Object.assign(window, {
      insertCalls: calls,
      __TAURI_INTERNALS__: {
        async invoke(command: string, args: Record<string, unknown>) {
          calls.push({ command, args });
          if (command === 'current_preview' || command === 'preview_template') return original;
          if (command === 'personal_designs') return ['leaf.dst', 'star.pes'];
          if (command === 'insert_template') return added;
          if (command === 'insert_embroidery') {
            attempts += 1;
            if (attempts === 1) throw new Error('Design could not be read');
            return added;
          }
          return ['editable_objects', 'character_list'].includes(command) ? [] : null;
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Blank design/ }).last().click();
  await page.getByRole('button', { name: 'Insert design', exact: true }).click();
});

test('previews and places a template without leaving the current project', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Insert a design' });
  await dialog.getByRole('textbox', { name: 'Search templates' }).fill('thread spool');
  await dialog.getByRole('button', { name: 'Preview Thread spool' }).click();
  await expect(dialog.getByRole('img', { name: 'Thread spool stitch preview' })).toBeVisible();
  await dialog.getByLabel('Width (in)').fill('2.5');
  await dialog.getByLabel('Offset from hoop center').check();
  await dialog.getByLabel('Right (in)').fill('1');
  await dialog.getByLabel('Down (in)').fill('-0.5');
  await dialog.getByRole('button', { name: 'Insert design', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Existing design' })).toBeVisible();
  await expect(page.locator('.design-canvas polyline:not([opacity])')).toHaveCount(2);
  const args = await page.evaluate(() =>
    (window as unknown as { insertCalls: { command: string; args: object }[] }).insertCalls
      .find(call => call.command === 'insert_template')?.args);
  expect(args).toMatchObject({ id: 'spool-mark', widthMm: 63.5, xMm: 25.4, yMm: -12.7 });
});

test('keeps the saved file selected when insertion fails and allows a retry', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Insert a design' });
  await dialog.getByRole('button', { name: 'My designs', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Search personal designs' }).fill('leaf');
  await expect(dialog.getByRole('button', { name: 'star.pes' })).toBeHidden();
  await dialog.getByRole('button', { name: 'leaf.dst' }).click();
  await dialog.getByRole('button', { name: 'Insert design', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Design could not be read');
  await expect(dialog.getByRole('button', { name: 'leaf.dst' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Insert design', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.design-canvas polyline:not([opacity])')).toHaveCount(2);
});

test('finds published character artwork by tag and shows its license before insertion', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Insert a design' });
  await dialog.getByRole('textbox', { name: 'Search templates' }).fill('technology');
  await dialog.getByRole('button', { name: 'Preview Robot' }).click();
  await expect(dialog.getByRole('img', { name: 'Robot stitch preview' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Twemoji by Twitter, Inc. and other contributors' }))
    .toHaveAttribute('href', 'https://github.com/twitter/twemoji/blob/7a3dad4a4da30497093dab22eafba135f02308e1/assets/svg/1f916.svg');
  await expect(dialog.getByRole('link', { name: 'CC BY 4.0' }))
    .toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await dialog.getByRole('button', { name: 'Insert design', exact: true }).click();
  await expect(dialog).toBeHidden();
  const args = await page.evaluate(() =>
    (window as unknown as { insertCalls: { command: string; args: { id: string; art: string } }[] }).insertCalls
      .find(call => call.command === 'insert_template')?.args);
  expect(args?.id).toBe('twemoji-robot');
  expect(args?.art).toContain('viewBox="0 0 36 36"');
});
