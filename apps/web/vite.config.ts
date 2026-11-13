import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync } from "node:fs";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    react(),
    {
      name: "pdfjs-local-resources",
      closeBundle() {
        const root = fileURLToPath(new URL("../../", import.meta.url));
        for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
          mkdirSync(`${root}dist/web/pdfjs`, { recursive: true });
          cpSync(
            `${root}node_modules/pdfjs-dist/${dir}`,
            `${root}dist/web/pdfjs/${dir}`,
            { recursive: true },
          );
        }
      },
    },
  ],
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
