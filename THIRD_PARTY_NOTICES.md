# Third-Party Notices

Out Loud is MIT licensed. It bundles and depends on the following third-party software and models, each under its own license. This file lists the notable components and their licenses so redistributors and auditors have a single place to check.

Full license texts are available at the linked sources. This file is informational and does not supersede the upstream licenses.

---

## Models

### Kokoro-82M

- **Project:** <https://huggingface.co/hexgrad/Kokoro-82M>
- **License:** Apache License 2.0
- **Used for:** text-to-speech synthesis (ONNX weights loaded by the Electron main process)
- **Notice:** Copyright 2024 hexgrad. Licensed under the Apache License, Version 2.0. You may obtain a copy of the License at <https://www.apache.org/licenses/LICENSE-2.0>.

---

## Runtime dependencies (bundled with the app)

### espeak-ng (`espeak-ng` npm package)

- **Upstream:** <https://github.com/espeak-ng/espeak-ng>
- **License:** GNU General Public License v3.0 (GPLv3)
- **Linkage:** dynamic (the app shells out to / loads the `espeak-ng` binary for phonemization). The GPL applies to espeak-ng itself; Out Loud's own source remains under MIT.
- **Source availability:** <https://github.com/espeak-ng/espeak-ng>

### onnxruntime-node

- **Upstream:** <https://github.com/microsoft/onnxruntime>
- **License:** MIT License
- **Used for:** on-device ONNX inference in the TTS worker.

### ffmpeg-static / fluent-ffmpeg

- **Upstream (ffmpeg):** <https://ffmpeg.org>
- **ffmpeg binary:** distributed under LGPL v2.1+ (or GPL v2+ depending on build flags)
- **fluent-ffmpeg:** MIT License (<https://github.com/fluent-ffmpeg/node-fluent-ffmpeg>)
- **ffmpeg-static:** GPL v2+ for the packaged binary (<https://github.com/eugeneware/ffmpeg-static>)
- **Used for:** audio encoding / resampling

### wavefile

- **Upstream:** <https://github.com/rochars/wavefile>
- **License:** MIT License

### Electron

- **Upstream:** <https://www.electronjs.org>
- **License:** MIT License (Electron itself; bundled Chromium and Node.js have their own BSD / MIT / other licenses)

---

## Development / build dependencies

Out Loud's development toolchain — TypeScript, ESLint, Prettier, Vite, React, Tailwind CSS, Vitest, electron-builder, Knip, sharp, and others — is pulled in via `npm install` and installed under each package's license (predominantly MIT, with some BSD / Apache). These are not redistributed in the shipped app artifacts beyond what Electron requires for the renderer.

---

## Icons, fonts, and UI assets

- **Tux (Linux mascot):** created by Larry Ewing (<https://isc.tamu.edu/~lewing/linux/>). Public distribution permitted; credit preserved in `public/tux.svg`.
- **Debian swirl:** Debian Project trademark, used to identify Debian `.deb` packages.
- **Apple, Windows, and Chrome marks:** trademarks of their respective owners, used here only to identify platform-specific downloads and not for endorsement.
- **Fonts:** Syne and Figtree via Google Fonts, both under the SIL Open Font License 1.1.

---

## Reporting attribution issues

If you believe a component is missing from this file, or an attribution here is incorrect, please open an issue: <https://github.com/light-cloud-com/out-loud/issues>.
