import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Vite resolves `@jellytind/*` workspace packages to their TypeScript source via
// each package's `main`/`exports` field; `tsconfigPaths` is a belt-and-braces
// fallback that also honours the `paths` map in tsconfig.base.json.
export default defineConfig({
  plugins: [react(), tsconfigPaths({ root: "../.." })],
  // Tauri expects a fixed dev port and manages its own console output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    emptyOutDir: true,
  },
});
