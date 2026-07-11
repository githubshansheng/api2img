import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [".heigh.vip"],
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  preview: {
    port: 4173
  }
});
