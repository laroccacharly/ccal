import type { Availability, BookingRequest, Contact } from "@ccal/shared"

import type { Booking } from "@/pages/booking-page"

// The API is served by the same Worker as the UI, so requests are same-origin.

// The days and slots that can be booked; the server decides, the UI only displays them.
export const getAvailability = async () => {
  const response = await fetch("/api/availability")
  if (!response.ok) {
    throw new Error(`Loading availability failed (${response.status})`)
  }
  const body: unknown = await response.json()
  // SAFETY: the Worker serves this route from the same shared Availability type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return body as Availability
}

export const postBookingRequest = async (
  booking: Booking,
  contact: Contact,
  turnstileToken: string
) => {
  const response = await fetch("/api/booking-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startsAt: booking.slot.startsAt,
      timeZone: booking.timeZone,
      ...contact,
      turnstileToken,
    } satisfies BookingRequest & { turnstileToken: string }),
  })
  if (!response.ok) {
    throw new Error(`Booking request failed (${response.status})`)
  }
}
