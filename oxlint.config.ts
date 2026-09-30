import { defineConfig } from "oxlint"
import antiSlop from "ultracite/oxlint/anti-slop"
import core from "ultracite/oxlint/core"
import react from "ultracite/oxlint/react"

import effect from "./oxlint.effect.ts"

export default defineConfig({
  extends: [core, react, antiSlop, effect],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/dist/**",
    "test-results/**",
    "playwright-report/**",
  ],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    complexity: ["error", 15],
    "max-classes-per-file": "off",
    "max-depth": ["error", { max: 3 }],
    "sort-keys": "off",
    "unicorn/throw-new-error": "off",
  },
  overrides: [
    {
      // Browser and API steps in end-to-end tests and the walkthrough must run one after another.
      files: ["tests/e2e/**", "video/**"],
      rules: { "no-await-in-loop": "off" },
    },
  ],
})
