// Flat config — ESLint v9+
// Per-area configs: root Electron/scripts, electron-ui (React), chrome-extension (browser JS)

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  // Ignored paths (global)
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "dist/**",
      "releases/**",
      "electron/**/*.js",
      "electron/**/*.js.map",
      "electron-ui/dist/**",
      "tray-app/dist/**",
      "chrome-extension/lib/**",
      "chrome-extension/dist/**",
      "safari-extension/**",
      "**/package-lock.json",
    ],
  },

  // Recommended JS rules everywhere
  js.configs.recommended,

  // TypeScript (electron/ and electron-ui/)
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ["electron/**/*.ts", "electron-ui/**/*.{ts,tsx}"],
  })),

  // Electron main-process TS (Node runtime)
  {
    files: ["electron/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-ignore": "allow-with-description", minimumDescriptionLength: 0 },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },

  // Preload script (CommonJS)
  {
    files: ["electron/preload.cjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "commonjs", ecmaVersion: 2022 },
    },
  },

  // Electron UI (React + TS in a browser-ish renderer)
  {
    files: ["electron-ui/**/*.{ts,tsx}"],
    plugins: { react: reactPlugin, "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },

  // Chrome extension (plain browser JS, globals-style scripts loaded via <script src>)
  // Each script defines globals consumed by sibling scripts; disable no-undef here.
  {
    files: ["chrome-extension/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
      parserOptions: { sourceType: "script", ecmaVersion: 2022 },
    },
    rules: {
      // Chrome extension scripts are loaded via <script src> tags and define
      // globals that sibling scripts consume. ESLint can't see those cross-file
      // references, so both no-undef and no-unused-vars are disabled here.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // Chrome extension native host (Node CommonJS)
  {
    files: ["chrome-extension/native-host/**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "commonjs", ecmaVersion: 2022 },
    },
  },

  // Chrome extension build script (Node)
  {
    files: ["chrome-extension/build.js"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
  },

  // Node scripts (ESM)
  {
    files: ["scripts/**/*.mjs", "*.config.js", "*.config.mjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
  },

  // Tray app (Node + Electron)
  {
    files: ["tray-app/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { sourceType: "commonjs", ecmaVersion: 2022 },
    },
  },

  // Turn off formatting rules that conflict with Prettier
  prettier,
];
