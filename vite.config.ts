import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.PORT ?? 5183);

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5184),
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
  },
});
