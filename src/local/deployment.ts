import { Config, ConfigProvider, Effect } from "effect"

import { readGoogleLogin } from "./google-login"
import { readSettings } from "./settings"

// Alchemy props may only fail with a ConfigError.
const toConfigError = (error: { readonly message: string }) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message: error.message }))

/**
 * The custom domain Alchemy attaches to the Worker: the host of the saved URL. None when no URL is
 * saved, or when it is a workers.dev address, which Cloudflare serves without a custom domain.
 */
const customDomain = Effect.gen(function* customDomain() {
  const { url } = yield* readSettings()
  if (url === undefined) return undefined
  const { hostname } = new URL(url)
  return hostname.endsWith(".workers.dev") ? undefined : hostname
})

/**
 * What the deployed Worker takes from this machine: CCAL_DOMAIN from `ccal config --set-url`, and
 * GOOGLE_REFRESH_TOKEN from `ccal login`, which the Worker uses to create Meet invites. Only
 * alchemy.run.ts reads it, to plan and deploy; the environment still wins over it.
 */
export const deploymentConfig = ConfigProvider.layerAdd(
  Effect.gen(function* deploymentConfig() {
    const domain = yield* customDomain
    const refreshToken = (yield* readGoogleLogin)?.refresh_token
    return ConfigProvider.fromUnknown({
      ...(domain ? { CCAL_DOMAIN: domain } : {}),
      ...(refreshToken ? { GOOGLE_REFRESH_TOKEN: refreshToken } : {}),
    })
  }).pipe(Effect.mapError(toConfigError)),
)
