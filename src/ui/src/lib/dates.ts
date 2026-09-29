export const MAX_MONTHS_AHEAD = 3

export function isoDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromIsoDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year!, month! - 1, day!)
}

// "October 1 2026"
export function formatSelectedDate(date: string) {
  const d = fromIsoDate(date)
  return `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()} ${d.getFullYear()}`
}

export function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
}

// Days that can be booked: from the day after tomorrow onward.
export function firstBookableDate(today = new Date()) {
  return isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2))
}
