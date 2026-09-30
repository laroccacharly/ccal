import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "capture.test.ts",
  use: {
    baseURL: "http://localhost:3101",
    // A 1280×720 layout at 1.5× density paints sharp 1920×1080 frames.
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
    timezoneId: "America/Toronto",
    // Screencasts ignore emulated density unless the browser itself renders at 1.5×.
    channel: "chromium",
    launchOptions: { args: ["--force-device-scale-factor=1.5"] },
  },
  webServer: {
    command:
      "bunx vite src/ui --config src/ui/vite.config.ts --host 127.0.0.1 --port 3101",
    cwd: "..",
    url: "http://localhost:3101",
    reuseExistingServer: false,
  },
})
