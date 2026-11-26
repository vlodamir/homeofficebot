import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const targets = new Map([
  ["bot", ["src/index.ts", "dist/index.js"]],
  ["send-now", ["src/sendNow.ts", "dist/sendNow.js"]],
  ["test", ["tests/run-tests.ts", "dist-test/run-tests.js"]],
]);

const target = process.argv[2] ?? "bot";
const paths = targets.get(target);
if (!paths) throw new Error(`Unknown bundle target ${target}`);
const [entry, outfile] = paths;
const license = await readFile(new URL("../assets/fonts/LICENSE", import.meta.url), "utf8");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  loader: { ".wasm": "binary", ".ttf": "binary" },
  banner: { js: `/*! DejaVu Sans\n${license.replaceAll("*/", "* /")}\n*/` },
  logLevel: "info",
});
