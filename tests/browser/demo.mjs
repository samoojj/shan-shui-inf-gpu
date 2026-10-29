import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

export const demoScenarios = [{
  name: 'demo controls, keyboard and pointer pan, PNG export and mobile layout work',
  createRenderer: false,
  async run({ page, baseURL }) {
    await page.goto(`${baseURL}/examples/`);
    await page.waitForFunction(() => /Ready|Position/.test(document.querySelector('#status')?.textContent || ''));
    await page.getByLabel('Landscape seed', { exact: true }).fill('demo-check');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('demo-check'));
    await page.getByLabel('Mist', { exact: true }).fill('0.75');
    await page.waitForFunction(() => document.querySelector('#mist-value').value === '75%');
    await page.locator('#landscape').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Position 80'));
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Position 0'));
    const bounds = await page.locator('#landscape').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(() => /Position -\d+/.test(document.querySelector('#status').textContent));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    assert.match(download.suggestedFilename(), /demo-check.*\.png$/);
    await mkdir(new URL('../../test-results/', import.meta.url), { recursive: true });
    await download.saveAs(new URL('../../test-results/landscape.png', import.meta.url).pathname);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page overflows horizontally');
  },
}, {
  name: 'a failed demo capture never replays settings over a newer rendered scene',
  createRenderer: false,
  async run({ page, baseURL }) {
    await page.goto(`${baseURL}/examples/`);
    await page.waitForFunction(() => /Ready|Position/.test(document.querySelector('#status')?.textContent || ''));
    await page.evaluate(() => {
      const canvas = document.querySelector('#landscape');
      const original = canvas.toBlob;
      canvas.toBlob = callback => {
        window.rejectPendingEncoding = () => {
          canvas.toBlob = original;
          callback(null);
        };
      };
      // Submit and capture in one task so the capture consumes the pending patch,
      // before the example's scheduled rendering frame can apply it separately.
      document.querySelector('#seed').value = 'capture-earlier-seed';
      document.querySelector('#controls').requestSubmit();
      document.querySelector('#download').click();
    });
    await page.waitForFunction(() => typeof window.rejectPendingEncoding === 'function');
    await page.getByLabel('Landscape seed', { exact: true }).fill('capture-later-seed');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('capture-later-seed'));

    await page.evaluate(() => window.rejectPendingEncoding());
    await page.waitForFunction(() => !document.querySelector('#download').disabled);
    await page.getByLabel('Mist', { exact: true }).fill('0.8');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Position'));
    assert.match(await page.locator('#status').textContent(), /Seed capture-later-seed$/,
      'An encoding failure replayed the earlier capture settings over a newer scene');
  },
}];
