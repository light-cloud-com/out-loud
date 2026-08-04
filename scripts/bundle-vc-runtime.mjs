// Stage the Microsoft Visual C++ runtime DLLs so they can ship *app-local*
// inside the Microsoft Store (MSIX/AppX) package.
//
// Why this exists:
//   The direct-download NSIS installer runs vc_redist.x64.exe at install time
//   (see build-resources/installer.nsh). An MSIX package is declarative and
//   CANNOT run an installer, so that trick is unavailable. Instead we copy the
//   CRT DLLs that onnxruntime_binding.node depends on (msvcp140.dll,
//   vcruntime140*.dll, ...) next to the app executable via electron-builder's
//   `extraFiles`. Windows' default DLL search order includes the executable's
//   directory, so the native addon resolves them without a system-wide redist.
//
// Redistributing these specific DLLs app-local is permitted by the Visual C++
// redistributable licence. We copy them from the Visual Studio "Redist" folder
// present on the build machine (the GitHub windows-latest runner ships it),
// NOT from C:\Windows\System32 (copying the OS copies is not licensed).
//
// Windows-only: no-ops on macOS/Linux so cross-platform `npm ci` etc. stay green.

import { existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "build-resources", "win-runtime");

// DLLs onnxruntime-node's native binding links against. The *_1 / *_2 variants
// don't exist on every toolset version — we copy whatever the redist provides
// and require only the core three.
const REQUIRED = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
const OPTIONAL = ["msvcp140_1.dll", "msvcp140_2.dll", "vcruntime140_threads.dll", "concrt140.dll"];

if (process.platform !== "win32") {
  console.log("[vc-runtime] not on Windows — skipping (MSIX is built on windows only)");
  process.exit(0);
}

// Locate the newest "Microsoft.VC*.CRT" x64 redist folder on this machine.
function findCrtDir() {
  const roots = [];

  // 1) vswhere (bundled with VS Installer) -> installation path -> VC redist.
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (existsSync(vswhere)) {
    try {
      const installPath = execFileSync(
        vswhere,
        ["-latest", "-products", "*", "-property", "installationPath"],
        { encoding: "utf8" }
      ).trim();
      if (installPath) roots.push(path.join(installPath, "VC", "Redist", "MSVC"));
    } catch (err) {
      console.warn(`[vc-runtime] vswhere lookup failed: ${err.message}`);
    }
  }

  // 2) Env var some CI images set directly.
  if (process.env.VCToolsRedistDir) roots.push(process.env.VCToolsRedistDir);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    // root may be either .../Redist/MSVC (contains version subfolders) or an
    // already-resolved VCToolsRedistDir. Walk down to the x64 CRT folder.
    const candidates = collectCrtDirs(root);
    if (candidates.length) {
      // Highest version wins (folder names sort lexically close enough; prefer
      // the longest path depth / newest mtime as a tiebreak).
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      return candidates[0];
    }
  }
  return null;
}

// Recursively find directories named "Microsoft.VC*.CRT" under an x64 path.
function collectCrtDirs(dir, depth = 0, acc = []) {
  if (depth > 5 || !existsSync(dir)) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (/^Microsoft\.VC\d+\.CRT$/i.test(e.name) && /(\\|\/)x64(\\|\/)/i.test(full + path.sep)) {
      acc.push(full);
    } else {
      collectCrtDirs(full, depth + 1, acc);
    }
  }
  return acc;
}

async function main() {
  const crtDir = findCrtDir();
  if (!crtDir) {
    throw new Error(
      "could not locate a Microsoft.VC*.CRT (x64) redist folder. Install the " +
        '"MSVC v143 - VS C++ x64/x86 build tools" component, or set VCToolsRedistDir.'
    );
  }
  console.log(`[vc-runtime] using CRT redist: ${crtDir}`);

  await mkdir(OUT, { recursive: true });

  const copied = [];
  const missingRequired = [];
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const src = path.join(crtDir, name);
    if (existsSync(src)) {
      copyFileSync(src, path.join(OUT, name));
      copied.push(name);
    } else if (REQUIRED.includes(name)) {
      missingRequired.push(name);
    }
  }

  if (missingRequired.length) {
    throw new Error(`required CRT DLL(s) not found in ${crtDir}: ${missingRequired.join(", ")}`);
  }

  console.log(`[vc-runtime] staged ${copied.length} DLL(s) -> ${OUT}: ${copied.join(", ")}`);
}

main().catch((err) => {
  console.error("[vc-runtime] FAILED:", err.message);
  process.exit(1);
});
