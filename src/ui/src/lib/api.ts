import type { Availability, BookingRequest, Contact } from "@ccal/shared"

import type { Booking } from "@/pages/booking-page"

// The API is served by the same Worker as the UI, so requests are same-origin.

// The days and slots that can be booked; the server decides, the UI only displays them.
export async function getAvailability() {
  const response = await fetch("/api/availability")
  if (!response.ok) throw new Error(`Loading availability failed (${response.status})`)
  return (await response.json()) as Availability
}

export async function postBookingRequest(booking: Booking, contact: Contact) {
  const response = await fetch("/api/booking-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startsAt: booking.slot.startsAt,
      timeZone: booking.timeZone,
      ...contact,
    } satisfies BookingRequest),
  })
  if (!response.ok) throw new Error(`Booking request failed (${response.status})`)
}
