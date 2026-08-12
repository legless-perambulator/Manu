import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// A separate config so `scripts/make-dev-project.ts` never runs as part of
// `pnpm test`: it writes to disk, which a test run must not do.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: false,
    environment: "node",
    include: ["scripts/make-dev-project.ts"],
  },
});
