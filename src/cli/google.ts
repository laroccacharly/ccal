import { Config, Effect, FileSystem, Path, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { tokenPath } from "../config/paths"

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"]
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

export class GoogleError extends Schema.TaggedError<GoogleError>()("GoogleError", { detail: Schema.String }) {
  override get message(): string {
    return this.detail
  }
}

export class Token extends Schema.Class<Token>("Token")({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_at: Schema.Number,
  email: Schema.optional(Schema.String),
}) {}

const TokenJson = Schema.fromJsonString(Token, { space: 2 })

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
})

const CreatedEvent = Schema.Struct({ hangoutLink: Schema.optional(Schema.String) })

// The OAuth client, a Google "Desktop app" client, comes from the environment.
export const clientCredentials = Effect.gen(function* clientCredentials() {
  return {
    id: yield* Config.String("GOOGLE_CLIENT_ID"),
    secret: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
  }
})

export const requestToken = Effect.fn("requestToken")(function* requestToken(params: Record<string, string>) {
  const { id, secret } = yield* clientCredentials
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  return yield* HttpClientRequest.post(TOKEN_URL).pipe(
    HttpClientRequest.bodyUrlParams({ ...params, client_id: id, client_secret: Redacted.value(secret) }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
    Effect.mapError((cause) => new GoogleError({ detail: `Token request failed: ${cause.message}` })),
  )
})

export const saveToken = Effect.fn("saveToken")(function* saveToken(token: Token) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const destination = yield* tokenPath()
  yield* fs.makeDirectory(path.dirname(destination), { recursive: true, mode: 0o700 })
  yield* fs.writeFileString(destination, yield* Schema.encodeEffect(TokenJson)(token), { mode: 0o600 })
})

const expiresAt = (expiresIn: number) => Date.now() + expiresIn * 1000

export const tokenFromResponse = (body: typeof TokenResponse.Type, email?: string) =>
  new Token({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? "",
    expires_at: expiresAt(body.expires_in),
    email,
  })

/** A valid access token, refreshed and saved again when it is about to expire. */
const accessToken = Effect.gen(function* accessToken() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* tokenPath()
  if (!(yield* fs.exists(path))) return yield* new GoogleError({ detail: "Not logged in. Run `ccal login` first." })
  const token = yield* Schema.decodeUnknownEffect(TokenJson)(yield* fs.readFileString(path)).pipe(
    Effect.mapError(() => new GoogleError({ detail: "The saved login is invalid. Run `ccal login` again." })),
  )
  if (Date.now() < token.expires_at - 60_000) return token.access_token

  const body = yield* requestToken({ grant_type: "refresh_token", refresh_token: token.refresh_token })
  yield* saveToken(new Token({ ...token, access_token: body.access_token, expires_at: expiresAt(body.expires_in) }))
  return body.access_token
})

export const createMeeting = Effect.fn("createMeeting")(function* createMeeting(event: {
  readonly title: string
  readonly start: Date
  readonly end: Date
  readonly emails: ReadonlyArray<string>
}) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  return yield* HttpClientRequest.post(EVENTS_URL).pipe(
    HttpClientRequest.setUrlParams({
      conferenceDataVersion: "1", // required for Google to create the Meet link
      sendUpdates: "all", // Google emails the invite to every attendee
    }),
    HttpClientRequest.bearerToken(yield* accessToken),
    HttpClientRequest.bodyJsonUnsafe({
      summary: event.title,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      attendees: event.emails.map((email) => ({ email })),
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(CreatedEvent)),
    Effect.mapError((cause) => new GoogleError({ detail: `Creating the event failed: ${cause.message}` })),
  )
})
