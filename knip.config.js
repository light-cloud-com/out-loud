/** @type {import('knip').KnipConfig} */
export default {
  compilers: {
    html: (text) =>
      [...text.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/g)]
        .map((m) => (m[1].startsWith("/") ? `.${m[1]}` : m[1]))
        .map((p) => `import '${p}';`)
        .join("\n"),
  },
  ignoreBinaries: ["xcrun"],
  workspaces: {
    ".": {
      entry: [
        "electron/main.ts",
        "electron/preload.ts",
        "electron/tts-worker.ts",
        "electron/shared-audio.ts",
        // main.ts imports these via their compiled ".js" specifier (required by
        // Node ESM at runtime). The compiled .js is committed, so knip's
        // resolver follows the import to the .js and would otherwise flag the
        // .ts sources as unused — list them as entries like the other modules.
        "electron/update-check.ts",
        "electron/store.ts",
        "scripts/*.mjs",
      ],
      project: ["electron/**/*.ts", "scripts/**/*.mjs"],
    },
    "electron-ui": {},
    "chrome-extension": {
      entry: [
        "background.js",
        "content.js",
        "sidepanel.html",
        "options.html",
        "manifest.json",
        "src/tts-engine.js",
      ],
      project: "**/*.{js,ts,html}",
      ignore: ["lib/**"],
    },
    "tray-app": {},
  },
};
