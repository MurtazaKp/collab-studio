import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    root: dirname(fileURLToPath(import.meta.url)),
    include: ["**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
