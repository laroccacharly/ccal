import type { TokenResponse } from "@ccal/shared/google"
import { GoogleError, refreshAccessToken } from "@ccal/shared/google"
import type { Config, PlatformError } from "effect"
import { Effect, FileSystem, Option, Path, Schema } from "effect"

import { googleLoginPath } from "./paths"

// The Google login saved by `ccal login`. It holds secrets, so only its owner can read the file.
export class GoogleLogin extends Schema.Class<GoogleLogin>("GoogleLogin")({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_at: Schema.Number,
  email: Schema.optional(Schema.String),
}) {}

const GoogleLoginJson = Schema.fromJsonString(GoogleLogin, { space: 2 })

export const saveGoogleLogin: (
  login: GoogleLogin
) => Effect.Effect<
  void,
  Config.ConfigError | Schema.SchemaError | PlatformError.PlatformError,
  Path.Path | FileSystem.FileSystem
> = Effect.fn("saveGoogleLogin")(function* saveGoogleLogin(login: GoogleLogin) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const destination = yield* googleLoginPath()
  yield* fs.makeDirectory(path.dirname(destination), {
    recursive: true,
    mode: 0o700,
  })
  yield* fs.writeFileString(
    destination,
    yield* Schema.encodeEffect(GoogleLoginJson)(login),
    { mode: 0o600 }
  )
})

const expiresAt = (expiresIn: number) => Date.now() + expiresIn * 1000

export const googleLoginFromResponse = (
  body: typeof TokenResponse.Type,
  email?: string
) =>
  new GoogleLogin({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? "",
    expires_at: expiresAt(body.expires_in),
    email,
  })

/** The saved login, if there is one. */
export const readGoogleLogin = Effect.gen(function* readGoogleLogin() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* googleLoginPath()
  if (!(yield* fs.exists(path))) {
    return Option.none<GoogleLogin>()
  }
  return yield* Schema.decodeUnknownEffect(GoogleLoginJson)(
    yield* fs.readFileString(path)
  ).pipe(
    Effect.mapError(
      () =>
        new GoogleError({
          detail: "The saved login is invalid. Run `ccal login` again.",
        })
    ),
    Effect.map(Option.some)
  )
})

/** A valid access token, refreshed and saved again when it is about to expire. */
export const accessToken = Effect.gen(function* accessToken() {
  const saved = yield* readGoogleLogin
  if (Option.isNone(saved)) {
    return yield* new GoogleError({
      detail: "Not logged in. Run `ccal login` first.",
    })
  }
  const login = saved.value
  if (Date.now() < login.expires_at - 60_000) {
    return login.access_token
  }

  const body = yield* refreshAccessToken(login.refresh_token)
  yield* saveGoogleLogin(
    new GoogleLogin({
      refresh_token: login.refresh_token,
      email: login.email,
      access_token: body.access_token,
      expires_at: expiresAt(body.expires_in),
    })
  )
  return body.access_token
})
