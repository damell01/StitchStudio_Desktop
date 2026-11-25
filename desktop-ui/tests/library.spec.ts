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
  await expect(page.locator('.design-canvas polyline')).toHaveCount(1);
});

test('the design library finds a personal machine file and inserts it', async ({ page }) => {
  await page.getByRole('button', { name: /Design Library/ }).last().click();
  await page.getByRole('textbox', { name: 'Search designs' }).fill('football');
  await expect(page.getByText('football.dst')).toBeVisible();
  await expect(page.getByText('star.pes')).toBeHidden();
  await page.getByRole('button', { name: 'Insert football.dst' }).click();
  await expect(page.locator('.design-canvas polyline')).toHaveCount(1);
});
