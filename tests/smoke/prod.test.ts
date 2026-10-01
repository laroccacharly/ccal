// Implements the scenarios in prod.test.md.
//
// Runs against the deployed Worker (see playwright.config.ts here), so the booking is real: Google creates the Meet
// and emails the invite, and cmail emails the admin. The booker is ADMIN_EMAIL, plus-addressed per run
// (admin+ccal-smoke-<time>@...), so the invite lands in the admin's inbox and each run reads back only its own booking.
// Reading the booking back requires "Authorization: Bearer $CCAL_API_KEY", the deployed key.
// The API allows each client 10 requests every 60 seconds, keyed on the caller's real IP, so polling is kept slow.
// Before booking, it waits until GET /api/version (exempt from the rate limit) reports the version Cloudflare lists as
// deployed: a new version takes a few seconds to reach every Cloudflare location after a deploy.
// Production runs the real Turnstile, which rejects headless and most automated browsers: the run opens a visible
// Brave (see playwright.config.ts here) and waits for whoever runs it to complete the check, if Turnstile asks for one.
// Afterwards the test prints the Worker's logs from Cloudflare's observability API (as `ccf worker logs` does), which
// needs CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_API_TOKEN with Workers observability read access. Cloudflare makes logs
// searchable out of order, so the test notes the ray id (the cf-ray response header) of every API request it makes,
// and waits until each one's request log line is found.

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
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ""
// The deployed Worker's script name, which its logs are filed under.
const WORKER = "ccal"
// How long whoever runs the test has to complete the Turnstile check.
const VERIFICATION_TIMEOUT = 5 * 60_000
// Turnstile's own requests and console messages, e.g. the 401 of its Private Access Token probe.
const isTurnstile = (url: string) =>
  url.startsWith("https://challenges.cloudflare.com/")

type StoredBooking = BookingRequest & { id: number; meeting: Meeting | null }

// The ray id of every API request this run made, as the Worker's logs record it.
const rayIds = new Set<string>()

// Notes a response's ray id. cf-ray is "<ray id>-<data center>", e.g. "a433eca4bdf1cf22-SJC"; the logs keep the id.
const noteRayId = (cfRay: string | null | undefined) => {
  const [rayId] = (cfRay ?? "").split("-")
  expect(rayId, "the response has no cf-ray header").not.toBe("")
  rayIds.add(rayId)
}

// The JSON body of an API response, typed as the shape the API under test promises.
const readJson = async <T>(
  response: APIResponse | Response | globalThis.Response
): Promise<T> => {
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

// Collects every error the browser reports while the test runs, and notes the ray id of its API requests.
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
    if (new URL(response.url()).pathname.startsWith("/api/")) {
      noteRayId(response.headers()["cf-ray"])
    }
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
  noteRayId(response.headers()["cf-ray"])
  expect(response.status()).toBe(200)
  const bookings = await readJson<StoredBooking[]>(response)
  expect(bookings).toHaveLength(1)
  return bookings[0]
}

// One Worker log line, as Cloudflare's observability API returns it (only the fields printed here).
interface WorkerLog {
  timestamp: number
  $metadata: {
    requestId?: string
    rayId?: string
    level?: string
    message?: string
    error?: string
  }
  // Set on the request's own log line, which is written once the request, and the work it left running, has finished.
  $workers?: { outcome?: string }
}

// The Worker's logs since `since` (epoch ms), oldest first.
const workerLogs = async (since: number) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queryId: `ccal-smoke-logs-${crypto.randomUUID()}`,
        timeframe: { from: since, to: Date.now() },
        limit: 500,
        view: "events",
        parameters: {
          filters: [
            {
              key: "$metadata.service",
              operation: "eq",
              type: "string",
              value: WORKER,
            },
          ],
        },
      }),
    }
  )
  expect(response.status, await response.clone().text()).toBe(200)
  const body: unknown = await response.json()
  // SAFETY: only printed; a field Cloudflare leaves out prints as blank.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { result } = body as { result: { events: { events?: WorkerLog[] } } }
  return (result.events.events ?? []).toSorted(
    (a, b) => a.timestamp - b.timestamp
  )
}

// The request log lines of this run's API requests, by ray id.
const requestLogLines = (logs: WorkerLog[]) =>
  new Map(
    logs
      .filter(
        (log) =>
          log.$workers?.outcome !== undefined &&
          rayIds.has(log.$metadata.rayId ?? "")
      )
      .map((log) => [log.$metadata.rayId, log])
  )

const formatLog = (log: WorkerLog) => {
  const time = new Date(log.timestamp).toISOString()
  const level = log.$metadata.level ?? "log"
  const outcome =
    log.$workers?.outcome === undefined ? "" : ` [${log.$workers.outcome}]`
  const text = log.$metadata.error ?? log.$metadata.message ?? ""
  return `${time} ${level}${outcome} ${text}`
}

// When the run started.
let startedAt = 0

// The version of the Worker's latest deployment: the one serving all its traffic.
const deployedVersion = async () => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER}/deployments`,
    { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } }
  )
  expect(response.status, await response.clone().text()).toBe(200)
  const body: unknown = await response.json()
  // SAFETY: a wrong shape leaves no version to find, which fails below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { result } = body as {
    result: {
      deployments: {
        versions: { version_id: string; percentage: number }[]
      }[]
    }
  }
  const version = result.deployments[0]?.versions.find(
    ({ percentage }) => percentage === 100
  )
  expect(version, "no version serves all of the Worker's traffic").toBeDefined()
  return version?.version_id
}

// The version serving `baseURL` right now.
const servedVersion = async (baseURL: string) => {
  const response = await fetch(new URL("/api/version", baseURL))
  noteRayId(response.headers.get("cf-ray"))
  expect(response.status).toBe(200)
  const { id } = await readJson<{ id: string }>(response)
  return id
}

// Playwright requires the fixtures argument to be destructured, even when unused.
// oxlint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? ""
  startedAt = Date.now()
  expect(API_KEY, "CCAL_API_KEY must be set").not.toBe("")
  expect(ADMIN_EMAIL, "ADMIN_EMAIL must be set").toContain("@")
  expect(CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID must be set").not.toBe(
    ""
  )
  expect(CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN must be set").not.toBe("")

  const deployed = await deployedVersion()
  await expect
    .poll(async () => await servedVersion(baseURL), {
      message: `waiting for ${baseURL} to serve version ${deployed}`,
      intervals: [2000],
      timeout: 60_000,
    })
    .toBe(deployed)
})

// Runs once at the end, even when the test fails, since that is when the logs matter most. Waits until every API
// request of the run has its request log line, then prints those requests' logs: other visitors' requests and the
// cron are left out.
test.afterAll(async () => {
  // A few seconds early, in case this machine's clock runs ahead of Cloudflare's.
  const since = startedAt - 5000
  let logs: WorkerLog[] = []
  let found = new Map<string | undefined, WorkerLog>()
  await expect
    .poll(
      async () => {
        logs = await workerLogs(since)
        found = requestLogLines(logs)
        return [...rayIds].filter((rayId) => !found.has(rayId))
      },
      { intervals: [2000], timeout: 60_000 }
    )
    .toEqual([])
    .catch(() => {
      const missing = [...rayIds].filter((rayId) => !found.has(rayId))
      console.log(
        `No log line showed up for these requests (ray ids): ${missing.join(", ")}`
      )
    })
  const requestIds = new Set(
    [...found.values()].map((log) => log.$metadata.requestId)
  )
  console.log(
    [
      `Worker logs (${WORKER}) for the ${found.size} of ${rayIds.size} API requests found:`,
      ...logs
        .filter((log) => requestIds.has(log.$metadata.requestId))
        .map(formatLog),
    ].join("\n")
  )
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
  noteRayId(testClock.headers()["cf-ray"])
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
