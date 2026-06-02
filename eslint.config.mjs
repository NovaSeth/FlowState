import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // i18n data files are plain JSON (the translation source) - we do not lint
    // them with next's JSON rules (json/no-empty-keys false-positives on objects).
    "src/i18n/*.json",
  ]),
]);

export default eslintConfig;
