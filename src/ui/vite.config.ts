import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The UI embeds the Turnstile sitekey at build time, so a build without it would deploy a booking page that cannot
// verify anyone.
if (
  process.env.TURNSTILE_SITE_KEY === undefined ||
  process.env.TURNSTILE_SITE_KEY === ""
) {
  throw new Error("TURNSTILE_SITE_KEY must be set to build the UI.")
}

// https://vite.dev/config/
export default defineConfig({
  // Exposes TURNSTILE_SITE_KEY from the environment. Never a bare "TURNSTILE_" prefix, which would also embed
  // TURNSTILE_SECRET_KEY in the UI.
  envPrefix: ["VITE_", "TURNSTILE_SITE_KEY"],
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
})
