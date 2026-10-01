// Calendar maths on "YYYY-MM-DD" dates, in UTC so the browser's own time zone never shifts a day. Which day it is
// comes from the server; months are 0-based, as in Date.

const pad = (n: number) => String(n).padStart(2, "0")

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day))

// "YYYY-MM-DD"; overflowing days and months roll over, e.g. month 12 is January of the next year.
export const isoDate = (year: number, month: number, day: number) =>
  utc(year, month, day).toISOString().slice(0, 10)

// The year and 0-based month of a "YYYY-MM-DD" date.
export const yearMonth = (date: string) => {
  const [year, month] = date.split("-").map(Number)
  return { year, month: month - 1 }
}

export const daysInMonth = (year: number, month: number) =>
  utc(year, month + 1, 0).getUTCDate()

// 0 for Sunday
export const firstWeekday = (year: number, month: number) =>
  utc(year, month, 1).getUTCDay()

// "October 1 2026"
export const formatSelectedDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  const monthName = utc(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  })
  return `${monthName} ${day} ${year}`
}

export const monthLabel = (year: number, month: number) =>
  utc(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

// "HH:mm" (24h) of a time `offsetMinutes` from UTC, at `instant` (milliseconds).
export const timeAtOffset = (instant: number, offsetMinutes: number) => {
  const shifted = new Date(instant + offsetMinutes * 60_000)
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}
