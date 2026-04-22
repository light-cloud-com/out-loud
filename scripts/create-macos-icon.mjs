import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const size = 1024;
const cornerRadius = size * 0.22; // macOS Big Sur style ~22% corner radius

// Create a rounded rectangle SVG mask (macOS squircle approximation)
const roundedMask = Buffer.from(`
<svg width="${size}" height="${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="white"/>
</svg>
`);

async function createMacOSIcon() {
  const inputPath = path.join(__dirname, "../electron/icon.png");
  const outputPath = path.join(__dirname, "../build-resources/icon.png");

  console.log("Creating macOS-styled icon...");

  // Read and resize the original icon to 1024x1024
  const resized = await sharp(inputPath)
    .resize(size, size, { fit: "contain", background: "#000000" })
    .toBuffer();

  // Apply rounded corners mask
  await sharp(resized)
    .composite([
      {
        input: await sharp(roundedMask).png().toBuffer(),
        blend: "dest-in",
      },
    ])
    .png()
    .toFile(outputPath);

  console.log(`Created: ${outputPath}`);
  console.log(
    "Now run: npx electron-icon-builder -i build-resources/icon.png -o build-resources --flatten"
  );
}

createMacOSIcon().catch(console.error);
