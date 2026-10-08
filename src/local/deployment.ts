import { Config, ConfigProvider, Effect, Option } from "effect"

import { readGoogleLogin } from "./google-login"
import { readSettings } from "./settings"

// Alchemy props may only fail with a ConfigError.
const toConfigError = (error: { readonly message: string }) =>
  new Config.ConfigError(
    new ConfigProvider.SourceError({ message: error.message })
  )

// The host of the saved URL, where visitors load the app. None when no URL is saved.
const savedHostname = Effect.gen(function* savedHostname() {
  const { url } = yield* readSettings()
  return Option.fromNullishOr(url).pipe(
    Option.map((value) => new URL(value).hostname)
  )
})

/**
 * What the deployed Worker takes from this machine: CCAL_HOSTNAME from `ccal config --set-url`, and
 * GOOGLE_REFRESH_TOKEN from `ccal login`, which the Worker uses to create Meet invites. Only
 * alchemy.run.ts reads it, to plan and deploy; the environment still wins over it.
 */
export const deploymentConfig = ConfigProvider.layerAdd(
  Effect.gen(function* deploymentConfig() {
    const hostname = yield* savedHostname
    const login = yield* readGoogleLogin
    const config: Record<string, string> = {}
    if (Option.isSome(hostname)) {
      config.CCAL_HOSTNAME = hostname.value
    }
    if (Option.isSome(login) && login.value.refresh_token !== "") {
      config.GOOGLE_REFRESH_TOKEN = login.value.refresh_token
    }
    return ConfigProvider.fromUnknown(config)
  }).pipe(Effect.mapError(toConfigError))
)
