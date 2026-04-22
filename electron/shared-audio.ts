import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import wavefile from "wavefile";
const { WaveFile } = wavefile;

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export function createWavBuffer(waveform: Float32Array, sampleRate: number): ArrayBuffer {
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, "32f", waveform);
  return wav.toBuffer().buffer as ArrayBuffer;
}

export function buildAtempoChain(velocity: number): string {
  if (velocity === 1) return "anull";

  const filters: string[] = [];
  let remaining = velocity;

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2.0");
    remaining /= 2;
  }

  if (remaining !== 1) {
    filters.push(`atempo=${remaining}`);
  }

  return filters.length > 0 ? filters.join(",") : "anull";
}

export async function modifyWavSpeed(
  wavBuffer: ArrayBuffer,
  velocity: number
): Promise<ArrayBuffer> {
  if (velocity === 1) return wavBuffer;

  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `input-${crypto.randomUUID()}.wav`);
  const outputPath = path.join(tmpDir, `output-${crypto.randomUUID()}.wav`);

  await fs.writeFile(inputPath, Buffer.from(wavBuffer));

  const filter = buildAtempoChain(velocity);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .noVideo()
      .audioFilters(filter)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  const data = await fs.readFile(outputPath);
  fs.unlink(inputPath).catch(() => {});
  fs.unlink(outputPath).catch(() => {});

  return new Uint8Array(data).buffer;
}

export async function wavToMp3(wavBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `input-${crypto.randomUUID()}.wav`);
  const outputPath = path.join(tmpDir, `output-${crypto.randomUUID()}.mp3`);

  await fs.writeFile(inputPath, Buffer.from(wavBuffer));

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioBitrate("192k")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  const data = await fs.readFile(outputPath);

  fs.unlink(inputPath).catch(() => {});
  fs.unlink(outputPath).catch(() => {});

  return new Uint8Array(data).buffer;
}
