import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { serve } from '../../scripts/serve.mjs';

/** One launch policy and cleanup path for API scenarios and image comparisons. */
export async function withBrowser(run) {
  const server = serve(0, { tests: true });
  let browser;
  try {
    await once(server, 'listening');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true,
      args: ['--no-sandbox', '--enable-unsafe-webgpu', ...(process.env.SWIFTSHADER === '1'
        ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'] : [])],
    });
    return await run({ browser, baseURL: `http://127.0.0.1:${server.address().port}` });
  } finally {
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}
