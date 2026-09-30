import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"

// Every request the Worker handles (all of /api/*) counts against its client's budget.
// Cloudflare's rate-limit binding only counts over 10 or 60 seconds.
export const RATE_LIMIT = {
  namespaceId: "26092901",
  limit: 10,
  period: 60,
} as const

export const RateLimiter = Cloudflare.RateLimit("RATE_LIMITER", {
  namespaceId: RATE_LIMIT.namespaceId,
  simple: { limit: RATE_LIMIT.limit, period: RATE_LIMIT.period },
})

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  {}
) {}

export class RateLimitUnavailable extends Schema.TaggedError<RateLimitUnavailable>()(
  "RateLimitUnavailable",
  {}
) {}

// Cloudflare sets CF-Connecting-IP to the caller's address and overwrites any value the caller sends.
const clientKey = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? "unknown-client"

export const rateLimit = Effect.fn("rateLimit")(function* rateLimit(
  limiter: Cloudflare.RateLimitClient
) {
  const request = yield* HttpServerRequest.HttpServerRequest
  const { success } = yield* limiter
    .limit({ key: clientKey(request) })
    .pipe(
      Effect.catchTag("RateLimitError", () =>
        Effect.fail(new RateLimitUnavailable())
      )
    )
  if (!success) {
    yield* new RateLimited()
  }
})
