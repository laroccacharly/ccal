import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Redacted, Schema } from "effect"

const WorkerEnvBindings = Schema.Struct({
  CCAL_API_KEY: Schema.NonEmptyString,
})

const decodeWorkerEnvBindings = Schema.decodeUnknownEffect(WorkerEnvBindings)

export class InvalidCcalWorkerEnv extends Schema.TaggedError<InvalidCcalWorkerEnv>()("InvalidCcalWorkerEnv", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail
  }
}

export class CcalWorkerEnv extends Schema.Class<CcalWorkerEnv>("CcalWorkerEnv")({
  apiKey: Schema.Redacted(Schema.NonEmptyString),
}) {}

/** Decode ccal's runtime values from the Cloudflare Worker environment. */
export const loadWorkerEnv = Effect.fn("loadWorkerEnv")(function* loadWorkerEnv() {
  const environment = yield* Cloudflare.WorkerEnvironment
  const bindings = yield* decodeWorkerEnvBindings(environment).pipe(
    Effect.mapError(
      (error) => new InvalidCcalWorkerEnv({ detail: `Invalid Cloudflare Worker bindings: ${String(error)}` }),
    ),
  )
  return new CcalWorkerEnv({ apiKey: Redacted.make(bindings.CCAL_API_KEY) })
})
