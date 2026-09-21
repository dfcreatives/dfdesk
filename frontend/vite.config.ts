import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 3000,
    proxy: {
      "^/api(?:/|$)": {
        target: "http://localhost:4000",
        changeOrigin: false,
      },
    },
  },
  build: { sourcemap: true },
});
