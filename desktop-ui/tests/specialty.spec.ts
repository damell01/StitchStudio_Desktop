import { expect, test } from '@playwright/test';

test('an appliqué cutting export uses the selected shape and size without replacing the design', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const host = window as unknown as {
      specialtyCalls: Array<{ command: string; args: unknown }>;
      __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<boolean | null> };
    };
    host.specialtyCalls = [];
    host.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        host.specialtyCalls.push({ command, args });
        return command === 'export_applique_cut_svg' ? true : null;
      },
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^Create appliqué/ }).click();
  await page.getByRole('button', { name: 'Shield', exact: true }).click();
  const width = page.getByRole('spinbutton', { name: 'Artwork width' });
  const exportButton = page.getByRole('button', { name: 'Export cutting SVG' });

  await width.fill('0.25');
  await expect(exportButton).toBeDisabled();
  await width.fill('2');
  await expect(page.getByText('50.8 mm', { exact: true })).toBeVisible();
  await exportButton.click();
  await expect(page.getByText('Cutting outline saved')).toBeVisible();
  const specialtyCalls = await page.evaluate(() => (window as unknown as { specialtyCalls: unknown[] }).specialtyCalls);
  expect(specialtyCalls).toEqual([{ command: 'export_applique_cut_svg', args: { shape: 'shield', width: 50.8 } }]);
});
