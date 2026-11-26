import { expect, test } from '@playwright/test';

test('commands find Font Manager and fonts sort by physical size and stay paged', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    Object.assign(window, { __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        if(command==='font_assets') return ['10 in','2 in','2.5 in','50 mm'].map(size=>({
          name:'Prairie '+size,file:'prairie '+size+'.bx',format:'bx',bytes:1024,
        }));
        if(command==='lettering_fonts') return Array.from({length:24},(_,index)=>'System '+(index+1));
        return [];
      },
    } });
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Search commands'}).focus();
  await page.keyboard.press('Control+k');
  const palette=page.getByRole('dialog',{name:'Search commands'});
  await palette.getByRole('textbox').fill('font manager');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Font Manager'})).toBeVisible();
  const list=page.locator('.font-list article');
  await expect(list).toHaveCount(12);
  await page.getByRole('button',{name:'Next page'}).click();
  await expect(page.getByText('Page 2 of 3')).toBeVisible();
  await page.getByRole('textbox',{name:'Search fonts'}).fill('prairie');
  await expect(list.locator('strong')).toHaveText(['Prairie 50 mm','Prairie 2 in','Prairie 2.5 in','Prairie 10 in']);
});

test('dropping fonts imports them and reports unsupported files', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    let imported = false;
    Object.assign(window, {__TAURI_INTERNALS__: {
      async invoke(command: string, args: Record<string, unknown>) {
        if (command === 'import_dropped_font' && args.name === 'Sample.ttf') {
          imported = true;
          return {imported:1,duplicates:0,skipped:0,errors:[]};
        }
        if (command === 'font_assets') return imported ? [{name:'Sample',file:'Sample.ttf',format:'ttf',bytes:4}] : [];
        if (command === 'lettering_fonts') return imported ? ['Sample'] : [];
        return null;
      },
    }});
  });
  await page.goto('/');
  await page.getByRole('button', {name:'Fonts',exact:true}).click();
  await page.locator('.font-import').evaluate(zone => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0,1,2,3])], 'Sample.ttf'));
    transfer.items.add(new File(['skip'], 'notes.txt'));
    zone.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(page.getByText('1 imported · 0 duplicates · 1 skipped')).toBeVisible();
  await expect(page.getByText('Installed in Stitch Studio')).toBeVisible();
});
