import type { BookingRequest, Contact } from "@ccal/shared"

import type { Booking } from "@/pages/booking-page"

// The API is served by the same Worker as the UI, so requests are same-origin.
export async function postBookingRequest(booking: Booking, contact: Contact) {
  const response = await fetch("/api/booking-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startsAt: new Date(booking.slot.instant).toISOString(),
      timeZone: booking.timeZone,
      ...contact,
    } satisfies BookingRequest),
  })
  if (!response.ok) throw new Error(`Booking request failed (${response.status})`)
}
