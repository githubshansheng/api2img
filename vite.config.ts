import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { defineConfig } from "vite";

const workspaceRoot = process.env.VITEST
  ? process.cwd()
  : realpathSync.native(process.cwd());
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8787";
const devPort = Number(process.env.VITE_DEV_PORT ?? 8081);

export default defineConfig({
  root: workspaceRoot,
  cacheDir: `node_modules/.vite-${devPort}`,
  plugins: [tailwindcss(), react()],
  resolve: {
    preserveSymlinks: Boolean(process.env.VITEST)
  },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client"
    ]
  },
  server: {
    allowedHosts: [".heigh.vip"],
    port: devPort,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget
    }
  },
  preview: {
    port: devPort,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget
    }
  }
});
