import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Production is mounted at /app/. Source aliasing keeps product and library
// builds on the same component implementation.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  resolve: {
    alias: {
      "@gf-ui": resolve(import.meta.dirname, "../design-system/src/index.js"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
  },
});
