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
//   data-testid="availability-loading" banner shown while the available days are loading
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
// The UI loads the bookable days and slots from GET /api/availability on the same origin, and only offers those. The
// response also carries the server's time (`now`, `today`, and each zone's `offsets`) and each slot's time in every zone,
// so the UI never reads the browser's clock or time zone data.
// POST /api/test-clock { now } (with the API key) fakes the server's time, `{ now: null }` resets it; the Worker only
// serves it when started with ENABLE_TEST_CLOCK, which playwright.config.ts sets.
// Clicking "OK" POSTs the booking to /api/booking-requests on the same origin as the UI.
// GET /api/booking-requests?email= reads back what was stored; it requires "Authorization: Bearer $CCAL_API_KEY".
// GET /api/version returns the serving Worker version ({ id, tag, timestamp }), and is exempt from the rate limit.
// GET /api/booking-requests also returns each booking's Google Meet (`meeting`), which the Worker creates in the background.
// The Worker reaches "Google" at GOOGLE_API_ORIGIN, a stub (google-stub.ts) whose /stub/* routes list the events it
// created and make it fail for an attendee. POST /api/meetings/retry (with the API key) retries unfinished meetings now.
// The Worker emails ADMIN_EMAIL through "cmail" at CMAIL_ORIGIN, a stub (cmail-stub.ts) whose /stub/* routes list the
// emails it received and make it fail for emails mentioning a text.
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
import { Schema } from "effect"

import type { StubEmail } from "./cmail-stub"
import type { StubEvent } from "./google-stub"
import { workerLogLinesSince } from "./worker-log"

const API_KEY = process.env.CCAL_API_KEY ?? ""

// IANA has no Montreal zone; it uses Toronto's
const MONTREAL = "America/Toronto"
const PARIS = "Europe/Paris"
const VANCOUVER = "America/Vancouver"

const DAY = 24 * 60 * 60 * 1000

// The time the date and time scenarios fake: October 1 2026, 10:00 in Montreal.
const CLOCK = "2026-10-01T14:00:00.000Z"

// The day after `date` ("YYYY-MM-DD").
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10)

const toMinutes = (time: string) => {
  const [hours, minutes] = time.trim().split(":").map(Number)
  return hours * 60 + minutes
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

// Asserts the current time shown is `expected` ("HH:mm"), within a minute.
const expectCurrentTime = async (page: Page, expected: string) => {
  await expect(currentTime(page)).toHaveText(/^Current time: \d{2}:\d{2}$/u)
  await expect
    .poll(async () => {
      const text = (await currentTime(page).textContent()) ?? ""
      const shown = toMinutes(text.replace("Current time:", ""))
      return minutesApart(shown, toMinutes(expected))
    })
    .toBeLessThanOrEqual(1)
}

// Waits until the available days are loaded (or failed to load). The month label renders together with the loading
// banner, so once it is there the banner is too, and is only hidden once loading is over.
const waitForAvailability = async (page: Page) => {
  await expect(monthLabelEl(page)).toBeAttached()
  await expect(page.getByTestId("availability-loading")).toBeHidden()
}

// Fakes the server's time (an ISO datetime), or goes back to the real time with null.
const setTestClock = async (request: APIRequestContext, now: string | null) => {
  const response = await request.post("/api/test-clock", {
    data: { now },
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  expect(response.status()).toBe(200)
}

// Fakes the server's time to `now` for every test of the enclosing describe, reloading the page so it shows that time.
const useTestClock = (now: string) => {
  test.skip(
    process.env.BASE_URL !== undefined,
    "fakes the server's time, which only the local server allows"
  )
  test.beforeEach(async ({ page, request }) => {
    await setTestClock(request, now)
    await page.goto("/")
    await waitForAvailability(page)
  })
  test.afterEach(async ({ request }) => {
    await setTestClock(request, null)
  })
}

// Selects the first available date, moving to the next month if the current one has none left.
const selectFirstAvailableDate = async (page: Page) => {
  await waitForAvailability(page)
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
  await expect(slot).toHaveAttribute("aria-label", new RegExp(timeZone, "u"))
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

// Serves `offered` as the availability, as if the server offered exactly those days, at the CLOCK time.
const serveAvailability = async (page: Page, offered: Availability["days"]) => {
  await page.route("**/api/availability", async (route) => {
    await route.fulfill({
      json: {
        now: CLOCK,
        today: "2026-10-01",
        offsets: { [MONTREAL]: -240, [PARIS]: 120, [VANCOUVER]: -420 },
        days: offered,
      } satisfies Availability,
    })
  })
}

// Every day from `first` through `last` ("YYYY-MM-DD"), each with one slot.
const everyDay = (first: string, last: string): Availability["days"] => {
  const result: Availability["days"] = []
  for (let date = first; date <= last; date = nextDay(date)) {
    result.push({
      date,
      slots: [
        { startsAt: `${date}T17:30:00.000Z`, times: { [MONTREAL]: "13:30" } },
      ],
    })
  }
  return result
}

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

// Stands in for Cloudflare's Turnstile script, so no test reaches the network: every widget passes at once with
// Cloudflare's dummy token, which the Turnstile stub accepts. Resetting a widget passes it again, and an "e2e-expire"
// event expires every widget.
const TURNSTILE_SCRIPT = "**/turnstile/v0/api.js?*"
const FAKE_TURNSTILE = `
  const widgets = new Map();
  const pass = (id) => setTimeout(() => widgets.get(id)?.callback?.("XXXX.DUMMY.TOKEN.XXXX"), 0);
  window.addEventListener("e2e-expire", () => {
    for (const options of widgets.values()) options["expired-callback"]?.();
  });
  window.turnstile = {
    render(container, options) {
      const id = "widget-" + (widgets.size + 1);
      const element = typeof container === "string" ? document.querySelector(container) : container;
      if (options.theme !== "dark") throw new Error("Expected a dark Turnstile widget");
      element.textContent = "test widget";
      widgets.set(id, options);
      pass(id);
      return id;
    },
    reset(id) { pass(id); },
    remove(id) { widgets.delete(id); },
    getResponse() { return "XXXX.DUMMY.TOKEN.XXXX"; },
    isExpired() { return false; },
    ready(callback) { callback(); },
  };
`

const fakeTurnstile = async (route: Route) => {
  await route.fulfill({
    contentType: "application/javascript",
    body: FAKE_TURNSTILE,
  })
}

test.beforeEach(async ({ page }) => {
  await page.route(TURNSTILE_SCRIPT, fakeTurnstile)
  await page.goto("/")
  await page.waitForLoadState("load")
  await waitForAvailability(page)
})

test.describe("Page load", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`always uses dark mode with a ${colorScheme} system preference`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      await page.reload()
      await expect(page.locator("html")).toHaveClass("dark")
      await expect(page.locator("html")).toHaveCSS("color-scheme", "dark only")
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        "oklch(0.153 0.006 107.1)"
      )
    })
  }

  test("shows the meeting type", async ({ page }) => {
    await expect(page.locator("body")).toContainText("Google Meet")
  })

  test("remounts the booking page with fresh selection after going back", async ({
    page,
  }) => {
    await goToConfirmation(page)
    await expect(page.getByTestId("foldkit-booking")).toHaveCount(0)
    await page.goBack()
    await waitForAvailability(page)
    await expect(page.getByTestId("foldkit-booking")).toBeVisible()
    await expect(selectedDate(page)).toHaveText("Select a date")
    await expect(confirmButton(page)).toBeDisabled()
    await selectFirstAvailableDate(page)
    await timeSlots(page).first().click()
    await confirmButton(page).click()
    await expect(page.getByTestId("confirmation-page")).toBeVisible()
  })

  test("uses a hash router on the form route", async ({ page }) => {
    await expect(page).toHaveURL(/#/u)
    await expect(page).toHaveURL(/form/u)
  })
})

test.describe("Loading", () => {
  test("disables every control behind a loading banner until the available days are loaded", async ({
    page,
  }) => {
    // Holds the availability response until `release` is called.
    const { promise: released, resolve: release } =
      Promise.withResolvers<null>()
    await page.route("**/api/availability", async (route) => {
      await released
      await route.continue()
    })
    await page.goto("/")
    const loading = page.getByTestId("availability-loading")
    await expect(loading).toHaveText("Loading available days")
    await expect(page.getByTestId("prev-month")).toBeDisabled()
    await expect(page.getByTestId("next-month")).toBeDisabled()
    await expect(timezoneSelect(page)).toBeDisabled()
    await expect(confirmButton(page)).toBeDisabled()
    await expect(enabledDays(page)).toHaveCount(0)
    await expect(
      page.locator('[data-testid="time-slot"]:not([disabled])')
    ).toHaveCount(0)

    release(null)
    await expect(loading).toBeHidden()
    await expect(page.getByTestId("next-month")).toBeEnabled()
    await expect(timezoneSelect(page)).toBeEnabled()
  })
})

test.describe("Server time", () => {
  test.skip(
    process.env.BASE_URL !== undefined,
    "fakes the server's time, which only the local server allows"
  )
  test("the test-clock API rejects calls without a valid API key", async ({
    request,
  }) => {
    // No key, a wrong key, and the right key without the "Bearer " scheme.
    const attempts: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong-key" },
      { Authorization: API_KEY },
    ]
    for (const headers of attempts) {
      const response = await request.post("/api/test-clock", {
        data: { now: CLOCK },
        headers,
      })
      expect(response.status()).toBe(401)
    }
  })

  test("resetting the test clock brings back the real time", async ({
    request,
  }) => {
    const serverNow = async () => {
      const response = await request.get("/api/availability")
      const availability = await readJson<Availability>(response)
      return Date.parse(availability.now)
    }
    await setTestClock(request, CLOCK)
    expect(await serverNow()).toBe(Date.parse(CLOCK))
    await setTestClock(request, null)
    expect(Math.abs((await serverNow()) - Date.now())).toBeLessThan(60_000)
  })
})

test.describe("Date select", () => {
  useTestClock(CLOCK)

  test("shows the current month and year", async ({ page }) => {
    await expect(monthLabelEl(page)).toHaveText("October 2026")
  })

  test("greys out past days, today and tomorrow", async ({ page }) => {
    const dates = await days(page).evaluateAll((els) =>
      els.map((el) => el.dataset.date ?? "")
    )
    const unavailable = dates.filter((date) => date <= "2026-10-02")
    expect(unavailable).toContain("2026-10-01")
    expect(unavailable).toContain("2026-10-02")
    for (const date of unavailable) {
      await expect(day(page, date)).toBeDisabled()
    }
    await expect(day(page, "2026-10-03")).toBeEnabled()
  })

  test("clicking a greyed-out date does not change the selected date", async ({
    page,
  }) => {
    const before = await selectedDate(page).textContent()
    await day(page, "2026-10-01").click({ force: true })
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
    await page.getByTestId("next-month").click()
    await expect(monthLabelEl(page)).toHaveText("November 2026")
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
    await expect(monthLabelEl(page)).toHaveText("January 2027")
    await expect(next).toBeDisabled()
  })

  test('shows a "No available days this month" banner when every day is disabled', async ({
    page,
    request,
  }) => {
    // The earliest bookable day is October 1, so every September day is disabled.
    await setTestClock(request, "2026-09-29T14:00:00.000Z")
    await page.goto("/")
    await waitForAvailability(page)
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
    // On October 1 the earliest bookable day is October 3, so October still has available days.
    await expect(monthLabelEl(page)).toHaveText("October 2026")
    await expect(enabledDays(page).first()).toBeVisible()
    await expect(noAvailableDays(page)).toBeHidden()
  })

  test("only offers the days the server says are available", async ({
    page,
  }) => {
    const offered = ["2026-11-05", "2026-11-20"]
    await serveAvailability(page, [
      ...everyDay(offered[0], offered[0]),
      ...everyDay(offered[1], offered[1]),
    ])
    await page.goto("/")
    await waitForAvailability(page)
    await page.getByTestId("next-month").click()
    await expect(monthLabelEl(page)).toHaveText("November 2026")
    await expect(enabledDays(page)).toHaveCount(2)
    expect(
      await enabledDays(page).evaluateAll((els) =>
        els.map((el) => el.dataset.date)
      )
    ).toEqual(offered)
  })

  test("rejects malformed successful availability responses", async ({
    page,
  }) => {
    await page.route("**/api/availability", async (route) => {
      await route.fulfill({ json: { days: "not an array" } })
    })
    await page.goto("/")
    await expect(page.getByTestId("availability-error")).toHaveText(
      "Could not load available days"
    )
    await expect(enabledDays(page)).toHaveCount(0)
    await expect(confirmButton(page)).toBeDisabled()
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
  useTestClock(CLOCK)

  test("time slots are greyed out until a date is selected", async ({
    page,
  }) => {
    await expect(timeSlots(page)).toHaveCount(3)
    for (const slot of await timeSlots(page).all()) {
      await expect(slot).toBeDisabled()
    }
    await selectFirstAvailableDate(page)
    for (const slot of await timeSlots(page).all()) {
      await expect(slot).toBeEnabled()
    }
  })

  test("time slots have accessible labels with their time and time zone", async ({
    page,
  }) => {
    await selectFirstAvailableDate(page)
    await expect(timeSlots(page).first()).toHaveAttribute(
      "aria-label",
      "13:30 (America/Toronto)"
    )
    await timezoneSelect(page).selectOption(PARIS)
    await expect(timeSlots(page).first()).toHaveAttribute(
      "aria-label",
      "19:30 (Europe/Paris)"
    )
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
    expect(await selectFirstAvailableDate(page)).toBe("2026-10-03")
    await timezoneSelect(page).selectOption(VANCOUVER)
    await expect(timeSlots(page)).toHaveText(["10:30", "12:30", "13:30"])
    await timezoneSelect(page).selectOption(PARIS)
    await expect(timeSlots(page)).toHaveText(["19:30", "21:30", "22:30"])
  })

  test('shows "Current time: " for the selected time zone', async ({
    page,
  }) => {
    await expectCurrentTime(page, "10:00")
  })

  test("current time follows the selected time zone", async ({ page }) => {
    await timezoneSelect(page).selectOption(PARIS)
    await expectCurrentTime(page, "16:00")
    await timezoneSelect(page).selectOption(VANCOUVER)
    await expectCurrentTime(page, "07:00")
  })

  test("offers the time slots the server gives for the selected date", async ({
    page,
  }) => {
    const date = "2026-10-03"
    await serveAvailability(page, [
      {
        date,
        slots: [
          { startsAt: `${date}T14:00:00.000Z`, times: { [PARIS]: "16:00" } },
          { startsAt: `${date}T21:45:00.000Z`, times: { [PARIS]: "23:45" } },
        ],
      },
    ])
    await page.goto("/")
    await selectFirstAvailableDate(page)
    await timezoneSelect(page).selectOption(PARIS)
    await expect(timeSlots(page)).toHaveText(["16:00", "23:45"])
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

  test("selecting another date clears the selected time slot", async ({
    page,
  }) => {
    await selectFirstAvailableDate(page)
    await timeSlots(page).first().click()
    await expect(confirmButton(page)).toBeEnabled()
    await enabledDays(page).nth(1).click()
    await expect(confirmButton(page)).toBeDisabled()
    await expect(
      page.locator('[data-testid="time-slot"][aria-pressed="true"]')
    ).toHaveCount(0)
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
    // The stored instant is the slot that was picked: on the selected day, at the time shown in that zone.
    const available = await readJson<Availability>(
      await request.get("/api/availability")
    )
    const picked = available.days
      .find((offered) => offered.date === date)
      ?.slots.find((slot) => slot.startsAt === bookings[0].startsAt)
    expect(picked?.times[timeZone]).toBe(time)
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
    const first = Date.parse(available.days[0].slots[0].startsAt)
    const last = Date.parse(
      (available.days.at(-1) ?? available.days[0]).slots[0].startsAt
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
        startsAt: available.days[0].slots[0].startsAt,
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
      startsAt: available.days[0].slots[0].startsAt,
      timeZone: MONTREAL,
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    } satisfies BookingRequest & { turnstileToken: string },
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

const CMAIL = process.env.CMAIL_ORIGIN ?? ""
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? ""

// The emails cmail received about a booker; each mentions the booker's email.
const adminEmails = async (request: APIRequestContext, email: string) =>
  await readJson<StubEmail[]>(
    await request.get(`${CMAIL}/stub/emails`, { params: { contains: email } })
  )

const cmailOutage = async (
  request: APIRequestContext,
  email: string,
  down: boolean
) => {
  const outage = `${CMAIL}/stub/outages/${encodeURIComponent(email)}`
  const response = await (down ? request.put(outage) : request.delete(outage))
  expect(response.ok()).toBe(true)
}

test.describe("Admin notification", () => {
  test.skip(
    process.env.BASE_URL !== undefined,
    "needs the cmail stub, which only runs with the local server"
  )

  test("a booking emails ADMIN_EMAIL with the booked time and the booker's details", async ({
    request,
  }) => {
    const email = uniqueEmail()
    const booking = await book(request, email)
    await expect
      .poll(async () => await adminEmails(request, email))
      .toHaveLength(1)

    const [sent] = await adminEmails(request, email)
    expect(sent.to).toBe(ADMIN_EMAIL)
    expect(sent.title).toBe(`New booking request from ${contact.name}`)
    const when = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      hourCycle: "h23",
      timeZone: MONTREAL,
    }).format(new Date(booking.startsAt))
    for (const detail of [
      when,
      MONTREAL,
      contact.name,
      email,
      contact.description,
    ]) {
      expect(sent.body).toContain(detail)
    }
  })

  test("sends exactly one email per booking request", async ({ request }) => {
    const email = uniqueEmail()
    await book(request, email)
    await expect
      .poll(async () => await adminEmails(request, email))
      .toHaveLength(1)
    // Still one once the Worker has also finished the booking's meeting.
    await settledMeeting(request, email, "created")
    expect(await adminEmails(request, email)).toHaveLength(1)
  })

  // The booking must not fail when the email does. The failure is logged at error level by the Worker in the
  // background, so this asserts both the part the API promises (the booking is stored without the email) and that
  // the failure is recorded rather than swallowed.
  test("when the email cannot be sent, the booking is still accepted and stored", async ({
    request,
  }) => {
    const email = uniqueEmail()
    const failedAt = Date.now()
    await cmailOutage(request, email, true)
    await book(request, email)
    expect(await storedBooking(request, email)).toMatchObject({
      ...contact,
      email,
    })
    await settledMeeting(request, email, "created")
    expect(await adminEmails(request, email)).toEqual([])
    await expect
      .poll(
        async () => {
          const lines = await workerLogLinesSince(failedAt)
          return lines.join("\n")
        },
        { message: "waiting for the Worker to log the failed admin email" }
      )
      .toContain("AdminEmailNotSent")
    await cmailOutage(request, email, false)
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

  test("a client that used up its budget can still call the version API", async ({
    request,
  }, testInfo) => {
    const headers = { "CF-Connecting-IP": newClient(testInfo) }
    for (let i = 0; i <= RATE_LIMIT; i += 1) {
      await request.get("/api/booking-requests", { headers })
    }
    const limited = await request.get("/api/booking-requests", { headers })
    expect(limited.status()).toBe(429)

    const version = await request.get("/api/version", { headers })
    expect(version.status()).toBe(200)
  })
})

test.describe("Turnstile", () => {
  test.skip(
    process.env.BASE_URL !== undefined,
    "uses local dummy keys and the Siteverify stub"
  )

  for (const [scenario, token, status] of [
    ["missing", undefined, 403],
    ["empty", "", 400],
    ["overlong", "x".repeat(2049), 400],
    ["invalid", "e2e-invalid", 403],
    ["expired or duplicate", "e2e-spent", 403],
    ["wrong hostname", "e2e-wrong-host", 403],
    ["wrong action", "e2e-wrong-action", 403],
    ["verification outage", "e2e-outage", 503],
  ] as const) {
    test(`${scenario} verification creates no booking, email, or Meet`, async ({
      request,
    }) => {
      const email = uniqueEmail()
      const available = await readJson<Availability>(
        await request.get("/api/availability")
      )
      const response = await request.post("/api/booking-requests", {
        data: {
          ...contact,
          email,
          startsAt: available.days[0].slots[0].startsAt,
          timeZone: MONTREAL,
          turnstileToken: token,
        },
      })
      expect(response.status()).toBe(status)
      const stored = await request.get("/api/booking-requests", {
        params: { email },
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      expect(stored.status()).toBe(200)
      expect(await stored.json()).toEqual([])
      expect(await googleEvents(request, email)).toEqual([])
      expect(await adminEmails(request, email)).toEqual([])
    })
  }

  test("script failure blocks submission and offers a working retry", async ({
    page,
  }) => {
    // The script fails to load once; the retry gets the fake one.
    let failing = true
    await page.route(TURNSTILE_SCRIPT, async (route) => {
      await (failing ? route.abort() : route.fallback())
    })
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    const ok = confirmDialog(page).getByRole("button", {
      name: "OK",
      exact: true,
    })
    await expect(ok).toBeDisabled()
    const retry = page.getByRole("button", { name: "Retry verification" })
    await expect(retry).toBeVisible()
    failing = false
    await retry.click()
    await expect(ok).toBeEnabled()
  })

  test("expiry clears the token and reopening removes the old widget", async ({
    page,
  }) => {
    await goToConfirmation(page)
    await fillContact(page)
    await submitButton(page).click()
    const ok = confirmDialog(page).getByRole("button", {
      name: "OK",
      exact: true,
    })
    await expect(ok).toBeEnabled()
    await page.evaluate(() => {
      window.dispatchEvent(new Event("e2e-expire"))
    })
    await expect(ok).toBeDisabled()
    await page.getByRole("button", { name: "Retry verification" }).click()
    await expect(ok).toBeEnabled()
    await confirmDialog(page).getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByTestId("turnstile")).toHaveCount(0)
    await submitButton(page).click()
    await expect(ok).toBeEnabled()
    await expect(page.getByTestId("turnstile")).toHaveCount(1)
  })

  test("a rejected browser booking stays in the dialog and succeeds after fresh verification", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail()
    await goToConfirmation(page)
    await fillContact(page, { email })
    await submitButton(page).click()
    await page.route("**/api/booking-requests", async (route) => {
      const body = Schema.decodeUnknownSync(
        Schema.Struct({
          startsAt: Schema.String,
          timeZone: Schema.String,
          name: Schema.String,
          email: Schema.String,
          description: Schema.String,
        })
      )(route.request().postDataJSON())
      await route.continue({
        postData: JSON.stringify({ ...body, turnstileToken: "e2e-invalid" }),
      })
    })
    const ok = confirmDialog(page).getByRole("button", {
      name: "OK",
      exact: true,
    })
    await ok.click()
    await expect(page.getByTestId("booking-error")).toBeVisible()
    await expect(page).toHaveURL(/confirm/u)
    expect(await googleEvents(request, email)).toEqual([])
    expect(await adminEmails(request, email)).toEqual([])
    await page.unroute("**/api/booking-requests")
    await expect(ok).toBeEnabled()
    await ok.click()
    await expect(page.getByTestId("success-page")).toBeVisible()
    expect(await storedBooking(request, email)).toMatchObject({ email })
  })
})

test.describe("Version", () => {
  test("the version API returns the serving Worker version, without an API key", async ({
    request,
  }) => {
    const response = await request.get("/api/version")
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({
      id: expect.stringMatching(/.+/u),
      tag: expect.any(String),
      timestamp: expect.any(String),
    })
  })
})
