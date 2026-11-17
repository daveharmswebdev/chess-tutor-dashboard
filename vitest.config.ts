import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", ".claude/hooks/test/**/*.test.ts"],
    // Tests never touch the network: fetchers are tested against recorded fixtures and stubbed fetch (P-6).
    unstubGlobals: true,
  },
});
