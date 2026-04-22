const { app, Tray, Menu, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let tray = null;
let serverProcess = null;
let serverReady = false;

const OUT_LOUD_PATH = process.env.OUT_LOUD_PATH || path.join(__dirname, "..");
const SERVER_PORT = 51730;

// Check if server is running
function checkServer() {
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

// Start the server
async function startServer() {
  if (await checkServer()) {
    serverReady = true;
    updateTray();
    return;
  }

  console.log("Starting Out Loud server...");

  serverProcess = spawn("npm", ["run", "dev"], {
    cwd: OUT_LOUD_PATH,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    },
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(data.toString());
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(data.toString());
  });

  serverProcess.on("close", (code) => {
    console.log(`Server exited with code ${code}`);
    serverReady = false;
    serverProcess = null;
    updateTray();
  });

  // Poll until ready
  const checkReady = setInterval(async () => {
    if (await checkServer()) {
      clearInterval(checkReady);
      serverReady = true;
      console.log("Server ready!");
      updateTray();
    }
  }, 1000);
}

// Stop the server
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverReady = false;
  updateTray();
}

// Update tray menu
function updateTray() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: serverReady ? "● Server Running" : "○ Server Stopped",
      enabled: false,
    },
    { type: "separator" },
    {
      label: serverReady ? "Stop Server" : "Start Server",
      click: () => (serverReady ? stopServer() : startServer()),
    },
    { type: "separator" },
    {
      label: "Open Out Loud",
      click: () => {
        require("electron").shell.openExternal(`http://localhost:${SERVER_PORT}`);
      },
      enabled: serverReady,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        stopServer();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(serverReady ? "Out Loud TTS - Running" : "Out Loud TTS - Stopped");
}

// Create tray icon
function createTray() {
  // Create a simple icon (green circle when running, gray when stopped)
  const iconPath = path.join(__dirname, "iconTemplate.png");

  // If no icon file, create a basic one
  let image;
  try {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      throw new Error("Empty image");
    }
  } catch {
    // Create a simple 16x16 icon
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image.isEmpty() ? createDefaultIcon() : image);
  updateTray();
}

// Create a default icon if none exists
function createDefaultIcon() {
  // 16x16 PNG with "K" letter
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  // Fill with transparent
  for (let i = 0; i < canvas.length; i += 4) {
    canvas[i] = 0; // R
    canvas[i + 1] = 0; // G
    canvas[i + 2] = 0; // B
    canvas[i + 3] = 0; // A
  }

  // Draw a simple "K" shape
  const setPixel = (x, y, r, g, b, a) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (y * size + x) * 4;
      canvas[idx] = r;
      canvas[idx + 1] = g;
      canvas[idx + 2] = b;
      canvas[idx + 3] = a;
    }
  };

  // Draw K
  for (let y = 2; y < 14; y++) {
    setPixel(4, y, 100, 100, 100, 255); // Vertical line
  }
  for (let i = 0; i < 6; i++) {
    setPixel(5 + i, 8 - i, 100, 100, 100, 255); // Top diagonal
    setPixel(5 + i, 8 + i, 100, 100, 100, 255); // Bottom diagonal
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

// App ready
app.whenReady().then(() => {
  // Hide dock icon (menu bar app only)
  app.dock?.hide();

  createTray();
  startServer();
});

// Prevent app from quitting when all windows closed
app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("before-quit", () => {
  stopServer();
});
