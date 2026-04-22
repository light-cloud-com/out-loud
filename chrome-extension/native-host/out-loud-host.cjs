#!/usr/bin/env node

// Native Messaging Host for Out Loud TTS
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

// Debug logging
const LOG_FILE = path.join(__dirname, "debug.log");
function log(msg) {
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
}

log("Native host started");

const OUT_LOUD_PATH = path.join(__dirname, "..", "..");
const SERVER_PORT = 51730;

// Native messaging protocol
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(len);
  process.stdout.write(json);
  log(`Sent: ${json}`);
}

// Check if server is running
async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${SERVER_PORT}/api/v1/audio/voices`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Start server if needed
async function startServer() {
  log("Checking if server is running...");
  if (await isServerRunning()) {
    log("Server already running");
    return true;
  }

  log("Starting server...");
  return new Promise((resolve) => {
    const serverProcess = spawn("npm", ["run", "dev"], {
      cwd: OUT_LOUD_PATH,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let resolved = false;
    const checkReady = setInterval(async () => {
      if (await isServerRunning()) {
        clearInterval(checkReady);
        if (!resolved) {
          resolved = true;
          log("Server ready");
          resolve(true);
        }
      }
    }, 500);

    setTimeout(() => {
      clearInterval(checkReady);
      if (!resolved) {
        resolved = true;
        log("Server timeout");
        resolve(false);
      }
    }, 30000);

    serverProcess.on("error", (err) => {
      log(`Server error: ${err.message}`);
      clearInterval(checkReady);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

// Generate TTS
async function generateTTS(text, voice, model = "model_q8f16") {
  log(`Generating TTS: voice=${voice}, text=${text.substring(0, 50)}...`);
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
      speed: 1,
    });

    const req = http.request(
      {
        hostname: "localhost",
        port: SERVER_PORT,
        path: "/api/v1/audio/speech",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer no-key",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            log(`TTS generated: ${Buffer.concat(chunks).length} bytes`);
            resolve(Buffer.concat(chunks).toString("base64"));
          } else {
            log(`TTS error: ${res.statusCode}`);
            reject(new Error(`Server error: ${res.statusCode}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      log(`TTS request error: ${err.message}`);
      reject(err);
    });
    req.write(postData);
    req.end();
  });
}

// Read message from stdin
function readMessage() {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length >= 4) {
        const msgLen = buffer.readUInt32LE(0);
        if (buffer.length >= 4 + msgLen) {
          const msg = buffer.slice(4, 4 + msgLen).toString("utf8");
          buffer = buffer.slice(4 + msgLen);
          process.stdin.removeListener("data", onData);
          try {
            log(`Received: ${msg}`);
            resolve(JSON.parse(msg));
          } catch (e) {
            log(`Parse error: ${e.message}`);
            resolve(null);
          }
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

// Main
async function main() {
  try {
    log("Sending status: starting");
    sendMessage({ type: "status", status: "starting" });

    const started = await startServer();
    if (!started) {
      log("Failed to start server");
      sendMessage({ type: "error", error: "Failed to start Out Loud server" });
      process.exit(1);
    }

    log("Sending ready");
    sendMessage({ type: "ready" });

    // Keep processing messages
    while (true) {
      const msg = await readMessage();
      if (!msg) {
        log("No message received, continuing...");
        continue;
      }

      log(`Processing message type: ${msg.type}`);

      if (msg.type === "tts") {
        try {
          const audio = await generateTTS(msg.text, msg.voice, msg.model);
          sendMessage({ type: "audio", id: msg.id, audio });
        } catch (e) {
          log(`TTS error: ${e.message}`);
          sendMessage({ type: "error", id: msg.id, error: e.message });
        }
      } else if (msg.type === "ping") {
        sendMessage({ type: "pong" });
      }
    }
  } catch (e) {
    log(`Fatal error: ${e.message}`);
    sendMessage({ type: "error", error: e.message });
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  log("SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("SIGINT");
  process.exit(0);
});
process.stdin.on("end", () => {
  log("stdin end");
  process.exit(0);
});
process.on("uncaughtException", (e) => {
  log(`Uncaught: ${e.message}`);
});

main();
