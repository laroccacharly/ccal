import { Config, Effect, Option, Path } from "effect"

// ~/.config/ccal (or $XDG_CONFIG_HOME/ccal): the CLI's login token and its settings.
export const configDir = Effect.fn("configDir")(function* configDir() {
  const path = yield* Path.Path
  const xdg = yield* Config.option(Config.String("XDG_CONFIG_HOME"))
  const base = Option.isSome(xdg) ? xdg.value : path.join(yield* Config.String("HOME"), ".config")
  return path.join(base, "ccal")
})

export const configPath = Effect.fn("configPath")(function* configPath() {
  const path = yield* Path.Path
  return path.join(yield* configDir(), "config.json")
})

export const tokenPath = Effect.fn("tokenPath")(function* tokenPath() {
  const path = yield* Path.Path
  return path.join(yield* configDir(), "token.json")
})
