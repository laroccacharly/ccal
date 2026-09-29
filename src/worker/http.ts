import { Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {}) {}

export const jsonError = (error: string, status: number) => HttpServerResponse.jsonUnsafe({ error }, { status })

export const toException = (error: unknown): Error => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return new Error(String(error.message), { cause: error })
  }
  return new Error(String(error), { cause: error })
}
