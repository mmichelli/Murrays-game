import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Bind to 0.0.0.0 so phones on the same WiFi can reach the dev server.
export default defineConfig({
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
});
