import type { BookingRequest } from "@ccal/shared"
import { Schema } from "effect"

export const BookingRequestBody = Schema.Struct({
  startsAt: Schema.NonEmptyString,
  timeZone: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
}) satisfies Schema.Codec<BookingRequest, unknown>

export const BookingSearchParams = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
})
