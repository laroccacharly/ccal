import type { BookingRequest, Contact } from "@ccal/shared"

import type { Booking } from "@/pages/booking-page"

const API_URL = import.meta.env.VITE_API_URL

export async function postBookingRequest(booking: Booking, contact: Contact) {
  if (!API_URL) throw new Error("VITE_API_URL is not set")
  const response = await fetch(`${API_URL}/api/booking-requests`, {
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
