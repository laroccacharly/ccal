import * as Cloudflare from "alchemy/Cloudflare"
import * as SQL from "alchemy/SQL/D1"
import { Config, Effect, Layer, Match, Option } from "effect"
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http"

import { RETRY_CRON, retryMeetings } from "./meetings"
import { RATE_LIMIT, RateLimiter, rateLimit } from "./rate-limit"
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
        // Must not be newer than what Alchemy's bundled workerd supports, or it fails with a ConfigError.
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
      dev: {
        port: yield* Config.Int("DEV_PORT").pipe(Config.withDefault(1337)),
        strictPort: true,
      },
      // The host of `ccal config --set-url`, provided by alchemy.run.ts. Unset (as inside the running Worker),
      // custom domains are left alone. `alchemy dev` ignores it.
      domain: Option.getOrUndefined(
        yield* Config.option(Config.String("CCAL_DOMAIN"))
      ),
      env: {
        // Required to read bookings (GET /api/booking-requests). Set it in .env or the environment.
        CCAL_API_KEY: Config.Redacted("CCAL_API_KEY"),
        // To create Google Meet invites: the OAuth client from .env, and the refresh token saved by `ccal login`
        // (provided by alchemy.run.ts). The Worker trades the refresh token for a short-lived access token.
        // Read here rather than passed as Config, which Alchemy resolves without alchemy.run.ts's provider.
        GOOGLE_CLIENT_ID: yield* Config.String("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
        GOOGLE_REFRESH_TOKEN: yield* Config.Redacted("GOOGLE_REFRESH_TOKEN"),
        // Only set by the end-to-end tests, to stand in for Google.
        ...Option.match(
          yield* Config.option(Config.String("GOOGLE_API_ORIGIN")),
          {
            onNone: () => ({}),
            onSome: (origin) => ({ GOOGLE_API_ORIGIN: origin }),
          }
        ),
      },
    }
  }),
  Effect.gen(function* worker() {
    const d1 = yield* Cloudflare.D1.QueryDatabase(yield* Database)
    const limiter = yield* RateLimiter
    const handleFetch = yield* HttpRouter.toHttpEffect(routes)
    const services = Layer.mergeAll(SQL.D1Layer(d1), FetchHttpClient.layer)
    yield* Cloudflare.Workers.cron(RETRY_CRON, (controller) =>
      retryMeetings(controller.scheduledTime).pipe(Effect.provide(services))
    )
    return {
      fetch: rateLimit(limiter).pipe(
        Effect.andThen(handleFetch),
        Effect.provide(services),
        Effect.catchTags({
          RateLimited: () =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                { error: "rate_limited" },
                {
                  status: 429,
                  headers: { "Retry-After": String(RATE_LIMIT.period) },
                }
              )
            ),
          RateLimitUnavailable: () => jsonError("rate_limit_unavailable", 503),
          Unauthorized: () => jsonError("unauthorized", 401),
          SlotUnavailable: () => jsonError("slot_unavailable", 422),
          SchemaError: () => jsonError("invalid_request", 400),
          BookingNotStored: () => jsonError("booking_store_failed", 500),
          SqlError: () => jsonError("booking_store_failed", 500),
          HttpServerError: (error) =>
            Match.value(error.reason).pipe(
              Match.tag("RouteNotFound", () => jsonError("not_found", 404)),
              Match.tag("RequestParseError", () =>
                jsonError("invalid_request", 400)
              ),
              Match.orElse(() => Effect.fail(error))
            ),
        }),
        Effect.orDie
      ),
    }
  }).pipe(
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.Workers.RateLimitBinding,
      Cloudflare.Workers.CronEventSourceLive,
    ])
  )
) {}
