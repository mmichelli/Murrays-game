import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `base` is "/" for local dev/preview and is set to the repo path
// (e.g. "/Murrays-game-/") in the GitHub Pages build via BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
