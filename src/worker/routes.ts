import type { BookingRequest } from "@ccal/shared"
import { Config, Effect, Layer, Redacted, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

import { insertBookingRequest, listBookingRequests } from "./bookings"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

const BookingRequestBody = Schema.Struct({
  startsAt: Schema.NonEmptyString,
  timeZone: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
}) satisfies Schema.Codec<BookingRequest, unknown>

const BookingSearchParams = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
})

const createBookingRequest = Effect.gen(function* createBookingRequest() {
  const body = yield* HttpServerRequest.schemaBodyJson(BookingRequestBody)
  const booking = yield* insertBookingRequest(body)
  return yield* HttpServerResponse.json(booking, { status: 201 })
})

// Lists stored bookings (optionally by ?email=). Public POST is how the UI books; reading requires CCAL_API_KEY.
const bookingRequests = Effect.gen(function* bookingRequests() {
  const apiKey = yield* Config.Redacted("CCAL_API_KEY")
  const request = yield* HttpServerRequest.HttpServerRequest
  if (request.headers.authorization !== `Bearer ${Redacted.value(apiKey)}`) {
    return yield* new Unauthorized()
  }
  const params = yield* HttpServerRequest.schemaSearchParams(BookingSearchParams)
  const bookings = yield* listBookingRequests(params.email)
  return yield* HttpServerResponse.json(bookings)
})

export const routes = Layer.mergeAll(
  HttpRouter.add("POST", "/api/booking-requests", createBookingRequest),
  HttpRouter.add("GET", "/api/booking-requests", bookingRequests),
)
