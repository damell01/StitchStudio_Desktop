import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    const host = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
      stitchTestCalls: string[];
      stitchTestFail: boolean;
      stitchTestDense: boolean;
      stitchTestGoals: unknown[];
      stitchTestRelease: (() => void) | null;
    };
    host.stitchTestCalls = [];
    host.stitchTestFail = false;
    host.stitchTestDense = false;
    host.stitchTestGoals = [];
    host.stitchTestRelease = null;
    let generation = 0;
    let current: unknown = null;
    let draft: unknown = null;
    host.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        host.stitchTestCalls.push(command);
        if (command === 'choose_artwork') return { name: 'Artwork', mime: 'image/jpeg', bytes: [255,216,255] };
        if (command === 'recognize_artwork_lettering' || command === 'lettering_fonts') return [];
        if (command === 'digitize_artwork') {
          const id = ++generation;
          if (id === 1 && !host.stitchTestFail) {
            await new Promise<void>(resolve => { host.stitchTestRelease = resolve; });
          }
          if (host.stitchTestFail) throw Error('This artwork has no foreground');
          draft = { name: "Artwork", stitches: host.stitchTestDense ? 21_000 : args?.detail, trims: 0, blocks: [{ color: [66, 42, 90], runs: [[[0, 0], [3, 3]]] }] };
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
        if (command === 'compare_digitizer_draft') {
          host.stitchTestGoals.push(args?.targetStitches);
          if (host.stitchTestDense) {
            const base={name:'Artwork',blocks:[{color:[66,42,90],runs:[[[0,0],[3,3]]]}]};
            const quality={coverage:96,density_peak:2,seconds:4};
            return [
              {strength:2,plan:{...base,stitches:14_000,trims:0},reason:null,quality},
              {strength:3,plan:{...base,stitches:9_800,trims:150},reason:null,quality},
            ];
          }
          if (args?.quick !== false) return [];
          const plan = { name:'Artwork', stitches:40, trims:0, blocks:[{color:[66,42,90],runs:[[[0,0],[3,3]]]}] };
          return [{strength:5,plan,reason:null,quality:{coverage:96,density_peak:2,seconds:4}}];
        }
        if (command === 'inspect_digitizer_coverage') {
          if(args?.strength===2)return {complete:false,gaps:[]};
          return {complete:true,gaps:args?.strength===5?['Object 2 has gaps at 20% of sampled interior points.']:[]};
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
  await expect(page.getByText('Digitizing your artwork', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { stitchTestRelease: unknown }).stitchTestRelease)).toBe('function');
  await page.evaluate(() => (window as unknown as { stitchTestRelease: () => void }).stitchTestRelease());
  const open = page.getByRole('button', { name: 'Open in design studio' });
  await expect(open).toBeVisible();
  await page.getByRole('button', { name: 'Density', exact: true }).click();
  await expect(page.locator('.digitizer-stitch-image rect title')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { stitchTestCalls: string[] }).stitchTestCalls))
    .not.toContain('apply_digitizer_draft');

  await page.getByText('Advanced artwork options').click();
  const detail = page.getByRole('slider', { name: /^Detail ·/ });
  await detail.press('ArrowRight');
  await detail.press('ArrowRight');
  await expect(open).toBeHidden();
  await expect(page.locator('.digitizer-preview-metrics')).toContainText('62');
  const generationCalls = await page.evaluate(() =>
    (window as unknown as { stitchTestCalls: string[] }).stitchTestCalls.filter(command => command === 'digitize_artwork').length);
  expect(generationCalls).toBe(2);
  await open.click();
  const canvas = page.locator('.design-canvas');
  await expect(canvas.locator('polyline').first()).toBeVisible();
  const stitches = await canvas.locator('polyline').first().getAttribute('points');
  const originalView = await canvas.getAttribute('viewBox');
  await page.getByTitle('Zoom in', { exact: true }).click();
  await page.getByTitle('Zoom in', { exact: true }).click();
  await expect(canvas).not.toHaveAttribute('viewBox', originalView!);
  const zoomed = await canvas.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('viewBox', zoomed!);
  await expect(canvas.locator('polyline').first()).toHaveAttribute('points', stitches!);
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
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { stitchTestRelease: unknown }).stitchTestRelease)).toBe('function');
  await page.evaluate(() => (window as unknown as { stitchTestRelease: () => void }).stitchTestRelease());
  await expect(page.getByRole('button', { name: 'Open in design studio' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Original artwork' })).toBeVisible();
});

test('deep optimization exposes and recommends the faster eligible stitch plan', async ({ page }) => {
  await page.getByRole('button', {name:'Choose or drop an image'}).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as {stitchTestRelease:unknown}).stitchTestRelease)).toBe('function');
  await page.evaluate(() => (window as unknown as {stitchTestRelease:() => void}).stitchTestRelease());
  await page.getByRole('button', {name:'Deep optimization'}).click();
  const alternative = page.getByRole('button', {name:/Fast Stitch/});
  await expect(alternative).toHaveAttribute('aria-pressed', 'true');
  await expect(alternative).toContainText('33% fewer stitches');
});

test('upload recommends a checked plan near the stitch goal and updates it without tracing again', async ({page}) => {
  await page.evaluate(() => { (window as unknown as {stitchTestDense:boolean}).stitchTestDense=true; });
  await page.getByRole('button',{name:'Choose or drop an image'}).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as {stitchTestRelease:unknown}).stitchTestRelease)).toBe('function');
  await page.evaluate(() => (window as unknown as {stitchTestRelease:()=>void}).stitchTestRelease());
  await expect(page.getByRole('region',{name:'Compare embroidery-ready designs'}).getByRole('button',{name:/^Maximum Stitch paths/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.digitizer-preview-metrics')).toContainText('9,800');
  await page.getByLabel('Stitch-count goal').selectOption('15000');
  await expect(page.getByRole('region',{name:'Compare embroidery-ready designs'}).getByRole('button',{name:/Balanced/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.digitizer-preview-metrics')).toContainText('14,000');
  const state=await page.evaluate(() => {
    const host=window as unknown as {stitchTestCalls:string[];stitchTestGoals:number[]};
    return {traces:host.stitchTestCalls.filter(name=>name==='digitize_artwork').length,goals:host.stitchTestGoals};
  });
  expect(state).toEqual({traces:1,goals:[10_000,15_000]});
});


test('quality checks the selected alternative and clears its coverage messages when switching', async ({page})=>{
  await page.getByRole('button',{name:'Choose or drop an image'}).click();
  await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as {stitchTestRelease:unknown}).stitchTestRelease)).toBe('function');
  await page.evaluate(()=>(window as unknown as {stitchTestRelease:()=>void}).stitchTestRelease());
  await page.getByRole('button',{name:'Deep optimization',exact:true}).click();
  await page.getByRole('button',{name:'Quality',exact:true}).click();
  await expect(page.getByText('Object 2 has gaps at 20% of sampled interior points.')).toBeVisible();
  await page.getByRole('region',{name:'Compare embroidery-ready designs'}).getByRole('button',{name:/^Original Stitch paths/}).click();
  await expect(page.getByText('No gaps flagged in sampled fill and satin areas.')).toBeVisible();
  await expect(page.getByText('Object 2 has gaps at 20% of sampled interior points.')).toHaveCount(0);
});
