import { Config, ConfigProvider, Effect, FileSystem, Path, Schema } from "effect"

import { configPath } from "./paths"

export class LocalConfig extends Schema.Class<LocalConfig>("LocalConfig")({
  // Origin of the deployed Worker, e.g. https://cal.example.com.
  url: Schema.optional(Schema.NonEmptyString),
}) {}

const ConfigJson = Schema.fromJsonString(LocalConfig, { space: 2 })

export class InvalidConfigFile extends Schema.TaggedError<InvalidConfigFile>()("InvalidConfigFile", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Invalid ccal configuration in ${this.path}.`
  }
}

export class InvalidUrl extends Schema.TaggedError<InvalidUrl>()("InvalidUrl", { value: Schema.String }) {
  override get message(): string {
    return `Invalid URL ${JSON.stringify(this.value)}. Use an http(s) URL, e.g. https://cal.example.com.`
  }
}

export const readConfig = Effect.fn("readConfig")(function* readConfig() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* configPath()
  if (!(yield* fs.exists(path))) return new LocalConfig({})
  return yield* Schema.decodeUnknownEffect(ConfigJson)(yield* fs.readFileString(path)).pipe(
    Effect.mapError(() => new InvalidConfigFile({ path })),
  )
})

const writeConfig = Effect.fn("writeConfig")(function* writeConfig(config: LocalConfig) {
  const fs = yield* FileSystem.FileSystem
  const paths = yield* Path.Path
  const destination = yield* configPath()
  yield* fs.makeDirectory(paths.dirname(destination), { recursive: true })
  yield* fs.writeFileString(destination, `${yield* Schema.encodeEffect(ConfigJson)(config)}\n`)
  return config
})

/** Saves the Worker URL, keeping only its origin (scheme, host and port). */
export const setUrl = Effect.fn("setUrl")(function* setUrl(value: string) {
  const url = yield* Effect.try({ try: () => new URL(value), catch: () => new InvalidUrl({ value }) })
  if (url.protocol !== "https:" && url.protocol !== "http:") return yield* new InvalidUrl({ value })
  return yield* writeConfig(new LocalConfig({ ...(yield* readConfig()), url: url.origin }))
})

/**
 * The custom domain Alchemy attaches to the Worker: the host of the saved URL. None when no URL is
 * saved, or when it is a workers.dev address, which Cloudflare serves without a custom domain.
 */
export const deploymentDomain = Effect.fn("deploymentDomain")(function* deploymentDomain() {
  // Alchemy props may only fail with a ConfigError.
  const { url } = yield* readConfig().pipe(
    Effect.mapError(
      (error) => new Config.ConfigError(new ConfigProvider.SourceError({ message: error.message })),
    ),
  )
  if (url === undefined) return undefined
  const { hostname } = new URL(url)
  return hostname.endsWith(".workers.dev") ? undefined : hostname
})
