import { defineConfig } from "oxlint"

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "react", "import"],
  categories: {
    correctness: "error",
    suspicious: "warn",
  },
  rules: {
    "react/react-in-jsx-scope": "off",
    "import/no-unassigned-import": ["warn", { allow: ["**/*.css"] }],
    "unicorn/consistent-function-scoping": "off",
    // Effect errors and unions are discriminated by `_tag`.
    "no-underscore-dangle": ["warn", { allow: ["_tag"] }],
  },
  env: {
    builtin: true,
    browser: true,
  },
  ignorePatterns: ["**/dist/**", "test-results/**", "playwright-report/**"],
})
