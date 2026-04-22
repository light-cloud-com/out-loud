#!/usr/bin/env node
/**
 * Download all Kokoro TTS voice files from HuggingFace
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const voicesDir = path.join(__dirname, "..", "voices");

const downloadUrl =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";

// All available voices
const voices = [
  // English US
  "af_heart",
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  // English GB
  "bf_emma",
  "bf_isabella",
  "bf_alice",
  "bf_lily",
  "bm_george",
  "bm_lewis",
  "bm_daniel",
  "bm_fable",
  // Spanish
  "ef_dora",
  "em_alex",
  "em_santa",
  // Japanese
  "jf_alpha",
  "jf_gongitsune",
  "jf_nezumi",
  "jf_tebukuro",
  "jm_kumo",
  // Chinese
  "zf_xiaobei",
  "zf_xiaoni",
  "zf_xiaoxiao",
  "zf_xiaoyi",
  "zm_yunjian",
  "zm_yunxi",
  "zm_yunxia",
  "zm_yunyang",
  // Hindi
  "hf_alpha",
  "hf_beta",
  "hm_omega",
  "hm_psi",
  // Italian
  "if_sara",
  "im_nicola",
  // Portuguese
  "pf_dora",
  "pm_alex",
  "pm_santa",
];

async function downloadVoice(voiceId) {
  const url = `${downloadUrl}/voices/${voiceId}.bin`;
  const outputPath = path.join(voicesDir, `${voiceId}.bin`);

  if (fs.existsSync(outputPath)) {
    console.log(`✓ ${voiceId} (already exists)`);
    return;
  }

  try {
    console.log(`↓ Downloading ${voiceId}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    console.log(`✓ ${voiceId} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`✗ ${voiceId}: ${e.message}`);
  }
}

async function main() {
  // Create voices directory
  if (!fs.existsSync(voicesDir)) {
    fs.mkdirSync(voicesDir, { recursive: true });
  }

  console.log(`Downloading ${voices.length} voices to ${voicesDir}\n`);

  // Download in parallel (5 at a time)
  const batchSize = 5;
  for (let i = 0; i < voices.length; i += batchSize) {
    const batch = voices.slice(i, i + batchSize);
    await Promise.all(batch.map(downloadVoice));
  }

  console.log("\nDone!");
}

main();
