const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["eslint:recommended", "prettier", "eslint-config-turbo"],
  plugins: ["only-warn", "@typescript-eslint"],
  rules: {
    curly: ["error", "all"],
    "no-constant-condition": ["error", { checkLoops: false }],
  },
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    node: true,
  },
  settings: {
    "import/resolver": {
      typescript: {
        project,
      },
    },
  },
  ignorePatterns: [
    // Ignore dotfiles
    ".*.js",
    "node_modules/",
    "dist/",
  ],
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      rules: {
        // TypeScript-aware replacements for core rules that misread TS constructs
        // (parameter properties, type-signature parameters, type namespaces).
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": "error",
        "no-undef": "off",
      },
    },
    {
      files: ["*.js?(x)", "*.ts?(x)"],
    },
  ],
};
