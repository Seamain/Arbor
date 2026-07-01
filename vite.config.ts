import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // ── Build: split heavy vendor libs into separate chunks for better caching
  // and faster initial load.  Components loaded via React.lazy in App.tsx are
  // automatically split into their own chunks by Vite.
  build: {
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — changes rarely, cached across releases
          "react-vendor": ["react", "react-dom"],
          // HeroUI — large component library, separate from app code
          "heroui-vendor": ["@heroui/react", "@heroui/styles"],
          // Lucide icons — tree-shaken but still sizable
          "lucide-vendor": ["lucide-react"],
        },
      },
    },
  },
}));
