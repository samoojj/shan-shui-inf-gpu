import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { serve } from '../scripts/serve.mjs';
import { runScenario } from './browser/fixture.mjs';
import { renderingScenarios } from './browser/rendering.mjs';
import { lifecycleScenarios } from './browser/lifecycle.mjs';
import { captureScenarios } from './browser/capture.mjs';
import { demoScenarios } from './browser/demo.mjs';

// Real-browser correctness checks. SwiftShader results are not hardware benchmarks.
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
    args: ['--no-sandbox', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
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
