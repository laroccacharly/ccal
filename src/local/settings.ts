import { Effect, FileSystem, Path, Schema } from "effect"

import { settingsPath } from "./paths"

// The settings changed with `ccal config`. They hold no secrets; the Google login is kept apart (google-login.ts).
export class Settings extends Schema.Class<Settings>("Settings")({
  // Origin of the deployed Worker, e.g. https://cal.example.com.
  url: Schema.optional(Schema.NonEmptyString),
}) {}

const SettingsJson = Schema.fromJsonString(Settings, { space: 2 })

export class InvalidSettingsFile extends Schema.TaggedError<InvalidSettingsFile>()("InvalidSettingsFile", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Invalid ccal settings in ${this.path}.`
  }
}

export class InvalidUrl extends Schema.TaggedError<InvalidUrl>()("InvalidUrl", { value: Schema.String }) {
  override get message(): string {
    return `Invalid URL ${JSON.stringify(this.value)}. Use an http(s) URL, e.g. https://cal.example.com.`
  }
}

export const readSettings = Effect.fn("readSettings")(function* readSettings() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* settingsPath()
  if (!(yield* fs.exists(path))) return new Settings({})
  return yield* Schema.decodeUnknownEffect(SettingsJson)(yield* fs.readFileString(path)).pipe(
    Effect.mapError(() => new InvalidSettingsFile({ path })),
  )
})

const writeSettings = Effect.fn("writeSettings")(function* writeSettings(settings: Settings) {
  const fs = yield* FileSystem.FileSystem
  const paths = yield* Path.Path
  const destination = yield* settingsPath()
  yield* fs.makeDirectory(paths.dirname(destination), { recursive: true })
  yield* fs.writeFileString(destination, `${yield* Schema.encodeEffect(SettingsJson)(settings)}\n`)
  return settings
})

/** Saves the Worker URL, keeping only its origin (scheme, host and port). */
export const setUrl = Effect.fn("setUrl")(function* setUrl(value: string) {
  const url = yield* Effect.try({ try: () => new URL(value), catch: () => new InvalidUrl({ value }) })
  if (url.protocol !== "https:" && url.protocol !== "http:") return yield* new InvalidUrl({ value })
  return yield* writeSettings(new Settings({ ...(yield* readSettings()), url: url.origin }))
})
