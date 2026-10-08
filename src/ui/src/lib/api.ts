import type { BookingRequest, Contact, Booking } from "@ccal/shared"

// The API is served by the same Worker as the UI, so requests are same-origin.

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
