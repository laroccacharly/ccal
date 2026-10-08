import type { AvailableSlot, Slot } from "@ccal/shared"

export {
  HOST_TIME_ZONE,
  MEETING_MINUTES,
  TIME_ZONES,
  timeZoneLabel,
} from "@ccal/shared/availability"

// A bookable slot from the server (`startsAt`, an ISO datetime), labelled "HH:mm" in the visitor's chosen zone.
export type { Slot } from "@ccal/shared"

// The server gives each slot's time in every offered zone, so the UI never converts times itself.
export const slotsIn = (slots: AvailableSlot[], timeZone: string): Slot[] =>
  slots.map((slot) => ({
    startsAt: slot.startsAt,
    label: slot.times[timeZone] ?? "",
  }))
