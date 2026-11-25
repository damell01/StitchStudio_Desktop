import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const host = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
      stitchTestCalls: string[];
      stitchTestFail: boolean;
    };
    host.stitchTestCalls = [];
    host.stitchTestFail = false;
    let generation = 0;
    let current: unknown = null;
    let draft: unknown = null;
    host.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        host.stitchTestCalls.push(command);
        if (command === 'choose_artwork') return { name: 'Artwork', mime: 'image/png', bytes: [137] };
        if (command === 'digitize_artwork') {
          const id = ++generation;
          await new Promise(resolve => setTimeout(resolve, 150));
          if (host.stitchTestFail) throw Error('This artwork has no foreground');
          draft = { name: "Artwork", stitches: args?.detail, trims: 0, blocks: [{ color: [66, 42, 90], runs: [[[0, 0], [3, 3]]] }] };
          return {
            id,
            plan: draft,
            quality: { short: 0, long: 0, zero: 0, sewn_mm: 4.24 },
            warnings: [],
            density: [[0, 0, 4]],
            jumps: 1,
            dst_stitches: 64,
            color_changes: 0,
          };
        }
        if (command === 'apply_digitizer_draft') current = draft;
        if (command === 'current_preview') return current;
        return ['character_list', 'editable_objects'].includes(command) ? [] : null;
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Digitize artwork' }).click();
});

test('an artwork selection generates a draft immediately and only opens it on request', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose or drop an image' }).click();
  await expect(page.getByText('Preparing artwork and generating stitches…')).toBeVisible();
  const open = page.getByRole('button', { name: 'Open in design studio' });
  await expect(open).toBeVisible();
  await page.getByRole('button', { name: 'Density', exact: true }).click();
  await expect(page.locator('.digitizer-stitch-image rect')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { stitchTestCalls: string[] }).stitchTestCalls))
    .not.toContain('apply_digitizer_draft');

  await page.getByText('Advanced artwork options').click();
  const detail = page.getByRole('slider', { name: 'Detail' });
  await detail.press('ArrowRight');
  await detail.press('ArrowRight');
  await expect(open).toBeHidden();
  await expect(page.getByText('62', { exact: true })).toBeVisible();
  const generationCalls = await page.evaluate(() =>
    (window as unknown as { stitchTestCalls: string[] }).stitchTestCalls.filter(command => command === 'digitize_artwork').length);
  expect(generationCalls).toBe(2);
  await open.click();
  const canvas = page.locator('.design-canvas');
  await expect(canvas.locator('polyline')).toHaveCount(1);
  const stitches = await canvas.locator('polyline').getAttribute('points');
  const originalView = await canvas.getAttribute('viewBox');
  await page.getByTitle('Zoom in', { exact: true }).click();
  await page.getByTitle('Zoom in', { exact: true }).click();
  await expect(canvas).not.toHaveAttribute('viewBox', originalView!);
  const zoomed = await canvas.getAttribute('viewBox');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('viewBox', zoomed!);
  await expect(canvas.locator('polyline')).toHaveAttribute('points', stitches!);
  expect(await page.evaluate(() => (window as unknown as { stitchTestCalls: string[] }).stitchTestCalls))
    .not.toContain('transform_design');
});

test('dropping artwork starts generation and reports tracing errors', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { stitchTestFail: boolean }).stitchTestFail = true;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['invalid input'], 'artwork.png', { type: 'image/png' }));
    document.querySelector('.digitizer-layout')?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(page.getByRole('alert')).toContainText('This artwork has no foreground');
  await expect(page.getByRole('button', { name: 'Open in design studio' })).toBeHidden();
});

test('a single-page PDF renders to artwork and starts digitizing', async ({ page }) => {
  await page.getByLabel('Import PDF').setInputFiles('../tests/fixtures/digitizer/artwork.pdf');
  await expect(page.getByRole('button', { name: 'Open in design studio' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Original artwork' })).toBeVisible();
});
