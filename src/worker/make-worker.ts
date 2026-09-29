import * as Cloudflare from "alchemy/Cloudflare"
import type { Database as D1Database } from "alchemy/Cloudflare/D1"
import * as SQL from "alchemy/SQL/D1"
import { Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"

import { jsonError, toException } from "./http"
import { notFound, workerRoutes } from "./routes"

export const makeWorker = Effect.fn("makeWorker")(
  function* makeWorker(input: { database: D1Database }) {
    const d1 = yield* Cloudflare.D1.QueryDatabase(input.database)
    const sqlLive = SQL.D1Layer(d1)

    const handleFetch = yield* HttpRouter.toHttpEffect(workerRoutes)

    return {
      fetch: handleFetch.pipe(
        Effect.provide(sqlLive),
        Effect.catchTag("Unauthorized", () => Effect.succeed(jsonError("unauthorized", 401))),
        Effect.catchTag("InvalidRequest", () => Effect.succeed(jsonError("invalid_request", 400))),
        Effect.catchTag("BookingNotStored", () => Effect.succeed(jsonError("booking_store_failed", 500))),
        Effect.catchTag("SqlError", () => Effect.succeed(jsonError("booking_store_failed", 500))),
        Effect.catchTag("HttpServerError", notFound),
        Effect.mapError(toException),
        Effect.orDie,
      ),
    }
  },
  Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
)
