import {expect, test} from '@playwright/test';

test('edits vector curves and a fixed stitch run in the selected-object point editor', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio-tour-seen', '1');
    type Point = [number, number];
    const point = (x: number, y: number) => ({p: [x, y] as Point, incoming: [x, y] as Point, outgoing: [x, y] as Point});
    const objects = [
      {uid: 10, label: 'Purple patch', kind: 'fill', color: [90, 50, 110],
        bounds: [-16, -9, 12, 15], path: 'M-16 -6C-16 -9 -4 -9 -4 -6L-4 6H-16Z', fill_rule: 'nonzero'},
      {uid: 11, label: 'Fixed run', kind: 'manual', color: [22, 55, 88],
        bounds: [7, 0, 11, 0], path: 'M7 0H18', stroke_width: 1},
    ];
    const paths = [
      {closed: true, nodes: [{...point(-16, -6), outgoing: [-16, -9]}, {...point(-4, -6), incoming: [-4, -9]}, point(-4, 6), point(-16, 6)]},
      {closed: false, nodes: [point(7, 0), point(12, 0), point(18, 0)]},
    ];
    const plan = {
      name: 'Point tools', stitches: 7, trims: 0, blocks: [
        {color: [90, 50, 110], runs: [[[-16, -6], [-4, -6], [-4, 6], [-16, 6]]]},
        {color: [22, 55, 88], runs: [[[7, 0], [12, 0], [18, 0]]]},
      ],
    };
    const updates: unknown[] = [];
    Object.assign(window, {pointUpdates: updates, __TAURI_INTERNALS__: {async invoke(command: string, args: {uid: number; paths: typeof paths}) {
      if (command === 'current_preview') return plan;
      if (command === 'editable_objects') return objects;
      if (command === 'artwork_path') return {revision: 'original', manual: args.uid === 11, paths: [paths[args.uid - 10]]};
      if (command === 'update_artwork_path') {
        updates.push(args);
        const block = plan.blocks[args.uid - 10];
        block.runs[0] = args.paths[0].nodes.map(node => node.p);
        return { ...plan, stitches: plan.blocks.reduce((sum, item) => sum + item.runs[0].length, 0) };
      }
      return command === 'character_list' ? [] : null;
    }}});
  });
  await page.goto('/');
  await page.getByRole('button', {name: /Blank design/}).last().click();
  const canvas = page.locator('.design-canvas');
  await canvas.locator('[data-artwork-uid="10"]').click();
  await page.getByRole('button', {name: 'Edit artwork nodes', exact: true}).click();
  const editor = page.getByRole('dialog', {name: 'Edit artwork nodes'});
  const handle = editor.locator('[data-handle="outgoing"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 12, {steps: 4});
  await page.mouse.up();
  await expect(handle).not.toHaveAttribute('cx', '-16');
  await editor.getByRole('button', {name: 'Insert after point'}).click();
  await expect(editor.getByText('Point 2 / 5')).toBeVisible();
  await editor.getByRole('button', {name: 'Apply changes'}).click();
  await expect(editor).not.toBeVisible();

  const target = await canvas.evaluate((element: SVGSVGElement) => {
    const screen = new DOMPoint(12, 0).matrixTransform(element.getScreenCTM()!);
    return {x: screen.x, y: screen.y};
  });
  await page.mouse.click(target.x, target.y);
  await page.getByRole('button', {name: 'Edit stitch points', exact: true}).click();
  const stitchEditor = page.getByRole('dialog', {name: 'Edit stitch points'});
  await stitchEditor.getByRole('button', {name: 'Next point'}).click();
  await stitchEditor.getByRole('button', {name: 'Erase point'}).click();
  await expect(stitchEditor.getByText('Point 2 / 2')).toBeVisible();
  await stitchEditor.getByRole('button', {name: 'Apply changes'}).click();
  await expect(stitchEditor).not.toBeVisible();

  const updates = await page.evaluate(() => (window as Window & {pointUpdates?: unknown[]}).pointUpdates);
  expect(updates).toMatchObject([
    {uid: 10, revision: 'original', paths: [{closed: true, nodes: [
      {p: [-16, -6], outgoing: [expect.any(Number), expect.any(Number)]},
      {p: [expect.any(Number), expect.any(Number)]},
      {p: [-4, -6]}, {p: [-4, 6]}, {p: [-16, 6]},
    ]}]},
    {uid: 11, revision: 'original', paths: [{closed: false, nodes: [{p: [7, 0]}, {p: [18, 0]}]}]},
  ]);
});
