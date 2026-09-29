import { Effect, Layer } from "effect"
import type { HttpServerError } from "effect/unstable/http"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

import { authorize } from "./auth"
import { BookingRequestBody, BookingSearchParams } from "./booking-schema"
import { insertBookingRequest, listBookingRequests } from "./bookings"
import { loadWorkerEnv } from "./env"
import { InvalidRequest, jsonError } from "./http"

const createBookingRequest = Effect.fn("createBookingRequest")(function* createBookingRequest() {
  const body = yield* HttpServerRequest.schemaBodyJson(BookingRequestBody).pipe(
    Effect.mapError(() => new InvalidRequest()),
  )
  const booking = yield* insertBookingRequest(body)
  return yield* HttpServerResponse.json(booking, { status: 201 })
})

// Lists stored bookings (optionally by ?email=). Public POST is how the UI books; reading requires CCAL_API_KEY.
const bookingRequests = Effect.fn("bookingRequests")(function* bookingRequests() {
  const env = yield* loadWorkerEnv()
  yield* authorize(env.apiKey)
  const params = yield* HttpServerRequest.schemaSearchParams(BookingSearchParams).pipe(
    Effect.mapError(() => new InvalidRequest()),
  )
  const bookings = yield* listBookingRequests(params.email)
  return yield* HttpServerResponse.json(bookings)
})

export const workerRoutes = Layer.mergeAll(
  HttpRouter.add("POST", "/api/booking-requests", createBookingRequest()),
  HttpRouter.add("GET", "/api/booking-requests", bookingRequests()),
)

export const notFound = (error: HttpServerError.HttpServerError) => {
  switch (error.reason._tag) {
    case "RouteNotFound": {
      return Effect.succeed(jsonError("not_found", 404))
    }
    case "RequestParseError": {
      return Effect.succeed(jsonError("invalid_request", 400))
    }
    case "InternalError": {
      return Effect.fail(error)
    }
    case "ResponseError": {
      return Effect.fail(error)
    }
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}
