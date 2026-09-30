// Google OAuth and Calendar calls shared by the CLI and the Worker. They only need an HttpClient: where the
// login is kept (a file for the CLI, secrets for the Worker) is up to each caller.
import { Config, Effect, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"]
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"

export class GoogleError extends Schema.TaggedError<GoogleError>()("GoogleError", {
  detail: Schema.String,
  status: Schema.optional(Schema.Number), // the HTTP status Google answered with, if it answered
}) {
  override get message(): string {
    return this.detail
  }
}

export const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
})

const Event = Schema.Struct({ id: Schema.String, hangoutLink: Schema.optional(Schema.String) })

// The OAuth client, a Google "Desktop app" client, comes from the environment.
export const clientCredentials = Effect.gen(function* clientCredentials() {
  return {
    id: yield* Config.String("GOOGLE_CLIENT_ID"),
    secret: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
  }
})

// GOOGLE_API_ORIGIN, when set, stands in for Google's servers: the end-to-end tests point the Worker at a fake.
const googleUrls = Effect.gen(function* googleUrls() {
  const origin = Option.getOrUndefined(yield* Config.option(Config.String("GOOGLE_API_ORIGIN")))
  return {
    token: origin ? `${origin}/token` : "https://oauth2.googleapis.com/token",
    events: `${origin ?? "https://www.googleapis.com"}/calendar/v3/calendars/primary/events`,
  }
})

// Sends `request` and decodes a successful response; on failure, keeps Google's explanation (e.g. "invalid_grant").
const send = <A>(what: string, schema: Schema.Codec<A, unknown>) =>
  Effect.fn(function* sendRequest(request: HttpClientRequest.HttpClientRequest) {
    const response = yield* (yield* HttpClient.HttpClient).execute(request)
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
      return yield* new GoogleError({
        detail: `${what} failed: ${response.status} ${body.slice(0, 500)}`.trim(),
        status: response.status,
      })
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response)
  }, Effect.mapError((cause) => (cause instanceof GoogleError ? cause : new GoogleError({ detail: `${what} failed: ${cause.message}` }))))

export const requestToken = Effect.fn("requestToken")(function* requestToken(params: Record<string, string>) {
  const { id, secret } = yield* clientCredentials
  const urls = yield* googleUrls
  return yield* HttpClientRequest.post(urls.token).pipe(
    HttpClientRequest.bodyUrlParams({ ...params, client_id: id, client_secret: Redacted.value(secret) }),
    send("Token request", TokenResponse),
  )
})

/** Trades a refresh token for a new, short-lived access token. */
export const refreshAccessToken = (refreshToken: string) =>
  requestToken({ grant_type: "refresh_token", refresh_token: refreshToken })

/**
 * Creates the event with a Meet link and has Google email the invite to the attendees. With an `id` (5 to 1024
 * characters from a-v and 0-9), creating the same event again returns the existing one instead of a duplicate.
 */
export const createMeeting = Effect.fn("createMeeting")(function* createMeeting(
  accessToken: string,
  event: {
    readonly id?: string
    readonly title: string
    readonly description?: string
    readonly start: Date
    readonly end: Date
    readonly emails: ReadonlyArray<string>
  },
) {
  const urls = yield* googleUrls
  const insert = HttpClientRequest.post(urls.events).pipe(
    HttpClientRequest.setUrlParams({
      conferenceDataVersion: "1", // required for Google to create the Meet link
      sendUpdates: "all", // Google emails the invite to every attendee
    }),
    HttpClientRequest.bearerToken(accessToken),
    HttpClientRequest.bodyJsonUnsafe({
      id: event.id,
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      attendees: event.emails.map((email) => ({ email })),
      conferenceData: {
        createRequest: { requestId: event.id ?? crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    }),
  )
  const existing = (id: string) =>
    HttpClientRequest.get(`${urls.events}/${id}`).pipe(HttpClientRequest.bearerToken(accessToken), send("Reading the event", Event))
  return yield* send("Creating the event", Event)(insert).pipe(
    // 409: an earlier attempt already created it, though its answer never made it back.
    Effect.catchIf(
      (error) => event.id !== undefined && error.status === 409,
      () => existing(event.id!),
    ),
  )
})
