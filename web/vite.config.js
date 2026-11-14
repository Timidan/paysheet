import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev the page reads the hosted API, so samples show the real run.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 4420, proxy: { "/api": { target: process.env.PAYSHEET_API || "https://paysheet.timidan.xyz", changeOrigin: true } } },
});
