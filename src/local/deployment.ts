import { Config, ConfigProvider, Effect, Option } from "effect"

import { readGoogleLogin } from "./google-login"
import { readSettings } from "./settings"

// Alchemy props may only fail with a ConfigError.
const toConfigError = (error: { readonly message: string }) =>
  new Config.ConfigError(
    new ConfigProvider.SourceError({ message: error.message })
  )

/**
 * The custom domain Alchemy attaches to the Worker: the host of the saved URL. None when no URL is
 * saved, or when it is a workers.dev address, which Cloudflare serves without a custom domain.
 */
const customDomain = Effect.gen(function* customDomain() {
  const { url } = yield* readSettings()
  const hostname = url === undefined ? undefined : new URL(url).hostname
  return hostname === undefined || hostname.endsWith(".workers.dev")
    ? undefined
    : hostname
})

/**
 * What the deployed Worker takes from this machine: CCAL_DOMAIN from `ccal config --set-url`, and
 * GOOGLE_REFRESH_TOKEN from `ccal login`, which the Worker uses to create Meet invites. Only
 * alchemy.run.ts reads it, to plan and deploy; the environment still wins over it.
 */
export const deploymentConfig = ConfigProvider.layerAdd(
  Effect.gen(function* deploymentConfig() {
    const domain = yield* customDomain
    const login = yield* readGoogleLogin
    const config: Record<string, string> = {}
    if (domain !== undefined) {
      config.CCAL_DOMAIN = domain
    }
    if (Option.isSome(login) && login.value.refresh_token !== "") {
      config.GOOGLE_REFRESH_TOKEN = login.value.refresh_token
    }
    return ConfigProvider.fromUnknown(config)
  }).pipe(Effect.mapError(toConfigError))
)
