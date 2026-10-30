import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareShader } from "@vgpu/wgsl/prepare";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const shaderDirectory = join(root, "src/shaders");
const shaderPaths = (await readdir(shaderDirectory, { recursive: true }))
  .filter((path) => path.endsWith(".wgsl"))
  .sort();

// Stable virtual paths keep shader identifiers and checksums independent of the checkout path.
// These project-owned modules use relative imports; no generated shader source is written to src.
const modules = Object.fromEntries(await Promise.all(shaderPaths.map(async (path) => [
  `src/shaders/${path.replaceAll("\\", "/")}`,
  await readFile(join(shaderDirectory, path), "utf8"),
])));

await rm(join(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [
  fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
  "-p", join(root, "tsconfig.json"),
], { cwd: root, stdio: "inherit" });

// tsc owns declarations and declaration maps. The public entry is one self-contained
// browser module. GPU code stays in the worker; options supports internal Node tests.
// Intermediate stack stages expose only the entries they implement.
const entryPoints = ["src/index.ts", "src/options.ts", "src/runtime/worker.ts", "src/gpu/generation.ts"]
  .filter(path => existsSync(join(root, path)));
if (entryPoints.length === 0) {
  console.log("GPU primitive sources ready; run check:shaders and test:gpu for native acceptance.");
  process.exit(0);
}
const result = await build({
  absWorkingDir: root,
  entryPoints,
  outdir: "dist",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2020",
  sourcemap: true,
  minify: true,
  metafile: true,
  logLevel: "info",
  plugins: [{
    name: "prepared-wgsl",
    setup(builder) {
      builder.onLoad({ filter: /\.wgsl$/ }, async ({ path }) => {
        const entry = relative(root, path).replaceAll("\\", "/");
        const resolved = await resolveShader({
          entry,
          rootDir: "src",
          modules,
          validate: "off", // Device validation is a separate check, never a build prerequisite.
          minify: { whitespace: true },
        });
        const errors = resolved.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
        if (errors.length) {
          return { errors: errors.map((error) => ({ text: error.message })) };
        }
        const prepared = prepareShader(resolved, entry);
        return {
          loader: "js",
          resolveDir: dirname(path),
          watchFiles: resolved.deps.map((dependency) => join(root, dependency)),
          contents: `
            function freeze(value) {
              if (value !== null && typeof value === "object") {
                Object.values(value).forEach(freeze);
                Object.freeze(value);
              }
              return value;
            }
            export default /* @__PURE__ */ freeze(${JSON.stringify(prepared)});
          `,
        };
      });
    },
  }],
});

// Catch accidental imports of build tooling before they can reach the demo or npm consumers.
for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
  if (outputPath === "dist/index.js" && Object.keys(output.inputs).some(input => input.startsWith("src/gpu/") || input.endsWith(".wgsl"))) {
    throw new Error("GPU implementation reached the main-thread facade.");
  }
  for (const [input, contribution] of Object.entries(output.inputs)) {
    if (contribution.bytesInOutput > 0 && /@vgpu\/(adapter-node\/|wgsl\/dist\/(runtime\/|prepare\.js))/.test(input)) {
      throw new Error(`Build-only dependency reached the browser bundle: ${input}`);
    }
  }
}
