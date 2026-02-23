import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SERVER_IMPORT_RESTRICTIONS = [
  {
    group: ["@/server/*"],
    message:
      "Server-only modules are not allowed here. Move this logic to src/server or a route handler.",
  },
];

const FEATURE_DEEP_IMPORT_RESTRICTIONS = [
  {
    group: [
      "@/features/*/components/*",
      "@/features/*/hooks/*",
      "@/features/*/lib/*",
      "@/features/*/server/*",
    ],
    message:
      "Import from the feature public API (e.g. '@/features/<feature>') instead of deep internal paths.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/app/**/*.tsx",
      "src/components/**/*.{ts,tsx}",
      "src/features/**/components/**/*.{ts,tsx}",
      "src/features/**/hooks/**/*.{ts,tsx}",
      "src/shared/**/*.{ts,tsx,mts}",
      "src/utils/**/*.{ts,tsx,mts}",
    ],
    ignores: [
      "src/server/**/*",
      "src/app/api/**/*",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: SERVER_IMPORT_RESTRICTIONS }],
    },
  },
  {
    files: ["src/{app,server,shared,utils}/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: FEATURE_DEEP_IMPORT_RESTRICTIONS },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx,mts}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx,mts}", "tests/**/*.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
