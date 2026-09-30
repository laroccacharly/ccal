import type { Availability } from "./types"

// Meeting slots are defined in Montreal wall-clock time and shown in the visitor's chosen zone.
export const HOST_TIME_ZONE = "America/Toronto"
const HOST_SLOTS = ["13:30", "15:30", "16:30"]
export const MEETING_MINUTES = 30

// Days can be booked from the day after tomorrow through the end of the month 3 months from now.
const FIRST_BOOKABLE_DAY = 2
const MAX_MONTHS_AHEAD = 3

export const TIME_ZONES = [
  { value: "America/Toronto", label: "Montreal, Canada" },
  { value: "America/Vancouver", label: "Vancouver, Canada" },
  { value: "America/New_York", label: "New York, USA" },
  { value: "America/Los_Angeles", label: "Los Angeles, USA" },
  { value: "Europe/London", label: "London, UK" },
  { value: "Europe/Paris", label: "Paris, France" },
  { value: "Asia/Tokyo", label: "Tokyo, Japan" },
]

export const timeZoneLabel = (timeZone: string) =>
  TIME_ZONES.find((zone) => zone.value === timeZone)?.label ?? timeZone

// Offset of `timeZone` from UTC at `instant`, in milliseconds.
const zoneOffset = (instant: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

// The UTC instant of a wall-clock time ("YYYY-MM-DD", "HH:mm") in `timeZone`.
const zonedInstant = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - zoneOffset(guess, timeZone)
  return guess - zoneOffset(first, timeZone)
}

// "YYYY-MM-DD" of a UTC date built from calendar fields; Date.UTC normalizes overflowing days and months.
const utcIsoDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)

// Every bookable day at `now`, in the host's calendar, with its slots as ISO datetimes.
export const availabilityAt = (now: number): Availability => {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOST_TIME_ZONE,
  })
    .format(now)
    .split("-")
    .map(Number)
  const last = utcIsoDate(year, month + MAX_MONTHS_AHEAD, 0)
  const days: Availability["days"] = []
  for (let offset = FIRST_BOOKABLE_DAY; ; offset += 1) {
    const date = utcIsoDate(year, month - 1, day + offset)
    if (date > last) {
      return { days }
    }
    days.push({
      date,
      slots: HOST_SLOTS.map((time) =>
        new Date(zonedInstant(date, time, HOST_TIME_ZONE)).toISOString()
      ),
    })
  }
}

// The slot `startsAt` falls on, as a normalized ISO datetime, if it is bookable at `now`.
export const findSlot = (startsAt: string, now: number) => {
  const instant = Date.parse(startsAt)
  return availabilityAt(now)
    .days.flatMap((day) => day.slots)
    .find((slot) => Date.parse(slot) === instant)
}
