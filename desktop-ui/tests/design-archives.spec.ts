import { expect, test } from '@playwright/test';

for (const source of ['library', 'insert dialog']) {
  test(`ZIP import in the ${source} refreshes results and reports duplicates`, async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('studio-tour-seen', '1');
      let imported = false;
      Object.assign(window, { __TAURI_INTERNALS__: {
        async invoke(command: string) {
          if (command === 'personal_designs') return imported ? ['Star.pes'] : [];
          if (command === 'import_design_archive') {
            imported = true;
            return { imported: 1, duplicates: 2, skipped: 1 };
          }
          return ['editable_objects', 'character_list'].includes(command) ? [] : null;
        },
      }});
    });
    await page.goto('/');
    if (source === 'library') {
      await page.getByRole('button', {name:/Design Library/}).last().click();
      await page.getByRole('button', {name:'Embroidery files', exact:true}).click();
    } else {
      await page.getByRole('button', {name:/Blank design/}).last().click();
      await page.getByRole('button', {name:'Insert design', exact:true}).click();
      await page.getByRole('button', {name:'My designs', exact:true}).click();
    }
    await page.getByRole('button', { name:'Import ZIP', exact:true }).click();
    await expect(page.getByText('1 imported · 2 already in library · 1 other file skipped', {exact:true})).toBeVisible();
    await expect(page.getByText('Star.pes', {exact:true})).toBeVisible();
  });
}
test('the artwork gallery imports SVG ZIPs, filters imported vectors, and opens one for digitizing', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><path fill="purple" d="M1 2 15 8 29 2 29 18 15 12 1 18Z"/></svg>';
    const bytes = Array.from(new TextEncoder().encode(svg));
    let imported = false;
    Object.assign(window, { __TAURI_INTERNALS__: {
      async invoke(command: string, args?: Record<string, unknown>) {
        if (command === 'import_artwork_archive') {
          imported = true;
          return { imported: 2, duplicates: 1, skipped: 2 };
        }
        if (command === 'character_list') return imported ? [
          { group: 'My imported artwork', name: 'Satin Ribbon', file: 'Satin Ribbon.svg' },
          { group: 'My imported artwork', name: 'Magnolia Leaf', file: 'Magnolia Leaf.svg' },
        ] : [];
        if (command === 'character_image' && args?.group === 'My imported artwork') return bytes;
        if (command === 'digitize_artwork') {
          Object.assign(window, { svgZipDigitizingRequest: args });
          throw new Error('Test digitizing response');
        }
        if (command === 'personal_designs' || command === 'editable_objects') return [];
        return null;
      },
    }});
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Design Library/ }).last().click();
  await page.getByRole('button', { name: 'Artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Import SVG ZIP' }).click();
  await expect(page.getByText('Added 2 SVG files · 1 already in this collection · 2 skipped', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My imported artwork', exact: true })).toBeVisible();
  await expect(page.getByText('Magnolia Leaf', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search artwork' }).fill('ribbon');
  await expect(page.getByText('Magnolia Leaf', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Satin Ribbon', exact: true }).click();
  await page.getByRole('region', { name: 'Artwork library' }).getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as {svgZipDigitizingRequest?: { name: string; mime: string }}).svgZipDigitizingRequest
  )).toMatchObject({ name: 'Satin Ribbon', mime: 'image/svg+xml' });
});
