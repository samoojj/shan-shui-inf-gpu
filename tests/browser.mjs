import { withBrowser } from './helpers/browser.mjs';
import { runScenario } from './browser/fixture.mjs';
import { renderingScenarios } from './browser/rendering.mjs';
import { lifecycleScenarios } from './browser/lifecycle.mjs';
import { captureScenarios } from './browser/capture.mjs';
import { demoScenarios } from './browser/demo.mjs';

// Native WebGPU correctness checks. SwiftShader results are not hardware benchmarks.
// API fixtures preserve a 320×256 logical view at pixelRatio 0.25 (80×64 pixels),
// with separate overlap/resize cases. Demo DPR is 0.25; full-size original-image
// comparisons run separately so software testing does not repaint huge scenes.
const scenarios = [...renderingScenarios, ...lifecycleScenarios, ...captureScenarios, ...demoScenarios];
const selected = process.env.BROWSER_TEST_FILTER
  ? scenarios.filter(scenario => scenario.name.includes(process.env.BROWSER_TEST_FILTER))
  : scenarios;
await withBrowser(async ({ browser, baseURL }) => {
  if (selected.length === 0) throw new Error(`No browser scenarios match ${process.env.BROWSER_TEST_FILTER}`);
  for (const scenario of selected) {
    await runScenario(browser, baseURL, scenario);
    console.log(`PASS ${scenario.name}`);
  }
  console.log(`Verified ${selected.length} independent browser scenarios.`);
});
