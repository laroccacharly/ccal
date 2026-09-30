// Implements the scenarios in cal.test.md.
//
// There is no booking page yet, so this file defines the contract it must meet:
//   data-testid="month-label"      text like "September 2026"
//   data-testid="prev-month"       previous month arrow
//   data-testid="next-month"       next month arrow
//   data-testid="day"              one <button> per day, with data-date="YYYY-MM-DD";
//                                  "greyed out" means the button is disabled
//   data-testid="selected-date"    shows the currently selected date
//   data-testid="no-available-days" banner shown when every day in the displayed month is disabled
//   data-testid="availability-error" banner shown when the available days cannot be loaded
//   data-testid="timezone-select"  <select> whose option values are IANA zones
//   data-testid="current-time"     text "Current time: HH:mm" (24h) in the selected zone
//   data-testid="time-slot"        one <button> per time slot, text "HH:mm" (24h)
//   data-testid="confirm-button"   the "ok" button
//   data-testid="confirmation-page" root of the confirmation page
//   data-testid="summary"          the booking summary: date, time and time zone
//   data-testid="meeting-link-message" note that an email with the Meet link follows shortly after confirming
//   labels "Name", "Email", "Description" the contact form fields
//   data-testid="name-error" / "email-error" / "description-error" validation messages
//   data-testid="submit-button"    the confirmation page's "Confirm" button
//   role="alertdialog"             the confirm dialog, with "OK" and "Cancel" buttons
//   data-testid="success-page"     root of the success page
//   data-testid="success-meeting-link-message" note to check the inbox for the Meet link
//
// The UI loads the bookable days and slots from GET /api/availability on the same origin, and only offers those.
// Clicking "OK" POSTs the booking to /api/booking-requests on the same origin as the UI.
// GET /api/booking-requests?email= reads back what was stored; it requires "Authorization: Bearer $CCAL_API_KEY".
// GET /api/booking-requests also returns each booking's Google Meet (`meeting`), which the Worker creates in the background.
// The Worker reaches "Google" at GOOGLE_API_ORIGIN, a stub (google-stub.ts) whose /stub/* routes list the events it
// created and make it fail for an attendee. POST /api/meetings/retry (with the API key) retries unfinished meetings now.
// The API allows each client 10 requests every 60 seconds, keyed on CF-Connecting-IP. Locally the Worker trusts that header,
// so each test sends its own to act as a separate client.

import type {
  Availability,
  BookingRequest,
  Contact,
  Meeting,
} from "@ccal/shared"
import { test, expect } from "@playwright/test"
import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
  Route,
  TestInfo,
} from "@playwright/test"

import type { StubEvent } from "./google-stub"

const API_KEY = process.env.CCAL_API_KEY ?? ""

// IANA has no Montreal zone; it uses Toronto's
const MONTREAL = "America/Toronto"
const PARIS = "Europe/Paris"
const VANCOUVER = "America/Vancouver"

const pad = (n: number) => String(n).padStart(2, "0")

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const monthLabel = (date: Date) =>
  date.toLocaleString("en-US", { month: "long", year: "numeric" })

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// Offset of `timeZone` from UTC at `at`, in minutes.
const utcOffsetMinutes = (at: Date, timeZone: string) => {
  // e.g. "GMT-07:00"
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  const groups = /GMT(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2})/u.exec(
    name
  )?.groups
  if (groups === undefined) {
    return 0
  }
  const minutes = Number(groups.hours) * 60 + Number(groups.minutes)
  return groups.sign === "-" ? -minutes : minutes
}

// Minutes to add to a Vancouver wall-clock time to get the Paris one, on the given day.
const parisMinusVancouverMinutes = (day: string) => {
  const at = new Date(`${day}T12:00:00Z`)
  return utcOffsetMinutes(at, PARIS) - utcOffsetMinutes(at, VANCOUVER)
}

// Date ("YYYY-MM-DD") and 24h time ("HH:mm") of an ISO datetime, as seen in `timeZone`.
const inZone = (iso: string, timeZone: string) => {
  const at = new Date(iso)
  return {
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at),
  }
}

const toMinutes = (time: string) => {
  const [hours, minutes] = time.trim().split(":").map(Number)
  return hours * 60 + minutes
}

// Current wall-clock time in `timeZone`, in minutes since midnight.
const nowInZoneMinutes = (timeZone: string) => {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date())
  return toMinutes(time)
}

// Distance between two times of day in minutes, wrapping around midnight.
const minutesApart = (a: number, b: number) => {
  const diff = Math.abs(a - b) % (24 * 60)
  return Math.min(diff, 24 * 60 - diff)
}

// "October 1 2026", from "2026-10-01"
const formatSelectedDate = (date: string) => {
  const [year, month, dayOfMonth] = date.split("-").map(Number)
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
  })
  return `${monthName} ${dayOfMonth} ${year}`
}

// The JSON body of an API response, typed as the shape the API under test promises.
const readJson = async <T>(response: APIResponse): Promise<T> => {
  const body: unknown = await response.json()
  // SAFETY: the tests below assert on every field they read, so a wrong shape fails the test.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return body as T
}

const monthLabelEl = (page: Page) => page.getByTestId("month-label")
const days = (page: Page) => page.getByTestId("day")
const day = (page: Page, date: string) =>
  page.locator(`[data-testid="day"][data-date="${date}"]`)
const enabledDays = (page: Page) =>
  page.locator('[data-testid="day"]:not([disabled])')
const selectedDate = (page: Page) => page.getByTestId("selected-date")
const noAvailableDays = (page: Page) => page.getByTestId("no-available-days")
const timeSlots = (page: Page) => page.getByTestId("time-slot")
const timezoneSelect = (page: Page) => page.getByTestId("timezone-select")
const confirmButton = (page: Page) => page.getByTestId("confirm-button")
const currentTime = (page: Page) => page.getByTestId("current-time")

const boundingBox = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error("The element is not visible")
  }
  return box
}

const expectCurrentTimeIn = async (page: Page, timeZone: string) => {
  await expect(currentTime(page)).toHaveText(/^Current time: \d{2}:\d{2}$/u)
  const text = (await currentTime(page).textContent()) ?? ""
  const shown = toMinutes(text.replace("Current time:", ""))
  expect(minutesApart(shown, nowInZoneMinutes(timeZone))).toBeLessThanOrEqual(1)
}

// Selects the first available date, moving to the next month if the current one has none left.
const selectFirstAvailableDate = async (page: Page) => {
  if ((await enabledDays(page).count()) === 0) {
    await page.getByTestId("next-month").click()
  }
  const first = enabledDays(page).first()
  const date = (await first.getAttribute("data-date")) ?? ""
  await first.click()
  return date
}

// Books the first available slot in `timeZone` and returns what was selected.
const goToConfirmation = async (page: Page, timeZone = MONTREAL) => {
  const date = await selectFirstAvailableDate(page)
  await timezoneSelect(page).selectOption(timeZone)
  const slot = timeSlots(page).first()
  const time = (await slot.textContent()) ?? ""
  await slot.click()
  await confirmButton(page).click()
  await expect(page.getByTestId("confirmation-page")).toBeVisible()
  return { isoDate: date, date: formatSelectedDate(date), time, timeZone }
}

const contact: Contact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  description: "Talk about the Analytical Engine",
}

const fillContact = async (page: Page, values: Partial<Contact> = {}) => {
  const { name, email, description } = { ...contact, ...values }
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Description").fill(description)
}

const submitButton = (page: Page) => page.getByTestId("submit-button")
const confirmDialog = (page: Page) => page.getByRole("alertdialog")

const slotTimes = async (page: Page) => {
  const texts = await timeSlots(page).allTextContents()
  return texts.map(toMinutes)
}

// Serves `offered` as the availability, as if the server offered exactly those days.
const serveAvailability = async (page: Page, offered: Availability["days"]) => {
  await page.route("**/api/availability", async (route) => {
    await route.fulfill({ json: { days: offered } satisfies Availability })
  })
}

// Every day from `first` through `last` ("YYYY-MM-DD"), each with one slot.
const everyDay = (first: string, last: string): Availability["days"] => {
  const result: Availability["days"] = []
  for (
    let date = first;
    date <= last;
    date = isoDate(addDays(new Date(`${date}T00:00:00`), 1))
  ) {
    result.push({ date, slots: [`${date}T17:30:00.000Z`] })
  }
  return result
}

const DAY = 24 * 60 * 60 * 1000

const RATE_LIMIT = 10

// A client id no other test or earlier run has used.
const newClient = (testInfo: TestInfo) =>
  `e2e-${testInfo.testId}-${crypto.randomUUID()}`

test.use({
  // Playwright requires the fixtures argument to be destructured, even when unused.
  // oxlint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    await provide({ "CF-Connecting-IP": newClient(testInfo) })
  },
})

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("load")
})

test.describe("Page load", () => {
  test("shows the meeting type", async ({ page }) => {
    await expect(page.locator("body")).toContainText("Google Meet")
  })

  test("uses a hash router on the form route", async ({ page }) => {
    await expect(page).toHaveURL(/#/u)
    await expect(page).toHaveURL(/form/u)
  })
})

test.describe("Date select", () => {
  test("shows the current month and year", async ({ page }) => {
    await expect(monthLabelEl(page)).toHaveText(monthLabel(new Date()))
  })

  test("greys out past days, today and tomorrow", async ({ page }) => {
    const tomorrow = isoDate(addDays(new Date(), 1))
    await expect(days(page).first()).toBeVisible()
    const dates = await days(page).evaluateAll((els) =>
      els.map((el) => el.dataset.date ?? "")
    )
    const unavailable = dates.filter((date) => date <= tomorrow)
    expect(unavailable.length).toBeGreaterThan(0)
    for (const date of unavailable) {
      await expect(day(page, date)).toBeDisabled()
    }
  })

  test("clicking a greyed-out date does not change the selected date", async ({
    page,
  }) => {
    const before = await selectedDate(page).textContent()
    await day(page, isoDate(new Date())).click({ force: true })
    await expect(selectedDate(page)).toHaveText(before ?? "")
  })

  test("clicking an available date changes the selected date", async ({
    page,
  }) => {
    const before = await selectedDate(page).textContent()
    await selectFirstAvailableDate(page)
    await expect(selectedDate(page)).not.toHaveText(before ?? "")
  })

  test("next month arrow shows the next month", async ({ page }) => {
    const now = new Date()
    await page.getByTestId("next-month").click()
    await expect(monthLabelEl(page)).toHaveText(
      monthLabel(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    )
  })

  test("selecting a date in the next month updates the selected date", async ({
    page,
  }) => {
    await page.getByTestId("next-month").click()
    const before = await selectedDate(page).textContent()
    await enabledDays(page).first().click()
    await expect(selectedDate(page)).not.toHaveText(before ?? "")
  })

  test('selected date has the format "Month Day Year"', async ({ page }) => {
    const date = await selectFirstAvailableDate(page)
    await expect(selectedDate(page)).toHaveText(formatSelectedDate(date))
  })

  test("next month arrow is disabled at 3 months out", async ({ page }) => {
    const next = page.getByTestId("next-month")
    for (let i = 0; i < 3; i += 1) {
      await expect(next).toBeEnabled()
      await next.click()
    }
    const now = new Date()
    await expect(monthLabelEl(page)).toHaveText(
      monthLabel(new Date(now.getFullYear(), now.getMonth() + 3, 1))
    )
    await expect(next).toBeDisabled()
  })

  test('shows a "No available days this month" banner when every day is disabled', async ({
    page,
  }) => {
    // The earliest bookable day is October 1, so every September day is disabled.
    await page.clock.install({ time: new Date("2026-09-29T10:00:00") })
    await serveAvailability(page, everyDay("2026-10-01", "2026-12-31"))
    await page.goto("/")
    await expect(monthLabelEl(page)).toHaveText("September 2026")
    await expect(enabledDays(page)).toHaveCount(0)
    await expect(noAvailableDays(page)).toHaveText(
      "No available days this month"
    )
    // The banner is laid over the calendar days: its center falls between the first and last day.
    const banner = await boundingBox(noAvailableDays(page))
    const firstDay = await boundingBox(days(page).first())
    const lastDay = await boundingBox(days(page).last())
    const bannerCenterY = banner.y + banner.height / 2
    expect(bannerCenterY).toBeGreaterThan(firstDay.y)
    expect(bannerCenterY).toBeLessThan(lastDay.y + lastDay.height)
  })

  test('hides the "No available days this month" banner when some days are available', async ({
    page,
  }) => {
    // The earliest bookable day is October 3, so October still has available days.
    await page.clock.install({ time: new Date("2026-10-01T10:00:00") })
    await serveAvailability(page, everyDay("2026-10-03", "2027-01-31"))
    await page.goto("/")
    await expect(monthLabelEl(page)).toHaveText("October 2026")
    await expect(enabledDays(page).first()).toBeVisible()
    await expect(noAvailableDays(page)).toBeHidden()
  })

  test("only offers the days the server says are available", async ({
    page,
  }) => {
    const now = new Date()
    // "YYYY-MM-"
    const month = isoDate(
      new Date(now.getFullYear(), now.getMonth() + 1, 1)
    ).slice(0, 8)
    const offered = [`${month}05`, `${month}20`]
    await serveAvailability(page, [
      ...everyDay(offered[0], offered[0]),
      ...everyDay(offered[1], offered[1]),
    ])
    await page.goto("/")
    await page.getByTestId("next-month").click()
    await expect(enabledDays(page)).toHaveCount(2)
    expect(
      await enabledDays(page).evaluateAll((els) =>
        els.map((el) => el.dataset.date)
      )
    ).toEqual(offered)
  })

  test('shows a "Could not load available days" banner when the available days cannot be loaded', async ({
    page,
  }) => {
    await page.route("**/api/availability", async (route) => {
      await route.fulfill({ status: 500 })
    })
    await page.goto("/")
    await expect(page.getByTestId("availability-error")).toHaveText(
      "Could not load available days"
    )
    await expect(enabledDays(page)).toHaveCount(0)
  })
})

test.describe("Time select", () => {
  test("time slots are greyed out until a date is selected", async ({
    page,
  }) => {
    for (const slot of await timeSlots(page).all()) {
      await expect(slot).toBeDisabled()
    }
    await selectFirstAvailableDate(page)
    for (const slot of await timeSlots(page).all()) {
      await expect(slot).toBeEnabled()
    }
  })

  test("shows 3 time slots", async ({ page }) => {
    await selectFirstAvailableDate(page)
    await expect(timeSlots(page)).toHaveCount(3)
  })

  test("default time zone is Montreal, Canada", async ({ page }) => {
    await expect(timezoneSelect(page)).toHaveValue(MONTREAL)
    await expect(timezoneSelect(page).locator("option:checked")).toContainText(
      "Montreal"
    )
  })

  test("time slots in Montreal are 13:30, 15:30 and 16:30", async ({
    page,
  }) => {
    await selectFirstAvailableDate(page)
    await expect(timeSlots(page)).toHaveText(["13:30", "15:30", "16:30"])
  })

  test("switching the time zone updates the time slots", async ({ page }) => {
    const date = await selectFirstAvailableDate(page)

    await timezoneSelect(page).selectOption(VANCOUVER)
    await expect(timeSlots(page)).toHaveCount(3)
    const firstVancouverSlot =
      (await timeSlots(page).first().textContent()) ?? ""
    const vancouver = await slotTimes(page)

    await timezoneSelect(page).selectOption(PARIS)
    await expect(timeSlots(page).first()).not.toHaveText(firstVancouverSlot)
    const paris = await slotTimes(page)

    const shift = parisMinusVancouverMinutes(date)
    expect(paris).toEqual(
      vancouver.map((minutes) => (minutes + shift) % (24 * 60))
    )
  })

  test('shows "Current time: " for the selected time zone', async ({
    page,
  }) => {
    await expectCurrentTimeIn(page, MONTREAL)
  })

  test("current time follows the selected time zone", async ({ page }) => {
    await timezoneSelect(page).selectOption(PARIS)
    await expectCurrentTimeIn(page, PARIS)
    await timezoneSelect(page).selectOption(VANCOUVER)
    await expectCurrentTimeIn(page, VANCOUVER)
  })

  test("offers the time slots the server gives for the selected date", async ({
    page,
  }) => {
    const date = isoDate(addDays(new Date(), 2))
    const slots = [`${date}T14:00:00.000Z`, `${date}T21:45:00.000Z`]
    await serveAvailability(page, [{ date, slots }])
    await page.goto("/")
    await selectFirstAvailableDate(page)
    await timezoneSelect(page).selectOption(PARIS)
    await expect(timeSlots(page)).toHaveText(
      slots.map((slot) => inZone(slot, PARIS).time)
    )
  })

  test("confirm button is disabled until a time slot is selected", async ({
    page,
  }) => {
    await expect(confirmButton(page)).toBeDisabled()
    await selectFirstAvailableDate(page)
    await expect(confirmButton(page)).toBeDisabled()
    await timeSlots(page).first().click()
    await expect(confirmButton(page)).toBeEnabled()
  })

  test("clicking confirm navigates to the confirmation page", async ({
    page,
  }) => {
    await selectFirstAvailableDate(page)
    await timeSlots(page).first().click()
    await confirmButton(page).click()
    await expect(page.getByTestId("confirmation-page")).toBeVisible()
  })
})

test.describe("Confirmation page", () => {
  test("url contains confirm", async ({ page }) => {
    await goToConfirmation(page)
    await expect(page).toHaveURL(/confirm/u)
  })

  test("shows the selected date, time and time zone", async ({ page }) => {
    const { date, time } = await goToConfirmation(page, PARIS)
    const summary = page.getByTestId("summary")
    await expect(summary).toContainText(date)
    await expect(summary).toContainText(time)
    await expect(summary).toContainText("Paris, France")
  })

  test("explains that an email with the Google Meet link follows shortly after confirming", async ({
    page,
  }) => {
    await goToConfirmation(page)
    await expect(page.getByTestId("meeting-link-message")).toContainText(
      /once you confirm.*shortly receive an email with the Google Meet link/iu
    )
  })

  test("has Name, Email and Description fields", async ({ page }) => {
    await goToConfirmation(page)
    await expect(page.getByLabel("Name")).toBeVisible()
    await expect(page.getByLabel("Email")).toBeVisible()
    await expect(page.getByLabel("Description")).toBeVisible()
  })

  test("clicking confirm runs the form validations", async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page, { name: "<b>", email: "nope", description: " " })
    await submitButton(page).click()
    await expect(page.getByTestId("name-error")).toBeVisible()
    await expect(page.getByTestId("email-error")).toBeVisible()
    await expect(page.getByTestId("description-error")).toBeVisible()
    await expect(confirmDialog(page)).toBeHidden()
  })

  test("name must be non-empty", async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page, { name: "   " })
    await submitButton(page).click()
    await expect(page.getByTestId("name-error")).toBeVisible()
    await fillContact(page, { name: "Anne-Marie O'Neil" })
    await submitButton(page).click()
    await expect(page.getByTestId("name-error")).toBeHidden()
  })

  test("email must have a valid format", async ({ page }) => {
    await goToConfirmation(page)
    for (const email of ["ada", "ada@", "ada@example", "ada @example.com"]) {
      await fillContact(page, { email })
      await submitButton(page).click()
      await expect(page.getByTestId("email-error")).toBeVisible()
    }
    await fillContact(page)
    await submitButton(page).click()
    await expect(page.getByTestId("email-error")).toBeHidden()
  })

  test("description must be non-empty", async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page, { description: "   " })
    await submitButton(page).click()
    await expect(page.getByTestId("description-error")).toBeVisible()
    await fillContact(page)
    await submitButton(page).click()
    await expect(page.getByTestId("description-error")).toBeHidden()
  })

  test("every field rejects dangerous strings", async ({ page }) => {
    await goToConfirmation(page)
    const fields = [
      { label: "Name", key: "name" },
      { label: "Email", key: "email" },
      { label: "Description", key: "description" },
    ] as const
    for (const { label, key } of fields) {
      for (const dangerous of [
        "<script>alert(1)</script>",
        // oxlint-disable-next-line no-script-url -- the payload the form must reject
        "javascript:alert(1)",
        "{{7*7}}",
      ]) {
        // Keep the value otherwise valid so only the dangerous string can trigger the error.
        const value =
          key === "email"
            ? `${dangerous}@example.com`
            : `${contact[key]} ${dangerous}`
        await fillContact(page, { [key]: value })
        await submitButton(page).click()
        await expect(
          page.getByTestId(`${key}-error`),
          `${label}: ${value}`
        ).toBeVisible()
        await expect(confirmDialog(page)).toBeHidden()
      }
      await fillContact(page)
      await submitButton(page).click()
      await expect(page.getByTestId(`${key}-error`)).toBeHidden()
      await page.keyboard.press("Escape")
      await expect(confirmDialog(page)).toBeHidden()
    }
  })

  test("confirm button is disabled until all 3 fields are non-empty", async ({
    page,
  }) => {
    await goToConfirmation(page)
    await expect(submitButton(page)).toBeDisabled()
    await page.getByLabel("Name").fill(contact.name)
    await expect(submitButton(page)).toBeDisabled()
    await page.getByLabel("Email").fill(contact.email)
    await expect(submitButton(page)).toBeDisabled()
    await page.getByLabel("Description").fill(contact.description)
    await expect(submitButton(page)).toBeEnabled()
  })

  test("clicking confirm opens an alert dialog", async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    await expect(confirmDialog(page)).toBeVisible()
  })

  test('dialog shows the date and time, with "OK" and "Cancel" buttons', async ({
    page,
  }) => {
    const { date, time } = await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    await expect(confirmDialog(page)).toContainText(date)
    await expect(confirmDialog(page)).toContainText(time)
    await expect(
      confirmDialog(page).getByRole("button", { name: "OK" })
    ).toBeVisible()
    await expect(
      confirmDialog(page).getByRole("button", { name: "Cancel" })
    ).toBeVisible()
  })

  test('clicking "Cancel" closes the dialog', async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    await confirmDialog(page).getByRole("button", { name: "Cancel" }).click()
    await expect(confirmDialog(page)).toBeHidden()
    await expect(page).toHaveURL(/confirm/u)
  })

  test('clicking "OK" navigates to the success page', async ({ page }) => {
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    await confirmDialog(page).getByRole("button", { name: "OK" }).click()
    await expect(page.getByTestId("success-page")).toBeVisible()
  })

  test("the server's booking-request API, called with the API key, returns exactly one booking with the entered data", async ({
    page,
    request,
  }) => {
    // Tests share one server, so a unique email identifies this test's booking.
    const email = `ada+${test.info().testId}-${Date.now()}@example.com`
    const {
      isoDate: date,
      time,
      timeZone,
    } = await goToConfirmation(page, PARIS)
    await fillContact(page, { email })
    await submitButton(page).click()
    await confirmDialog(page).getByRole("button", { name: "OK" }).click()
    await expect(page.getByTestId("success-page")).toBeVisible()

    const response = await request.get("/api/booking-requests", {
      params: { email },
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    expect(response.ok()).toBe(true)
    const bookings = await readJson<BookingRequest[]>(response)
    expect(bookings).toHaveLength(1)
    expect(bookings[0]).toMatchObject({
      timeZone,
      name: contact.name,
      email,
      description: contact.description,
    })
    expect(inZone(bookings[0].startsAt, timeZone)).toEqual({ date, time })
  })

  test("the server's booking-request API rejects listing bookings without a valid API key", async ({
    request,
  }) => {
    // No key, a wrong key, and the right key without the "Bearer " scheme.
    const attempts: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong-key" },
      { Authorization: API_KEY },
    ]
    for (const headers of attempts) {
      const response = await request.get("/api/booking-requests", { headers })
      expect(response.status()).toBe(401)
    }
  })

  test("the server's booking-request API rejects, and does not store, a booking that is not for an available time slot", async ({
    request,
  }) => {
    const email = `ada+${test.info().testId}-${Date.now()}@example.com`
    const available = await readJson<Availability>(
      await request.get("/api/availability")
    )
    const first = Date.parse(available.days[0].slots[0])
    const last = Date.parse(
      (available.days.at(-1) ?? available.days[0]).slots[0]
    )
    const unavailable = {
      "a past date": first - 3 * DAY,
      today: first - 2 * DAY,
      tomorrow: first - DAY,
      "more than 3 months out": last + DAY,
      "a time that is not an offered slot": first + 60 * 1000,
    }
    for (const [what, instant] of Object.entries(unavailable)) {
      const response = await request.post("/api/booking-requests", {
        data: {
          ...contact,
          email,
          startsAt: new Date(instant).toISOString(),
          timeZone: MONTREAL,
        } satisfies BookingRequest,
      })
      expect(response.status(), what).toBe(422)
    }

    const stored = await request.get("/api/booking-requests", {
      params: { email },
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    expect(await stored.json()).toEqual([])
  })

  test("the server's booking-request API rejects, and does not store, a booking with a time zone the UI does not offer", async ({
    request,
  }) => {
    const email = `ada+${test.info().testId}-${Date.now()}@example.com`
    const available = await readJson<Availability>(
      await request.get("/api/availability")
    )
    const response = await request.post("/api/booking-requests", {
      data: {
        ...contact,
        email,
        startsAt: available.days[0].slots[0],
        timeZone: "Mars/Olympus_Mons",
      } satisfies BookingRequest,
    })
    expect(response.status()).toBe(400)

    const stored = await request.get("/api/booking-requests", {
      params: { email },
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    expect(await stored.json()).toEqual([])
  })

  test("when the booking request fails, the dialog shows an error and the page stays on the confirmation page", async ({
    page,
  }) => {
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    const ok = confirmDialog(page).getByRole("button", { name: "OK" })

    // Covers both a server error response and the server being unreachable.
    const failures = [
      async (route: Route) => {
        await route.fulfill({ status: 500 })
      },
      async (route: Route) => {
        await route.abort("connectionrefused")
      },
    ]
    for (const fail of failures) {
      await page.unrouteAll()
      await page.route("**/api/booking-requests", fail)
      await ok.click()
      await expect(page.getByTestId("booking-error")).toBeVisible()
      await expect(confirmDialog(page)).toBeVisible()
      await expect(page).toHaveURL(/confirm/u)
      await expect(page.getByTestId("success-page")).toBeHidden()
      await expect(ok).toBeEnabled()
    }
  })
})

const goToSuccess = async (page: Page) => {
  const selected = await goToConfirmation(page)
  await fillContact(page)
  await submitButton(page).click()
  await confirmDialog(page).getByRole("button", { name: "OK" }).click()
  await expect(page.getByTestId("success-page")).toBeVisible()
  return selected
}

test.describe("Success page", () => {
  test("url contains success", async ({ page }) => {
    await goToSuccess(page)
    await expect(page).toHaveURL(/success/u)
  })

  test("shows the selected date and time, and the entered name, email and description", async ({
    page,
  }) => {
    const { date, time } = await goToSuccess(page)
    const success = page.getByTestId("success-page")
    for (const text of [
      date,
      time,
      contact.name,
      contact.email,
      contact.description,
    ]) {
      await expect(success).toContainText(text)
    }
  })

  test("tells them to check their inbox for the Google Meet link", async ({
    page,
  }) => {
    await goToSuccess(page)
    const message = page.getByTestId("success-meeting-link-message")
    await expect(message).toContainText(/check your inbox.*Google Meet link/iu)
    await expect(message).toContainText(contact.email)
  })
})

const GOOGLE = process.env.GOOGLE_API_ORIGIN ?? ""
type StoredBooking = BookingRequest & { id: number; meeting: Meeting | null }

const uniqueEmail = () => `ada+${test.info().testId}-${Date.now()}@example.com`

// Books the first available slot over the API, as the UI does, and returns the booking.
const book = async (request: APIRequestContext, email: string) => {
  const available = await readJson<Availability>(
    await request.get("/api/availability")
  )
  const response = await request.post("/api/booking-requests", {
    data: {
      ...contact,
      email,
      startsAt: available.days[0].slots[0],
      timeZone: MONTREAL,
    } satisfies BookingRequest,
  })
  expect(response.status()).toBe(201)
  return await readJson<StoredBooking>(response)
}

// Reads back the stored booking. Each read is its own client, so polling never runs into the rate limit.
const storedBooking = async (request: APIRequestContext, email: string) => {
  const response = await request.get("/api/booking-requests", {
    params: { email },
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "CF-Connecting-IP": newClient(test.info()),
    },
  })
  const bookings = await readJson<StoredBooking[]>(response)
  expect(bookings).toHaveLength(1)
  return bookings[0]
}

// The meeting once its creation has been attempted, which happens after the booking response.
const settledMeeting = async (
  request: APIRequestContext,
  email: string,
  status: Meeting["status"]
) => {
  await expect
    .poll(async () => {
      const booking = await storedBooking(request, email)
      return booking.meeting?.status
    })
    .toBe(status)
  const { meeting } = await storedBooking(request, email)
  if (meeting === null) {
    throw new Error("The booking has no meeting")
  }
  return meeting
}

const googleEvents = async (request: APIRequestContext, email: string) =>
  await readJson<StubEvent[]>(
    await request.get(`${GOOGLE}/stub/events`, { params: { attendee: email } })
  )

const googleOutage = async (
  request: APIRequestContext,
  email: string,
  down: boolean
) => {
  const outage = `${GOOGLE}/stub/outages/${encodeURIComponent(email)}`
  const response = await (down ? request.put(outage) : request.delete(outage))
  expect(response.ok()).toBe(true)
}

const retryMeetings = async (request: APIRequestContext) => {
  const response = await request.post("/api/meetings/retry", {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  expect(response.ok()).toBe(true)
}

test.describe("Google Meet", () => {
  test.skip(
    process.env.BASE_URL !== undefined,
    "needs the Google stub, which only runs with the local server"
  )

  test("a booking gets a 30-minute Google Meet at the booked time, inviting the booker", async ({
    request,
  }) => {
    const email = uniqueEmail()
    const booking = await book(request, email)
    await settledMeeting(request, email, "created")

    const events = await googleEvents(request, email)
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event.query).toMatchObject({
      sendUpdates: "all",
      conferenceDataVersion: "1",
    })
    expect(event.body).toMatchObject({
      summary: `Meeting with ${contact.name}`,
      description: contact.description,
      attendees: [{ email }],
      conferenceData: {
        createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    })
    const { start, end } = event.body
    expect(Date.parse(start.dateTime)).toBe(Date.parse(booking.startsAt))
    expect(Date.parse(end.dateTime) - Date.parse(start.dateTime)).toBe(
      30 * 60 * 1000
    )
  })

  test("the booking-request API shows the meeting as created, with its Meet link", async ({
    request,
  }) => {
    const email = uniqueEmail()
    await book(request, email)
    const meeting = await settledMeeting(request, email, "created")
    const [event] = await googleEvents(request, email)
    expect(meeting).toMatchObject({
      status: "created",
      meetLink: event.hangoutLink,
      attempts: 1,
      lastError: null,
    })
  })

  test("when Google fails, the booking is still stored and its meeting shows as failed", async ({
    request,
  }) => {
    const email = uniqueEmail()
    await googleOutage(request, email, true)
    await book(request, email)
    const meeting = await settledMeeting(request, email, "failed")
    expect(meeting).toMatchObject({
      status: "failed",
      meetLink: null,
      attempts: 1,
    })
    expect(meeting.lastError).toContain("503")
    expect(await storedBooking(request, email)).toMatchObject({
      ...contact,
      email,
    })
    expect(await googleEvents(request, email)).toEqual([])
  })

  test("the meeting-retry API creates a failed meeting once Google works again", async ({
    request,
  }) => {
    const email = uniqueEmail()
    await googleOutage(request, email, true)
    await book(request, email)
    await settledMeeting(request, email, "failed")

    await googleOutage(request, email, false)
    await retryMeetings(request)
    const meeting = await settledMeeting(request, email, "created")
    const events = await googleEvents(request, email)
    expect(events).toHaveLength(1)
    expect(meeting).toMatchObject({
      meetLink: events[0].hangoutLink,
      attempts: 2,
      lastError: null,
    })
  })

  test("the meeting-retry API leaves a created meeting alone", async ({
    request,
  }) => {
    const email = uniqueEmail()
    await book(request, email)
    const before = await settledMeeting(request, email, "created")

    await retryMeetings(request)
    expect(await googleEvents(request, email)).toHaveLength(1)
    const after = await storedBooking(request, email)
    expect(after.meeting).toEqual(before)
  })

  test("the meeting-retry API rejects calls without a valid API key", async ({
    request,
  }) => {
    // No key, a wrong key, and the right key without the "Bearer " scheme.
    const attempts: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong-key" },
      { Authorization: API_KEY },
    ]
    for (const headers of attempts) {
      const response = await request.post("/api/meetings/retry", { headers })
      expect(response.status()).toBe(401)
    }
  })
})

test.describe("Rate limiting", () => {
  test("a client gets 10 API requests every 60 seconds, then 429 Too Many Requests", async ({
    request,
  }, testInfo) => {
    // The page loaded before each test has already spent some of this test's budget, so count from a fresh client.
    const headers = { "CF-Connecting-IP": newClient(testInfo) }
    // Any route and outcome counts: unauthorized listings, bookings and unknown routes alike.
    const calls = [
      async () => await request.get("/api/booking-requests", { headers }),
      async () =>
        await request.post("/api/booking-requests", {
          headers,
          data: {
            ...contact,
            startsAt: "2026-10-01T17:30:00.000Z",
            timeZone: MONTREAL,
          },
        }),
      async () => await request.get("/api/nope", { headers }),
    ]
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      const response = await calls[i % calls.length]()
      expect(response.status(), `request ${i + 1}`).not.toBe(429)
    }

    const limited = await request.get("/api/booking-requests", {
      headers: { ...headers, Authorization: `Bearer ${API_KEY}` },
    })
    expect(limited.status()).toBe(429)
    expect(limited.headers()["retry-after"]).toBe("60")
  })

  test("another client is not affected", async ({ request }, testInfo) => {
    for (let i = 0; i <= RATE_LIMIT; i += 1) {
      await request.get("/api/booking-requests")
    }
    const other = await request.get("/api/booking-requests", {
      headers: {
        "CF-Connecting-IP": newClient(testInfo),
        Authorization: `Bearer ${API_KEY}`,
      },
    })
    expect(other.status()).toBe(200)
  })
})
