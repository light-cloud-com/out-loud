# Changelog

All notable user-facing changes to Out Loud. See `git log` for the full
history.

## 1.0.6 — 2026-06-01

### Accessibility

- **Talker mode.** A new Settings toggle (off by default) turns Out Loud
  into a type-and-speak "talker": press **Enter** to speak the text and
  clear the box, the text box stays editable while audio plays (type the
  next line before the last finishes), and a short audio click plus a
  screen-reader status announce that speech is generating. Designed so the
  app is usable with your eyes closed or away from the screen.
- **Keyboard & focus.** **⌘/Ctrl+Enter** speaks in any mode, **Shift+Enter**
  inserts a line break, and **Esc** always returns the cursor to the single
  text box so it can never be "lost." The text box also autofocuses on
  launch.

### Speech

- **Pause tags.** Insert a silence anywhere with `[1s]`, `[500ms]`,
  `<pause=1s>`, or `<break time="1s"/>` (all equivalent). The bracket form
  already existed but was undocumented and strict; it now also accepts `ms`,
  capital `S`, and spaces. Documented in the README and the new Help panel.
- **Pause-aware highlighting.** "Highlight current chunk" now treats pause
  tags as silence, so the highlight stays in sync with the audio through
  pauses instead of drifting, and the tag itself is no longer highlighted.

### Updates & help

- **Update notifications.** Out Loud now checks GitHub for newer releases
  and shows an in-app banner when one is available, with a **Download**
  button that fetches the right installer for your platform directly. (No
  network calls in Mac App Store builds.)
- **Help / About panel.** A new **?** button in the footer opens a panel
  with the app version, keyboard shortcuts, a pause-tag cheat-sheet, and
  links to the site, repo, and issue tracker.

## 1.0.5 — 2026-05-24

### UI

- **Fix dropped characters in the text input.** The main process echoed
  every `settings:update` IPC back to the same renderer that sent it. The
  echo arrived after React had already applied later keystrokes, so the
  incoming broadcast overwrote the unsynced characters and the textarea
  appeared to "remove the most recent letters" while typing. Fixed by
  suppressing the broadcast on IPC-originated updates — HTTP-originated
  updates (Chrome extension) still notify the renderer as before.
- **"Load example" button.** Users who cleared the textarea in 1.0.4 had
  no way to get the demo text back without clearing localStorage. There's
  now a small "Load example" link in the bottom-right of the textarea
  whenever it's empty.

## 1.0.4 — 2026-05-23

### UI

- **Textarea no longer reverts to the example text.** The input field used
  a per-render fallback (`settings.text || DEFAULT_TEXT`), which meant any
  empty value snapped back to the example. Typing felt like the field was
  fighting you and clearing it was impossible. Now `DEFAULT_TEXT` is seeded
  into the saved settings only on the first-ever launch; after that, your
  edits (including the empty string) persist properly.

### Release infrastructure (no user-visible change)

- **Switched to Pattern C** for macOS notarization to insulate releases
  from Apple notary outages. CI ships signed-but-not-notarized DMGs to a
  draft release in ~5 min (no waiting on Apple). A new local script
  `scripts/notarize-release.mjs` then downloads, submits to Apple, staples,
  and re-uploads — this can take as long as it needs to without timing out
  the CI runner. See [docs/build/releasing.md](./docs/build/releasing.md)
  for the rationale and step-by-step.

## 1.0.3 — 2026-05-23

### macOS

- **Notarization re-enabled.** Apple's notary service was unhealthy during
  the 1.0.2 release window, so 1.0.2 shipped signed-but-not-notarized and
  triggered the "macOS cannot verify the developer" dialog on first launch.
  Apple's queue cleared later the same day; 1.0.3 is fully Developer-ID
  signed AND notarized. First launch now opens immediately with no prompt.

## 1.0.2 — 2026-05-23

### Cross-platform packaging fixes

- **macOS and Windows**: ship every transitive dependency. The previous
  release shipped `onnxruntime-node` without its `onnxruntime-common` peer,
  which made TTS fail at startup on every platform that got past the
  Gatekeeper / SmartScreen wall. The installer now bundles the full
  dependency tree via electron-builder's automatic production-deps resolver.
- **macOS and Windows**: resolve `ffmpeg-static` and embedded model paths
  to their real on-disk location under `app.asar.unpacked`. Reads via
  `fs.readFile` worked through Electron's asar layer, but `child_process.spawn`
  (used to launch ffmpeg) bypasses asar and was failing silently with ENOENT
  on `speed != 1` or MP3 export.

### macOS

- **Code signing**: builds are now signed with our Apple Developer ID
  (`Developer ID Application: Julia Kafarska (8Y2UTZ2NBZ)`) and hardened
  runtime is enabled. The misleading "Out Loud.app is damaged and can't be
  opened" message is gone. First launch now shows the standard "macOS cannot
  verify the developer" dialog — right-click → **Open** once and macOS
  remembers. No more Terminal commands needed.
- _Notarization is temporarily disabled while Apple's notary service works
  through a backlog. Two submissions sat at status `In Progress` for 24+
  hours during the release window with no movement, so we shipped 1.0.2
  signed-but-not-notarized rather than block the release. We'll re-enable
  in 1.0.3 (just flip `mac.notarize` back to `true` in
  `electron-builder.json` and rebuild) once Apple's queue is healthy. At
  that point first launch will open with no prompt at all. For now, users
  on macOS 15+ have to go through System Settings → Privacy & Security →
  Open Anyway on first launch; older macOS still allows the right-click →
  Open shortcut. See the [README install notes](./README.md#macos-macos-cannot-verify-the-developer-of-out-loud)._
- **Quit crash**: fixed `SIGABRT` on quit caused by V8 tearing down the
  Node environment before the TTS worker finished releasing its ONNX
  session. The main process now hard-terminates the worker before quit so
  the OS reclaims native resources cleanly instead of joining a thread
  mid-finalize.

### Windows

- **TTS engine now loads on fresh Windows installs**. The Out Loud installer
  bundles the Microsoft Visual C++ 2015-2022 Redistributable and installs
  it silently as part of setup. Previously, fresh Windows installs without
  the redistributable failed to load `onnxruntime_binding.node` with the
  cryptic `ERR_DLOPEN_FAILED` / "Cannot find the specified module" error.
- **Window UX**: stopped applying `titleBarStyle: "hiddenInset"` and the
  invisible drag region on Windows. They're macOS-only constructs that were
  fighting Windows' native title bar and causing the "jumpy / fighting with
  the user" feel on first launch.
- **Error visibility**: TTS errors now surface as a red banner in the UI
  with the worker stack trace and platform info, instead of being silently
  logged. Makes future Windows / cross-platform bugs much easier to report.

### Internal

- Tray-app PATH prefix `/opt/homebrew/bin:/usr/local/bin` is now applied
  only on macOS so Windows PATH isn't corrupted.
- Release CI workflow consumes signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and the optional
  Windows pair) so the same signed-and-bundled artifacts you can build
  locally are what ships from CI.

## 1.0.0 — 2026-04-22

Initial public release.
