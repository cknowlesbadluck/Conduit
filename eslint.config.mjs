import tseslint from "typescript-eslint";

/** Minimal lint baseline: typescript-eslint `recommended` (correctness only; no stylistic or type-aware rules). */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "**/*.mjs", "**/*.js"] },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
);
