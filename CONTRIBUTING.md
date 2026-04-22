# Contributing to Out Loud

Thanks for your interest. Out Loud is built in the open — bug reports, code, translations, and new voices are all welcome.

## Contents

- [Ground rules](#ground-rules)
- [Reporting bugs](#reporting-bugs)
- [Proposing features](#proposing-features)
- [Development setup](#development-setup)
- [Code style](#code-style)
- [Pre-commit hook](#pre-commit-hook)
- [Before you open a pull request](#before-you-open-a-pull-request)
- [Pull request checklist](#pull-request-checklist)
- [Project layout](#project-layout)
- [Adding a voice](#adding-a-voice)
- [Questions](#questions)

## Ground rules

- Be kind and respectful.
- Keep changes focused — one logical change per pull request.
- Don't commit binaries, models, or credentials. Models are downloaded at runtime; the repo stays small.
- By contributing, you agree your contributions are licensed under the [MIT License](./LICENSE).

## Reporting bugs

Open an [issue](https://github.com/light-cloud-com/out-loud/issues/new/choose) using the **Bug report** template. Please include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your OS + app version
- Relevant logs (the terminal where you ran the app, or the Out Loud log panel)

## Proposing features

Open an issue using the **Feature request** template first. A quick conversation before code saves everyone time.

## Development setup

```bash
git clone https://github.com/light-cloud-com/out-loud.git
cd out-loud
npm install
npm run electron-ui:install
npm run electron:dev
```

See the [root README](./README.md#build-from-source) for the full build matrix.

## Code style

- **TypeScript + React** in `electron/` and `electron-ui/`.
- **Prettier** handles formatting — run `npm run fmt` or let the pre-commit hook do it.
- **ESLint** catches real bugs — run `npm run lint` (or `npm run lint:fix`).
- **EditorConfig** (`.editorconfig`) keeps indentation consistent across editors.
- Prefer small, well-named functions over comments that explain what the code does.
- Keep the main process (`electron/main.ts`) thin — push logic into workers and modules.

## Pre-commit hook

A husky hook runs `lint-staged` on every `git commit`:

- ESLint with `--fix` on staged `.ts/.tsx/.js/.mjs/.cjs` files
- Prettier on staged `.json/.md/.yml/.yaml/.css/.html` files

You generally won't need to think about formatting — it happens at commit time. If a file can't be auto-fixed, the commit will fail with a clear error message.

## Before you open a pull request

Run these locally and make sure they pass:

```bash
npm run check       # lint + fmt:check + knip + electron:compile
npm test            # unit tests
```

CI runs the same checks.

## Pull request checklist

- [ ] Branch is up to date with `main`
- [ ] Tests added or updated where it makes sense
- [ ] `npm run knip` is clean
- [ ] UI changes include a screenshot or short screen recording
- [ ] Commit messages describe _why_, not just _what_

## Project layout

See [Repository layout](./README.md#repository-layout) in the root README. Deeper docs:

- [`docs/app/architecture.md`](./docs/app/architecture.md) — Electron app internals
- [`docs/app/api.md`](./docs/app/api.md) — HTTP API reference
- [`docs/extensions/testing.md`](./docs/extensions/testing.md) — extension E2E tests
- [`docs/build/mac-app-store.md`](./docs/build/mac-app-store.md) — MAS distribution

## Adding a voice

Kokoro voices are embedded ONNX files under `electron/models/`. To add one:

1. Register the voice metadata in `electron-ui/src/components/VoiceSelect.tsx` (id, name, language)
2. Register the language prefix mapping in `electron/main.ts` (`getVoiceLang`)
3. Add the voice entry to `getVoicesList()` in `electron/main.ts` so the HTTP API exposes it

For new languages, `espeak-ng` must support them too — check the available languages in the package.

## Questions

If anything in this guide is unclear or out of date, open an issue or a PR to fix it. That's a contribution too.
