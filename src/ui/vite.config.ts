import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    // The booking API is the local Worker: `bun dev` (alchemy dev) starts both and sets API_URL to its URL.
    proxy: process.env.API_URL ? { "/api": process.env.API_URL } : undefined,
  },
})
