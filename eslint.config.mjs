import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Non-negotiable from CLAUDE.md: colour lives in `app/globals.css` as CSS variables.
// A raw hex anywhere else means a token was invented instead of used.
const NO_RAW_HEX = {
  selector: "Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
  message:
    "No raw hex. Use a token: var(--paper), var(--ink), var(--moss). Colours are defined once, in app/globals.css.",
};

const NO_RAW_HEX_TEMPLATE = {
  selector:
    "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
  message:
    "No raw hex in a template literal. Use a token: var(--paper), var(--ink), var(--moss).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": ["error", NO_RAW_HEX, NO_RAW_HEX_TEMPLATE],
    },
  },
  {
    // Seed data and tests may carry fixture colours (seller theme hexes, for one).
    files: ["prisma/seed.ts", "tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/db/generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
