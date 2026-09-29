import type { BookingRequest } from "@ccal/shared"
import { TIME_ZONES, availabilityAt, findSlot } from "@ccal/shared/availability"
import { Clock, Config, Effect, Layer, Redacted, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

import { insertBookingRequest, listBookingRequests } from "./bookings"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

export class SlotUnavailable extends Schema.TaggedError<SlotUnavailable>()("SlotUnavailable", {}) {}

const BookingRequestBody = Schema.Struct({
  startsAt: Schema.NonEmptyString,
  timeZone: Schema.String.check(Schema.makeFilter((zone) => TIME_ZONES.some((offered) => offered.value === zone))),
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
}) satisfies Schema.Codec<BookingRequest, unknown>

const BookingSearchParams = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
})

// The days and time slots the UI offers. The Worker decides what is bookable; the UI only displays it.
const availability = Effect.gen(function* availability() {
  return yield* HttpServerResponse.json(availabilityAt(yield* Clock.currentTimeMillis))
})

// Only a slot from the current availability can be booked; it is stored in its normalized ISO form.
const createBookingRequest = Effect.gen(function* createBookingRequest() {
  const body = yield* HttpServerRequest.schemaBodyJson(BookingRequestBody)
  const startsAt = findSlot(body.startsAt, yield* Clock.currentTimeMillis)
  if (startsAt === undefined) {
    return yield* new SlotUnavailable()
  }
  const booking = yield* insertBookingRequest({ ...body, startsAt })
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
  HttpRouter.add("GET", "/api/availability", availability),
  HttpRouter.add("POST", "/api/booking-requests", createBookingRequest),
  HttpRouter.add("GET", "/api/booking-requests", bookingRequests),
)
