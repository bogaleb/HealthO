import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "playwright-report/**", "test-results/**", "**/next-env.d.ts", "packages/db/migrations/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["error", "warn", "log"] }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // Architecture rule: domain packages must not depend on Next.js or React.
    files: ["packages/{core,auth,db,shared}/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["next", "next/*", "react", "react-dom", "@projectos/ui"], message: "Domain packages must stay framework-free." }] }],
    },
  },
);
