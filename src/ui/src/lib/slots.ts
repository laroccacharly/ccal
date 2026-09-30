export {
  HOST_TIME_ZONE,
  MEETING_MINUTES,
  TIME_ZONES,
  timeZoneLabel,
} from "@ccal/shared/availability"

// A bookable slot from the server (`startsAt`, an ISO datetime), labelled "HH:mm" in the visitor's chosen zone.
export interface Slot {
  startsAt: string
  label: string
}

export const slotsIn = (startsAts: string[], timeZone: string): Slot[] => {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  return startsAts.map((startsAt) => ({
    startsAt,
    label: format.format(new Date(startsAt)),
  }))
}
