// Implements the scenarios in prod.test.md.
//
// Runs against the deployed Worker (see playwright.config.ts here), so the booking is real: Google creates the Meet
// and emails the invite, and cmail emails the admin. The booker is ADMIN_EMAIL, plus-addressed per run
// (admin+ccal-smoke-<time>@...), so the invite lands in the admin's inbox and each run reads back only its own booking.
// Reading the booking back requires "Authorization: Bearer $CCAL_API_KEY", the deployed key.
// The API allows each client 10 requests every 60 seconds, keyed on the caller's real IP, so polling is kept slow.
// It runs after `bun run deploy`, which waits until the deployed version is served, so it does not wait again.
// Production runs the real Turnstile, which rejects headless and most automated browsers: the run opens a visible
// Brave (see playwright.config.ts here) and waits for whoever runs it to complete the check, if Turnstile asks for one.
// The admin email goes out in the background, where the test cannot see it; whoever runs it checks the admin inbox.

import type { BookingRequest, Meeting } from "@ccal/shared"
import { test, expect } from "@playwright/test"
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Response,
} from "@playwright/test"

const API_KEY = process.env.CCAL_API_KEY ?? ""
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? ""
// How long whoever runs the test has to complete the Turnstile check.
const VERIFICATION_TIMEOUT = 5 * 60_000
// Turnstile's own requests and console messages, e.g. the 401 of its Private Access Token probe.
const isTurnstile = (url: string) =>
  url.startsWith("https://challenges.cloudflare.com/")

type StoredBooking = BookingRequest & { id: number; meeting: Meeting | null }

// The JSON body of an API response, typed as the shape the API under test promises.
const readJson = async <T>(response: APIResponse | Response): Promise<T> => {
  const body: unknown = await response.json()
  // SAFETY: the test asserts on every field it reads, so a wrong shape fails the test.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return body as T
}

// ADMIN_EMAIL, plus-addressed so that this run's booking is the only one stored for it.
const smokeEmail = () => {
  const [local, domain] = ADMIN_EMAIL.split("@")
  return `${local}+ccal-smoke-${Date.now()}@${domain}`
}

const enabledDays = (page: Page) =>
  page.locator('[data-testid="day"]:not([disabled])')

// Selects the first available date, moving to the next month if the current one has none left.
const selectFirstAvailableDate = async (page: Page) => {
  // Waits until the available days are loaded: the month label renders together with the loading banner.
  await expect(page.getByTestId("month-label")).toBeAttached()
  await expect(page.getByTestId("availability-loading")).toBeHidden()
  if ((await enabledDays(page).count()) === 0) {
    await page.getByTestId("next-month").click()
  }
  const first = enabledDays(page).first()
  await first.click()
}

// Collects every error the browser reports while the test runs.
const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && !isTurnstile(message.location().url)) {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => {
    errors.push(`page error: ${error.message}`)
  })
  page.on("response", (response) => {
    if (response.status() >= 400 && !isTurnstile(response.url())) {
      errors.push(`HTTP ${response.status()} ${response.url()}`)
    }
  })
  return errors
}

const storedBooking = async (request: APIRequestContext, email: string) => {
  const response = await request.get("/api/booking-requests", {
    params: { email },
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  expect(response.status()).toBe(200)
  const bookings = await readJson<StoredBooking[]>(response)
  expect(bookings).toHaveLength(1)
  return bookings[0]
}

// Playwright requires the fixtures argument to be destructured, even when unused.
// oxlint-disable-next-line no-empty-pattern
test.beforeAll(({}) => {
  expect(API_KEY, "CCAL_API_KEY must be set").not.toBe("")
  expect(ADMIN_EMAIL, "ADMIN_EMAIL must be set").toContain("@")
})

test("booking through the UI stores the booking and creates its Google Meet", async ({
  page,
  request,
}) => {
  test.setTimeout(test.info().timeout + VERIFICATION_TIMEOUT)
  const errors = watchErrors(page)
  const email = smokeEmail()
  const contact = {
    name: "ccal smoke test",
    email,
    description: "Smoke test after a deploy, safe to ignore.",
  }

  // The test clock only exists when the Worker runs with ENABLE_TEST_CLOCK, which production never sets.
  const testClock = await request.post("/api/test-clock", {
    data: { now: "2026-09-29T14:00:00.000Z" },
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  expect(testClock.status()).toBe(404)

  await page.goto("/")
  await selectFirstAvailableDate(page)
  await page.getByTestId("time-slot").first().click()
  await page.getByTestId("confirm-button").click()
  await expect(page.getByTestId("confirmation-page")).toBeVisible()

  await page.getByLabel("Name").fill(contact.name)
  await page.getByLabel("Email").fill(contact.email)
  await page.getByLabel("Description").fill(contact.description)
  await page.getByTestId("submit-button").click()
  const dialog = page.getByRole("alertdialog")
  console.log("Complete the Turnstile check in the browser if it asks for one.")
  await expect(dialog.getByTestId("turnstile")).toContainText(
    "Verification complete",
    { timeout: VERIFICATION_TIMEOUT }
  )
  const [posted] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/booking-requests") &&
        response.request().method() === "POST"
    ),
    dialog.getByRole("button", { name: "OK" }).click(),
  ])
  expect(posted.status()).toBe(201)
  const accepted = await readJson<StoredBooking>(posted)

  const success = page.getByTestId("success-page")
  await expect(success).toBeVisible()
  await expect(success).toContainText(contact.name)
  await expect(success).toContainText(contact.email)

  // The Meet is created after the response; a few slow reads stay well under the rate limit.
  await expect
    .poll(
      async () => {
        const { meeting } = await storedBooking(request, email)
        return meeting?.status
      },
      {
        intervals: [3000, 5000],
        timeout: 30_000,
      }
    )
    .toBe("created")
  const booking = await storedBooking(request, email)
  expect(booking).toMatchObject({
    ...contact,
    startsAt: accepted.startsAt,
    timeZone: accepted.timeZone,
  })
  expect(booking.meeting).toMatchObject({
    status: "created",
    meetLink: expect.stringMatching(/^https:\/\/meet\.google\.com\//u),
    lastError: null,
  })

  expect(errors).toEqual([])
})
