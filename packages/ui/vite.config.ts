import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("@codemirror/lang-") ||
            /@lezer\/(css|html|javascript|json|markdown|python|rust)/.test(id)
          ) {
            return "editor-languages";
          }
          if (
            id.includes("@codemirror/") ||
            id.includes("@lezer/") ||
            id.includes("style-mod") ||
            id.includes("w3c-keyname") ||
            id.includes("crelt")
          ) {
            return "editor-core";
          }
          if (id.includes("solid-js")) return "solid";
          if (id.includes("@tauri-apps/")) return "tauri";
        },
      },
    },
  },
  clearScreen: false,
});
