// Generate the Microsoft Store (MSIX/AppX) tile + logo assets that
// electron-builder's `appx` target expects under build-resources/appx/.
//
// Windows renders these on a solid tile whose colour is set via the appx
// `backgroundColor` option in electron-builder.json, so we keep the glyph on a
// transparent background (fit: contain) and let the tile colour show through.
//
// Source is electron/icon.png (the raw 1024x1024 square artwork — NOT the
// rounded-corner build-resources/icon.png, since Windows tiles are square and
// apply their own styling). Re-run after changing the source icon:
//   node scripts/create-appx-assets.mjs

import sharp from "sharp";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../electron/icon.png");
const OUT = path.join(__dirname, "../build-resources/appx");

// The base logo set electron-builder maps into the AppxManifest. Sizes are the
// 100%-scale (scale-100) baselines; the Store also accepts these as-is.
// See https://www.electron.build/appx.html and Microsoft's tile guidelines.
const ASSETS = [
  { name: "StoreLogo.png", w: 50, h: 50 }, // Store listing / app list
  { name: "Square44x44Logo.png", w: 44, h: 44 }, // taskbar, app list, small tile
  { name: "Square71x71Logo.png", w: 71, h: 71 }, // small tile
  { name: "Square150x150Logo.png", w: 150, h: 150 }, // medium tile (primary)
  { name: "Square310x310Logo.png", w: 310, h: 310 }, // large tile
  { name: "Wide310x150Logo.png", w: 310, h: 150 }, // wide tile
  { name: "SplashScreen.png", w: 620, h: 300 }, // splash / large listing
];

// Glyph occupies this fraction of the shorter tile edge; the rest is padding so
// the artwork never touches the tile border (matches Windows' own tiles).
const GLYPH_FRACTION = 0.66;

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const { name, w, h } of ASSETS) {
    const glyphSize = Math.round(Math.min(w, h) * GLYPH_FRACTION);
    const glyph = await sharp(SRC)
      .resize(glyphSize, glyphSize, { fit: "contain", background: "#00000000" })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: "#00000000", // transparent — tile colour shows through
      },
    })
      .composite([{ input: glyph, gravity: "center" }])
      .png()
      .toFile(path.join(OUT, name));

    console.log(`[appx-assets] ${name} (${w}x${h})`);
  }

  console.log(`[appx-assets] wrote ${ASSETS.length} assets to ${OUT}`);
}

main().catch((err) => {
  console.error("[appx-assets] FAILED:", err.message);
  process.exit(1);
});
