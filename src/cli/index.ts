#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"

import { configCommand } from "./commands/config"
import { loginCommand } from "./commands/login"
import { meetCommand } from "./commands/meet"

const ccal = Command.make("ccal").pipe(
  Command.withDescription("Book meetings from the terminal"),
  Command.withSubcommands([loginCommand, meetCommand, configCommand])
)

BunRuntime.runMain(
  Command.run(ccal, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer))
  )
)
