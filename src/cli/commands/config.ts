import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/unstable/cli"

import { configPath } from "../../config/paths"
import { readConfig, setUrl } from "../../config/service"

export const configCommand = Command.make(
  "config",
  {
    setUrl: Flag.String("set-url").pipe(
      Flag.withDescription("Save the URL the ccal Worker is deployed to; `bun run deploy` attaches its host as a custom domain"),
      Flag.optional,
    ),
  },
  Effect.fn("configCommand")(function* configCommand({ setUrl: url }) {
    const config = Option.isSome(url) ? yield* setUrl(url.value) : yield* readConfig()
    yield* Console.log(`url: ${config.url ?? "(not set, use `ccal config --set-url=<url>`)"}`)
    yield* Console.error(`Stored in ${yield* configPath()}`)
  }),
).pipe(Command.withDescription("Print the local configuration, or change it"))
