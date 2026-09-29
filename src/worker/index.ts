import * as Cloudflare from "alchemy/Cloudflare"
import * as SQL from "alchemy/SQL/D1"
import { Config, Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

import { routes } from "./routes"

export const Database = Cloudflare.D1.Database("Database", {
  migrations: "migrations",
})
const jsonError = (error: string, status: number) =>
  Effect.succeed(HttpServerResponse.jsonUnsafe({ error }, { status }))

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
    const d1 = yield* Cloudflare.D1.QueryDatabase(yield* Database)
    const handleFetch = yield* HttpRouter.toHttpEffect(routes)
    return {
      fetch: handleFetch.pipe(
        Effect.provide(SQL.D1Layer(d1)),
        Effect.catchTags({
          Unauthorized: () => jsonError("unauthorized", 401),
          SchemaError: () => jsonError("invalid_request", 400),
          BookingNotStored: () => jsonError("booking_store_failed", 500),
          SqlError: () => jsonError("booking_store_failed", 500),
          HttpServerError: (error) => {
            switch (error.reason._tag) {
              case "RouteNotFound": {
                return jsonError("not_found", 404)
              }
              case "RequestParseError": {
                return jsonError("invalid_request", 400)
              }
              default: {
                return Effect.fail(error)
              }
            }
          },
        }),
        Effect.orDie,
      ),
    }
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
) {}

