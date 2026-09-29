import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Option } from "effect"

import { makeWorker } from "./make-worker"

export { Unauthorized } from "./auth"
export { InvalidRequest } from "./http"
export { makeWorker } from "./make-worker"

export const Database = Cloudflare.D1.Database("Database", {
  migrations: "migrations",
})

export default class Worker extends Cloudflare.Worker<Worker>()(
  "Worker",
  Effect.gen(function* workerProps() {
    return {
      name: "ccal",
      main: import.meta.url,
      compatibility: {
        date: "2026-09-01",
        flags: ["nodejs_compat" as const],
      },
      // The UI, built by `bun run build`. The Worker only runs for /api/*; every other path is the single-page app.
      assets: {
        directory: "src/ui/dist",
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/api/*"],
      },
      // `alchemy dev` serves the Worker here. Strict, so callers such as Playwright can rely on the port.
      dev: { port: yield* Config.Int("DEV_PORT").pipe(Config.withDefault(1337)), strictPort: true },
      // The host of `ccal config --set-url`, provided by alchemy.run.ts. Unset (as inside the running Worker),
      // custom domains are left alone. `alchemy dev` ignores it.
      domain: Option.getOrUndefined(yield* Config.option(Config.String("CCAL_DOMAIN"))),
      env: {
        // Required to read bookings (GET /api/booking-requests). Set it in .env or the environment.
        CCAL_API_KEY: Config.Redacted("CCAL_API_KEY"),
      },
    }
  }),
  Effect.gen(function* worker() {
    const database = yield* Database
    return yield* makeWorker({ database })
  }),
) {}
