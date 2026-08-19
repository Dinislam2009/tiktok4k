import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  base: "./",
  server: {
    port: 5173,
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});