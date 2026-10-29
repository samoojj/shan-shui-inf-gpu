import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { serve } from '../scripts/serve.mjs';
import { runScenario } from './browser/fixture.mjs';
import { renderingScenarios } from './browser/rendering.mjs';
import { lifecycleScenarios } from './browser/lifecycle.mjs';
import { captureScenarios } from './browser/capture.mjs';
import { demoScenarios } from './browser/demo.mjs';

// Native WebGPU correctness checks. SwiftShader results are not hardware benchmarks.
// API fixtures preserve a 320×256 logical view at pixelRatio 0.25 (80×64 pixels),
// with separate overlap/resize cases. Demo DPR is 0.25; full-size original-image
// comparisons run separately so software testing does not repaint huge scenes.
const server = serve(0);
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const scenarios = [...renderingScenarios, ...lifecycleScenarios, ...captureScenarios, ...demoScenarios];
const selected = process.env.BROWSER_TEST_FILTER
  ? scenarios.filter(scenario => scenario.name.includes(process.env.BROWSER_TEST_FILTER))
  : scenarios;
let browser;
try {
  if (selected.length === 0) throw new Error(`No browser scenarios match ${process.env.BROWSER_TEST_FILTER}`);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'] : [])],
  });
  for (const scenario of selected) {
    await runScenario(browser, baseURL, scenario);
    console.log(`PASS ${scenario.name}`);
  }
  console.log(`Verified ${selected.length} independent browser scenarios.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
