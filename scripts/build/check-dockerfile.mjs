// CI guard: the Dockerfile's deps stage must COPY every workspace package.json (a missing one breaks
// `pnpm install --frozen-lockfile` in the image — this happened before Phase 8).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const missing = [];
for (const dir of ["apps", "packages"])
  for (const name of readdirSync(resolve(root, dir))) {
    const rel = `${dir}/${name}/package.json`;
    if (existsSync(resolve(root, rel)) && !dockerfile.includes(`COPY ${rel} ${dir}/${name}/`)) missing.push(rel);
  }
if (missing.length) {
  console.error(JSON.stringify({ level: "error", msg: "Dockerfile deps stage is missing workspace manifests", missing }));
  process.exit(1);
}
console.log(JSON.stringify({ level: "info", msg: "Dockerfile lists every workspace manifest" }));
