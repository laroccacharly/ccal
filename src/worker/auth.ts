import { Effect, Option, Redacted, Schema } from "effect"
import { Headers, HttpServerRequest } from "effect/unstable/http"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

export const authorize = Effect.fn("authorize")(function* authorize(apiKey: Redacted.Redacted) {
  const request = yield* HttpServerRequest.HttpServerRequest
  const expected = `Bearer ${Redacted.value(apiKey)}`
  const header = Headers.get(request.headers, "authorization")
  if (Option.isNone(header) || header.value !== expected) {
    return yield* new Unauthorized()
  }
  return yield* Effect.void
})
