import { build } from "esbuild";
await build({
  entryPoints: ["deploy/railway-staging/seed-preview.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist-server/staging-seed-preview.js",
  banner: {js: 'import { createRequire as previewCreateRequire } from "node:module"; const require = previewCreateRequire(import.meta.url);'},
});
