import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.generated.ts",
      "**/.turbo/**",
      "deeplinker-dist/**",
      "examples/**",
      "fixtures/site/**",
      "playwright-report/**",
      "test-results/**",
      "apps/web-generator/public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Build scripts and tool configs run in Node.
    files: ["**/scripts/**/*.mjs", "*.config.js", "*.config.ts", "packages/*/*.config.ts"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", fetch: "readonly", setTimeout: "readonly" },
    },
  },
  {
    // Tests assert against loosely typed JSON; `any` there is a convenience, not a hole in the product code.
    files: ["**/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // core and generator must stay pure: no Node, no DOM.
    files: ["packages/core/src/**/*.ts", "packages/generator/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "crypto", "child_process"],
              message: "core and generator are pure: no Node APIs.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "core and generator are DOM-free." },
        { name: "document", message: "core and generator are DOM-free." },
        { name: "process", message: "core and generator are Node-free." },
        { name: "Buffer", message: "core and generator are Node-free." },
      ],
    },
  },
);
