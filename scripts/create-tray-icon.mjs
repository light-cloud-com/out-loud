import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTrayIcon() {
  const inputPath = path.join(__dirname, "../electron/icon.png");
  const outputPath = path.join(__dirname, "../electron/tray-icon.png");

  console.log("Creating tray icon with transparent background...");

  // Read the original icon
  const image = sharp(inputPath);

  // Extract raw pixel data
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // Create new buffer - invert colors and make black transparent
  const newData = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Calculate brightness
    const brightness = (r + g + b) / 3;

    // If pixel is dark (background), make it transparent
    // If pixel is light (waveform), make it black
    if (brightness < 50) {
      // Dark pixel -> transparent
      newData[i] = 0;
      newData[i + 1] = 0;
      newData[i + 2] = 0;
      newData[i + 3] = 0;
    } else {
      // Light pixel -> black with original alpha based on brightness
      newData[i] = 0;
      newData[i + 1] = 0;
      newData[i + 2] = 0;
      newData[i + 3] = Math.min(255, brightness * 2);
    }
  }

  // Save the new icon
  await sharp(newData, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .resize(36, 36) // 2x for retina (18x18 logical)
    .png()
    .toFile(outputPath);

  console.log(`Created: ${outputPath}`);
}

createTrayIcon().catch(console.error);
