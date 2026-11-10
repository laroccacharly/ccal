import { Config, Effect, Option, Path } from "effect"

// ~/.config/ccal (or $XDG_CONFIG_HOME/ccal): what ccal keeps on this machine: its Google login.
export const localDir: Effect.Effect<string, Config.ConfigError, Path.Path> =
  Effect.gen(function* localDir() {
    const path = yield* Path.Path
    const xdg = yield* Config.option(Config.String("XDG_CONFIG_HOME"))
    const base = Option.isSome(xdg)
      ? xdg.value
      : path.join(yield* Config.String("HOME"), ".config")
    return path.join(base, "ccal")
  })

export const googleLoginPath: Effect.Effect<
  string,
  Config.ConfigError,
  Path.Path
> = Effect.gen(function* googleLoginPath() {
  const path = yield* Path.Path
  return path.join(yield* localDir, "token.json")
})
