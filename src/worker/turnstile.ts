import { Config, Effect, Redacted, Schema } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServerRequest,
} from "effect/unstable/http"

export const TurnstileToken = Schema.NonEmptyString.check(
  Schema.isMaxLength(2048)
)

export class TurnstileRejected extends Schema.TaggedError<TurnstileRejected>()(
  "TurnstileRejected",
  {}
) {}
export class TurnstileUnavailable extends Schema.TaggedError<TurnstileUnavailable>()(
  "TurnstileUnavailable",
  {}
) {}

const Verification = Schema.Struct({
  success: Schema.Boolean,
  "error-codes": Schema.optionalKey(Schema.Array(Schema.String)),
  hostname: Schema.optionalKey(Schema.String),
  action: Schema.optionalKey(Schema.String),
})

export const verifyTurnstile = Effect.fn("verifyTurnstile")(
  function* verifyTurnstile(token: string | undefined) {
    if (token === undefined) {
      return yield* new TurnstileRejected()
    }
    const secret = Redacted.value(
      yield* Config.Redacted("TURNSTILE_SECRET_KEY")
    )
    const hostname = yield* Config.String("CCAL_HOSTNAME")
    const origin = yield* Config.String("TURNSTILE_API_ORIGIN").pipe(
      Config.withDefault("https://challenges.cloudflare.com")
    )
    const request = yield* HttpServerRequest.HttpServerRequest
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const verified = yield* HttpClientRequest.post(
      `${origin}/turnstile/v0/siteverify`
    ).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        secret,
        response: token,
        remoteip: request.headers["cf-connecting-ip"],
      }),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Verification)),
      Effect.timeout("10 seconds"),
      // Only the message: the error carries the request, whose body holds the secret.
      Effect.tapError((cause) =>
        Effect.logError("Turnstile verification unavailable", cause.message)
      ),
      Effect.mapError(() => new TurnstileUnavailable())
    )
    const errorCodes = verified["error-codes"] ?? []
    // Cloudflare failed to check the token, which says nothing about the visitor.
    if (errorCodes.includes("internal-error")) {
      yield* Effect.logError("Turnstile verification unavailable", errorCodes)
      return yield* new TurnstileUnavailable()
    }
    if (
      !verified.success ||
      verified.hostname !== hostname ||
      verified.action !== "booking"
    ) {
      yield* Effect.logWarning("Turnstile verification rejected", {
        errorCodes,
        hostname: verified.hostname,
        action: verified.action,
      })
      return yield* new TurnstileRejected()
    }
    return yield* Effect.void
  }
)
