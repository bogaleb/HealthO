// Bundles the worker and the migration runner into self-contained ESM files for slim production images (Phase 8).
// The TypeScript workspace packages are compiled in; only Node built-ins stay external. No tsx at runtime.
import { build } from "esbuild";
import { mkdirSync, cpSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, "dist");
mkdirSync(out, { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  // Some CJS dependencies call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
};
await build({ ...common, entryPoints: [resolve(root, "apps/worker/src/index.ts")], outfile: resolve(out, "worker/index.mjs") });
await build({ ...common, entryPoints: [resolve(root, "scripts/build/migrate-entry.ts")], outfile: resolve(out, "migrate/index.mjs") });
cpSync(resolve(root, "packages/db/migrations"), resolve(out, "migrate/migrations"), { recursive: true });
console.log(JSON.stringify({ level: "info", msg: "bundled", files: ["dist/worker/index.mjs", "dist/migrate/index.mjs", "dist/migrate/migrations/"] }));
