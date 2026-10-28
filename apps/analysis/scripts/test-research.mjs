import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(
  realpathSync(
    new URL("../node_modules/wrangler/package.json", import.meta.url),
  ),
);
const { build } = require("esbuild");
const temp = await mkdtemp(join(tmpdir(), "psx-research-tests-"));
try {
  const out = join(temp, "test.mjs");
  await build({
    entryPoints: [new URL("./research.test.mts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
  });
  const result = spawnSync(process.execPath, ["--test", out], {
    stdio: "inherit",
  });
  process.exitCode = result.status || 0;
} finally {
  await rm(temp, { recursive: true, force: true });
}
