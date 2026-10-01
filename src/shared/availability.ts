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

// Creating a formatter is slow (a whole availability takes thousands of formats), so each is made once and reused.
const cached = <T>(make: (timeZone: string) => T) => {
  const made = new Map<string, T>()
  return (timeZone: string) => {
    const existing = made.get(timeZone)
    if (existing !== undefined) {
      return existing
    }
    const created = make(timeZone)
    made.set(timeZone, created)
    return created
  }
}

const dateTimeFormat = cached(
  (timeZone) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
)

const timeFormat = cached(
  (timeZone) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
)

const dateFormat = cached(
  (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone })
)

// Offset of `timeZone` from UTC at `instant`, in milliseconds.
const zoneOffset = (instant: number, timeZone: string) => {
  const parts = dateTimeFormat(timeZone).formatToParts(instant)
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

// "HH:mm" (24h) of `instant` in `timeZone`.
const timeIn = (instant: number, timeZone: string) =>
  timeFormat(timeZone).format(instant)

// A slot's start, with its time in every offered zone, so the UI never converts times itself.
const availableSlot = (instant: number) => ({
  startsAt: new Date(instant).toISOString(),
  times: Object.fromEntries(
    TIME_ZONES.map((zone) => [zone.value, timeIn(instant, zone.value)])
  ),
})

// Today in the host's calendar at `now`, and every bookable day with its slots' start instants.
const bookableDays = (now: number) => {
  const today = dateFormat(HOST_TIME_ZONE).format(now)
  const [year, month, day] = today.split("-").map(Number)
  const last = utcIsoDate(year, month + MAX_MONTHS_AHEAD, 0)
  const days: { date: string; instants: number[] }[] = []
  for (let offset = FIRST_BOOKABLE_DAY; ; offset += 1) {
    const date = utcIsoDate(year, month - 1, day + offset)
    if (date > last) {
      return { today, days }
    }
    days.push({
      date,
      instants: HOST_SLOTS.map((time) =>
        zonedInstant(date, time, HOST_TIME_ZONE)
      ),
    })
  }
}

// Every bookable day at `now`, in the host's calendar, with its slots, and the time the UI shows.
export const availabilityAt = (now: number): Availability => {
  const { today, days } = bookableDays(now)
  return {
    now: new Date(now).toISOString(),
    today,
    offsets: Object.fromEntries(
      TIME_ZONES.map((zone) => [
        zone.value,
        Math.round(zoneOffset(now, zone.value) / 60_000),
      ])
    ),
    days: days.map(({ date, instants }) => ({
      date,
      slots: instants.map(availableSlot),
    })),
  }
}

// The slot `startsAt` falls on, as a normalized ISO datetime, if it is bookable at `now`.
export const findSlot = (startsAt: string, now: number) => {
  const instant = Date.parse(startsAt)
  const found = bookableDays(now)
    .days.flatMap((day) => day.instants)
    .find((slotInstant) => slotInstant === instant)
  return found === undefined ? undefined : new Date(found).toISOString()
}
