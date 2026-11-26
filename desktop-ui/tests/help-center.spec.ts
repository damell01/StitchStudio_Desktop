import {expect, test} from '@playwright/test';

test('finds a how-to guide, loads its screenshot, and restarts the optional tour', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    Object.assign(window, {__TAURI_INTERNALS__: {async invoke() {return null;}}});
  });
  await page.goto('/');
  const helpMenu = page.getByRole('navigation', {name: 'Main navigation'}).getByText('Help', {exact: true});
  await helpMenu.hover();
  await page.getByRole('button', {name: 'Help Center', exact: true}).first().click();

  const search = page.getByRole('searchbox', {name: 'Search how-to guides'});
  await search.fill('Poolin');
  await expect(page.getByRole('heading', {name: 'Map threads on a Poolin EOM'})).toBeVisible();
  await page.getByText('Show screenshot', {exact: true}).click();
  const screenshot = page.getByRole('img', {name: /numbered blocks, repeated colors/});
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await search.fill('puffy');
  await expect(page.getByRole('heading', {name: 'Make puffy lettering with foam'})).toBeVisible();
  await expect(page.getByText(/Under Embroidery effect, choose Foam satin/)).toBeVisible();
  await search.fill('cutting SVG');
  await expect(page.getByRole('heading', {name: 'Make an appliqué'})).toBeVisible();

  await search.fill('unknown topic');
  await expect(page.getByRole('status')).toContainText('No matching guides');
  await search.clear();
  await page.getByRole('button', {name: 'Insert into an open design'}).click();
  await expect(page.getByRole('heading', {name: 'Insert into an open design'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Visual stitch reference'})).toBeVisible();

  await page.getByRole('button', {name: 'Start guided tour', exact: true}).last().click();
  const tour = page.getByRole('region', {name: 'Guided tour'});
  await expect(tour).toBeVisible();
  await tour.getByRole('button', {name: 'Skip'}).click();
  await expect(tour).toBeHidden();
});

test('opens lettering help without clearing the text in progress', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    Object.assign(window, {__TAURI_INTERNALS__: {
      async invoke(command: string) {return command === 'lettering_fonts' ? ['DejaVu Sans'] : null;},
    }});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Main navigation'}).getByText('Create', {exact: true}).hover();
  await page.getByRole('button', {name: 'Create lettering', exact: true}).first().click();
  const lettering = page.getByRole('textbox', {name: 'Text', exact: true});
  await lettering.fill('TEAM');

  const help = page.getByRole('button', {name: 'How to: Make puffy lettering with foam'});
  await help.click();
  const dialog = page.getByRole('dialog', {name: 'Make puffy lettering with foam'});
  await expect(dialog).toBeVisible();
  await dialog.getByText('Show screenshot', {exact: true}).click();
  const screenshot = dialog.getByRole('img', {name: /Foam satin with end caps/});
  await expect.poll(() => screenshot.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  await expect(lettering).toHaveValue('TEAM');
});
