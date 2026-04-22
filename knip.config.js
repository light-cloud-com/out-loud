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
