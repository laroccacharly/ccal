const pad = (n: number) => String(n).padStart(2, "0")

export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const fromIsoDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day)
}

// "October 1 2026"
export const formatSelectedDate = (date: string) => {
  const d = fromIsoDate(date)
  return `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()} ${d.getFullYear()}`
}

export const monthLabel = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  })
