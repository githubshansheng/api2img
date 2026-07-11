import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [".heigh.vip"],
    port: 8081,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  preview: {
    port: 4173
  }
});
