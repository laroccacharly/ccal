import { Config, ConfigProvider, Effect, Option } from "effect"

import { readGoogleLogin } from "./google-login"

// Alchemy props may only fail with a ConfigError.
const toConfigError = (error: { readonly message: string }) =>
  new Config.ConfigError(
    new ConfigProvider.SourceError({ message: error.message })
  )

// The host of CCAL_URL, which `bun run deploy` passes, where visitors load the app. None when it is unset.
const urlHostname = Effect.gen(function* urlHostname() {
  const url = yield* Config.option(Config.URL("CCAL_URL"))
  return url.pipe(Option.map(({ hostname }) => hostname))
})

/**
 * What the deployed Worker takes from this machine: CCAL_HOSTNAME from CCAL_URL, and
 * GOOGLE_REFRESH_TOKEN from `ccal login`, which the Worker uses to create Meet invites. Only
 * alchemy.run.ts reads it, to plan and deploy; the environment still wins over it.
 */
export const deploymentConfig = ConfigProvider.layerAdd(
  Effect.gen(function* deploymentConfig() {
    const hostname = yield* urlHostname
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
