// Meeting slots are defined in Montreal wall-clock time and shown in the visitor's chosen zone.
export const HOST_TIME_ZONE = "America/Toronto"
const HOST_SLOTS = ["13:30", "15:30", "16:30"]

export const TIME_ZONES = [
  { value: "America/Toronto", label: "Montreal, Canada" },
  { value: "America/Vancouver", label: "Vancouver, Canada" },
  { value: "America/New_York", label: "New York, USA" },
  { value: "America/Los_Angeles", label: "Los Angeles, USA" },
  { value: "Europe/London", label: "London, UK" },
  { value: "Europe/Paris", label: "Paris, France" },
  { value: "Asia/Tokyo", label: "Tokyo, Japan" },
]

export function timeZoneLabel(timeZone: string) {
  return TIME_ZONES.find((zone) => zone.value === timeZone)?.label ?? timeZone
}

// Offset of `timeZone` from UTC at `instant`, in milliseconds.
function zoneOffset(instant: number, timeZone: string) {
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
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return asUtc - Math.floor(instant / 1000) * 1000
}

// The UTC instant of a wall-clock time ("YYYY-MM-DD", "HH:mm") in `timeZone`.
function zonedInstant(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!)
  const first = guess - zoneOffset(guess, timeZone)
  return guess - zoneOffset(first, timeZone)
}

export type Slot = { instant: number; label: string }

export function slotsFor(date: string, timeZone: string): Slot[] {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  return HOST_SLOTS.map((time) => {
    const instant = zonedInstant(date, time, HOST_TIME_ZONE)
    return { instant, label: format.format(instant) }
  })
}
