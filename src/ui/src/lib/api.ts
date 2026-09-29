import type { Contact } from "@/lib/validation"
import type { Booking } from "@/pages/booking-page"

const API_URL = import.meta.env.VITE_API_URL

export async function postBookingRequest(booking: Booking, contact: Contact) {
  if (!API_URL) throw new Error("VITE_API_URL is not set")
  const response = await fetch(`${API_URL}/api/booking-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: booking.date,
      time: booking.slot.label,
      timeZone: booking.timeZone,
      startsAt: new Date(booking.slot.instant).toISOString(),
      ...contact,
    }),
  })
  if (!response.ok) throw new Error(`Booking request failed (${response.status})`)
}
