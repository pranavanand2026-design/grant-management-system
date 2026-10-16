import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Publish ES and UMD formats so bundlers and script hosts share one library.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.js"),
      name: "GrantFlowUI",
      fileName: (format) => (format === "umd" ? "grantflow-ui.umd.cjs" : "grantflow-ui.js"),
      formats: ["es", "umd"],
    },
    rollupOptions: {
      // React is supplied by the host; the JSX runtime remains bundled.
      external: ["react", "react-dom"],
      output: {
        assetFileNames: "grantflow-ui.[ext]",
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
});
