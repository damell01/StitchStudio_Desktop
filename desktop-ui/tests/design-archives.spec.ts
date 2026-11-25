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
