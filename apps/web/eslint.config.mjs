import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/lib/supabase/database.types.ts"]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // React Compiler rules. We don't run the compiler; `refs` misfires on
      // dnd-kit's useSortable() results, and the remaining setState-in-effect
      // cases deliberately sync with external systems (providers, sockets, theme).
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
