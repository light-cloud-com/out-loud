import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/tts-engine.js"],
  bundle: true,
  outfile: "dist/tts-engine.js",
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  minify: !watch,
  external: [],
  define: {
    "process.env.NODE_ENV": watch ? '"development"' : '"production"',
  },
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete!");
}
