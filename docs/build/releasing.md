# Releasing

How to cut a new release. CI does the heavy lifting — you bump the version, tag it, push, and GitHub Actions builds + publishes a draft release.

## Contents

- [Output layout](#output-layout)
- [Release pipeline](#release-pipeline)
- [Cutting a release](#cutting-a-release)
- [Local builds (for verification)](#local-builds-for-verification)
- [Code signing](#code-signing)
- [Troubleshooting](#troubleshooting)
- [See also](#see-also)

## Output layout

All build artifacts land under `releases/` (gitignored):

```
releases/
├── macos/           *.dmg · *-mac.zip · *.blockmap
├── windows/         *-Setup.exe · *.blockmap
├── linux/           *.AppImage · *.deb · *.blockmap
└── extensions/
    ├── out-loud-chrome.zip
    └── safari/      Xcode project (generated from chrome-extension)
```

## Release pipeline

```mermaid
flowchart LR
  Tag[git tag v1.2.3<br/>+ push] --> GHA[GitHub Actions:<br/>.github/workflows/release.yml]

  GHA --> Mac[macos-latest runner<br/>build:mac]
  GHA --> Win[windows-latest runner<br/>build:win]
  GHA --> Lin[ubuntu-latest runner<br/>build:linux]
  GHA --> Ext[ubuntu-latest runner<br/>extension:chrome:pack]

  Mac --> Upload[Upload artifacts]
  Win --> Upload
  Lin --> Upload
  Ext --> Upload

  Upload --> Draft[Draft GitHub Release<br/>with all artifacts attached]
  Draft --> Review[Maintainer reviews]
  Review --> Publish[Publish release]
```

## Cutting a release

From a clean `main` branch:

```bash
# 1. Bump version (keeps package.json + creates git tag)
npm version patch   # or minor / major
# → commits "1.0.1" and tags it as "v1.0.1"

# 2. Push commit + tag together
git push --follow-tags

# 3. Watch the workflow
gh run watch
```

The tag push triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which:

1. Builds the macOS app on `macos-latest` (both `arm64` + `x64`)
2. Builds the Windows installer on `windows-latest`
3. Builds the Linux AppImage + .deb on `ubuntu-latest`
4. Packs the Chrome extension on `ubuntu-latest`
5. Creates a **draft** GitHub Release with all artifacts attached

Draft releases aren't public — review the assets and notes, then click **Publish release** in the GitHub UI when ready.

### Manual trigger

If you need to re-run a release build without re-tagging:

```bash
gh workflow run release.yml -f tag=v1.0.1
```

## Local builds (for verification)

You can run any build locally. Outputs land in `releases/<platform>/`.

```bash
npm run electron:build:mac       # macOS .dmg + .zip (arm64 + x64)
npm run electron:build:win       # Windows .exe (from Windows host)
npm run electron:build:linux     # Linux .AppImage + .deb
npm run extension:chrome:pack    # Chrome extension zip
npm run extension:safari:convert # Safari Xcode project (macOS + Xcode)
```

Cross-platform caveats:

- **From macOS** — you can build mac natively. Windows/Linux cross-builds work with electron-builder's bundled tooling but can't properly sign.
- **From Linux/Windows** — can't build macOS (notarization requires Apple hardware).
- **CI does each platform on its native runner**, so all builds are proper.

## Code signing

Release builds are unsigned unless you set the corresponding GitHub secrets. Unsigned builds work but show Gatekeeper / SmartScreen warnings.

### macOS

Create an Apple Developer ID certificate, then set:

| Secret                        | Source                                                   |
| ----------------------------- | -------------------------------------------------------- |
| `CSC_LINK`                    | Base64-encoded `.p12` certificate                        |
| `CSC_KEY_PASSWORD`            | Password for the `.p12`                                  |
| `APPLE_ID`                    | Your Apple ID email                                      |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com             |
| `APPLE_TEAM_ID`               | Your Apple Developer Team ID                             |

For Mac App Store (not Developer ID direct distribution), see [`mac-app-store.md`](./mac-app-store.md).

### Windows

| Secret                  | Source                                  |
| ----------------------- | --------------------------------------- |
| `WIN_CSC_LINK`          | Base64-encoded `.pfx` certificate       |
| `WIN_CSC_KEY_PASSWORD`  | Password for the `.pfx`                 |

### Linux

No signing required for AppImage or .deb.

## Troubleshooting

### "No artifacts uploaded"

One of the platform builds failed. Check the workflow logs — the release job runs regardless so successful artifacts still attach.

### "Release already exists"

Either the tag was published previously, or a previous run already created it. Delete the existing draft in GitHub UI, or publish/delete it, then re-run.

### Local mac build fails with "requires macOS"

`electron:build:mac` must run on macOS. On other platforms, rely on CI.

### Linux build missing `.deb`

Ensure `dpkg` is available (it is on `ubuntu-latest`). Locally on macOS, `.AppImage` builds but `.deb` requires `dpkg` (install with `brew install dpkg`).

## See also

- [`../../README.md#build-from-source`](../../README.md#build-from-source) — local build commands
- [`../../electron-builder.json`](../../electron-builder.json) — packaging config
- [`mac-app-store.md`](./mac-app-store.md) — MAS-specific flow (different from direct distribution)
