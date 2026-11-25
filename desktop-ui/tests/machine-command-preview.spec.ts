import { expect, test } from '@playwright/test';

test('export command review pages through encoded movements without exporting a file', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const plan = { name: 'Command preview test', stitches: 2, trims: 0, blocks: [
      { color: [66, 42, 90], runs: [[[0, 0], [2, 3]]] },
    ] };
    const requests: unknown[] = [];
    Object.assign(window, { commandPreviewRequests: requests, __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { offset: number } | undefined) => {
        if (command === 'current_preview') return plan;
        if (command === 'editable_objects') return [];
        if (command !== 'preview_machine_commands') return null;
        requests.push(args);
        return {
          total: 11, stitches: 7, jumps: 0, trimJumps: 3, colorChanges: 0,
          records: args?.offset === 10 ? [{ command: 'End', x: -0.2, y: 2, thread: 1 }] :
            Array.from({ length: 10 }, (_, index) => ({
              command: index < 7 ? 'Stitch' : 'Trim-pattern jump', x: 0.2, y: index / 10, thread: 1,
            })),
        };
      },
    } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Blank design/ }).last().click();
  await page.getByRole('button', { name: 'Export design' }).click();
  const review = page.getByRole('dialog', { name: 'Export review' });
  await expect(review.getByRole('region',{name:'Thread sequence'}).getByRole('listitem')).toHaveCount(1);
  await expect(review.getByRole('button',{name:'DST',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(review.getByRole('button',{name:'Export package'})).toBeDisabled();
  await review.getByRole('checkbox',{name:'Reviewed and ready for a test sew'}).check();
  await expect(review.getByRole('button',{name:'Export package'})).toBeEnabled();
  await review.getByText('Export settings',{exact:true}).click();
  await review.getByRole('button', { name: 'Review DST commands' }).click();
  const preview = page.getByRole('dialog', { name: 'DST machine commands' });
  await expect(preview.getByRole('row')).toHaveCount(11);
  await expect(preview.getByText('1–10 of 11 records')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Previous command page' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Next command page' }).click();
  await expect(preview.getByRole('row')).toHaveCount(2);
  await expect(preview.getByRole('cell', { name: 'End' })).toBeVisible();
  await expect(preview.getByRole('cell', { name: '-0.2' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Next command page' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(review).toBeVisible();

  const calls = await page.evaluate(() => (window as unknown as { commandPreviewRequests: unknown[] }).commandPreviewRequests);
  expect(calls).toEqual([
    { format: 'dst', offset: 0, width: 130, height: 180 },
    { format: 'dst', offset: 10, width: 130, height: 180 },
  ]);
});
