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
//   data-testid="timezone-select"  <select> whose option values are IANA zones
//   data-testid="current-time"     text "Current time: HH:mm" (24h) in the selected zone
//   data-testid="time-slot"        one <button> per time slot, text "HH:mm" (24h)
//   data-testid="confirm-button"   the "ok" button
//   data-testid="confirmation-page" root of the confirmation page
//   data-testid="summary"          the booking summary: date, time and time zone
//   data-testid="meeting-link-message" note that the meeting link is sent once we confirm
//   labels "Name", "Email", "Description" the contact form fields
//   data-testid="name-error" / "email-error" / "description-error" validation messages
//   data-testid="submit-button"    the confirmation page's "Confirm" button
//   role="alertdialog"             the confirm dialog, with "OK" and "Cancel" buttons
//   data-testid="success-page"     root of the success page
//
// Clicking "OK" POSTs the booking to /api/booking-requests on the same origin as the UI.
// GET /api/booking-requests?email= reads back what was stored; it requires "Authorization: Bearer $CCAL_API_KEY".

import { test, expect, type Page, type Route } from "@playwright/test";

import type { BookingRequest, Contact } from "@ccal/shared";

const API_KEY = process.env.CCAL_API_KEY!;

const MONTREAL = "America/Toronto"; // IANA has no Montreal zone; it uses Toronto's
const PARIS = "Europe/Paris";
const VANCOUVER = "America/Vancouver";

function isoDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Minutes to add to a Vancouver wall-clock time to get the Paris one, on the given day.
function parisMinusVancouverMinutes(day: string) {
  const at = new Date(`${day}T12:00:00Z`);
  const offset = (timeZone: string) => {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")!.value; // e.g. "GMT-07:00"
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
  };
  return offset(PARIS) - offset(VANCOUVER);
}

// Date ("YYYY-MM-DD") and 24h time ("HH:mm") of an ISO datetime, as seen in `timeZone`.
function inZone(iso: string, timeZone: string) {
  const at = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at),
    time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
  };
}

// Current wall-clock time in `timeZone`, in minutes since midnight.
function nowInZoneMinutes(timeZone: string) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return toMinutes(time);
}

// Distance between two times of day in minutes, wrapping around midnight.
function minutesApart(a: number, b: number) {
  const diff = Math.abs(a - b) % (24 * 60);
  return Math.min(diff, 24 * 60 - diff);
}

function toMinutes(time: string) {
  const [hours, minutes] = time.trim().split(":").map(Number);
  return hours * 60 + minutes;
}

const monthLabelEl = (page: Page) => page.getByTestId("month-label");
const days = (page: Page) => page.getByTestId("day");
const day = (page: Page, date: string) => page.locator(`[data-testid="day"][data-date="${date}"]`);
const enabledDays = (page: Page) => page.locator('[data-testid="day"]:not([disabled])');
const selectedDate = (page: Page) => page.getByTestId("selected-date");
const noAvailableDays = (page: Page) => page.getByTestId("no-available-days");
const timeSlots = (page: Page) => page.getByTestId("time-slot");
const timezoneSelect = (page: Page) => page.getByTestId("timezone-select");
const confirmButton = (page: Page) => page.getByTestId("confirm-button");
const currentTime = (page: Page) => page.getByTestId("current-time");

async function expectCurrentTimeIn(page: Page, timeZone: string) {
  await expect(currentTime(page)).toHaveText(/^Current time: \d{2}:\d{2}$/);
  const shown = toMinutes((await currentTime(page).textContent())!.replace("Current time:", ""));
  expect(minutesApart(shown, nowInZoneMinutes(timeZone))).toBeLessThanOrEqual(1);
}

// Selects the first available date, moving to the next month if the current one has none left.
async function selectFirstAvailableDate(page: Page) {
  if ((await enabledDays(page).count()) === 0) await page.getByTestId("next-month").click();
  const first = enabledDays(page).first();
  const date = await first.getAttribute("data-date");
  await first.click();
  return date!;
}

// Books the first available slot in `timeZone` and returns what was selected.
async function goToConfirmation(page: Page, timeZone = MONTREAL) {
  const date = await selectFirstAvailableDate(page);
  await timezoneSelect(page).selectOption(timeZone);
  const slot = timeSlots(page).first();
  const time = (await slot.textContent())!;
  await slot.click();
  await confirmButton(page).click();
  await expect(page.getByTestId("confirmation-page")).toBeVisible();
  return { isoDate: date, date: formatSelectedDate(date), time, timeZone };
}

// "October 1 2026", from "2026-10-01"
function formatSelectedDate(date: string) {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
  return `${monthName} ${dayOfMonth} ${year}`;
}

const contact: Contact = { name: "Ada Lovelace", email: "ada@example.com", description: "Talk about the Analytical Engine" };

async function fillContact(page: Page, values: Partial<Contact> = {}) {
  const { name, email, description } = { ...contact, ...values };
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Description").fill(description);
}

const submitButton = (page: Page) => page.getByTestId("submit-button");
const confirmDialog = (page: Page) => page.getByRole("alertdialog");

async function slotTimes(page: Page) {
  return (await timeSlots(page).allTextContents()).map(toMinutes);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("load");
});

test.describe("Page load", () => {
  test("shows the meeting type", async ({ page }) => {
    await expect(page.locator("body")).toContainText("Google Meet");
  });

  test("uses a hash router on the form route", async ({ page }) => {
    await expect(page).toHaveURL(/#/);
    await expect(page).toHaveURL(/form/);
  });
});

test.describe("Date select", () => {
  test("shows the current month and year", async ({ page }) => {
    await expect(monthLabelEl(page)).toHaveText(monthLabel(new Date()));
  });

  test("greys out past days, today and tomorrow", async ({ page }) => {
    const tomorrow = isoDate(addDays(new Date(), 1));
    await expect(days(page).first()).toBeVisible();
    const dates = await days(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-date")!));
    const unavailable = dates.filter((date) => date <= tomorrow);
    expect(unavailable.length).toBeGreaterThan(0);
    for (const date of unavailable) await expect(day(page, date)).toBeDisabled();
  });

  test("clicking a greyed-out date does not change the selected date", async ({ page }) => {
    const before = await selectedDate(page).textContent();
    await day(page, isoDate(new Date())).click({ force: true });
    await expect(selectedDate(page)).toHaveText(before ?? "");
  });

  test("clicking an available date changes the selected date", async ({ page }) => {
    const before = await selectedDate(page).textContent();
    await selectFirstAvailableDate(page);
    await expect(selectedDate(page)).not.toHaveText(before ?? "");
  });

  test("next month arrow shows the next month", async ({ page }) => {
    const now = new Date();
    await page.getByTestId("next-month").click();
    await expect(monthLabelEl(page)).toHaveText(monthLabel(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  });

  test("selecting a date in the next month updates the selected date", async ({ page }) => {
    await page.getByTestId("next-month").click();
    const before = await selectedDate(page).textContent();
    await enabledDays(page).first().click();
    await expect(selectedDate(page)).not.toHaveText(before ?? "");
  });

  test('selected date has the format "Month Day Year"', async ({ page }) => {
    const date = await selectFirstAvailableDate(page);
    await expect(selectedDate(page)).toHaveText(formatSelectedDate(date));
  });

  test("next month arrow is disabled at 3 months out", async ({ page }) => {
    const next = page.getByTestId("next-month");
    for (let i = 0; i < 3; i++) {
      await expect(next).toBeEnabled();
      await next.click();
    }
    const now = new Date();
    await expect(monthLabelEl(page)).toHaveText(monthLabel(new Date(now.getFullYear(), now.getMonth() + 3, 1)));
    await expect(next).toBeDisabled();
  });

  test('shows a "No available days this month" banner when every day is disabled', async ({ page }) => {
    // The earliest bookable day is October 1, so every September day is disabled.
    await page.clock.install({ time: new Date("2026-09-29T10:00:00") });
    await page.goto("/");
    await expect(monthLabelEl(page)).toHaveText("September 2026");
    await expect(enabledDays(page)).toHaveCount(0);
    await expect(noAvailableDays(page)).toHaveText("No available days this month");
    // The banner is laid over the calendar days: its center falls between the first and last day.
    const banner = (await noAvailableDays(page).boundingBox())!;
    const firstDay = (await days(page).first().boundingBox())!;
    const lastDay = (await days(page).last().boundingBox())!;
    const bannerCenterY = banner.y + banner.height / 2;
    expect(bannerCenterY).toBeGreaterThan(firstDay.y);
    expect(bannerCenterY).toBeLessThan(lastDay.y + lastDay.height);
  });

  test('hides the "No available days this month" banner when some days are available', async ({ page }) => {
    // The earliest bookable day is October 3, so October still has available days.
    await page.clock.install({ time: new Date("2026-10-01T10:00:00") });
    await page.goto("/");
    await expect(monthLabelEl(page)).toHaveText("October 2026");
    await expect(enabledDays(page).first()).toBeVisible();
    await expect(noAvailableDays(page)).toBeHidden();
  });
});

test.describe("Time select", () => {
  test("time slots are greyed out until a date is selected", async ({ page }) => {
    for (const slot of await timeSlots(page).all()) await expect(slot).toBeDisabled();
    await selectFirstAvailableDate(page);
    for (const slot of await timeSlots(page).all()) await expect(slot).toBeEnabled();
  });

  test("shows 3 time slots", async ({ page }) => {
    await selectFirstAvailableDate(page);
    await expect(timeSlots(page)).toHaveCount(3);
  });

  test("default time zone is Montreal, Canada", async ({ page }) => {
    await expect(timezoneSelect(page)).toHaveValue(MONTREAL);
    await expect(timezoneSelect(page).locator("option:checked")).toContainText("Montreal");
  });

  test("time slots in Montreal are 13:30, 15:30 and 16:30", async ({ page }) => {
    await selectFirstAvailableDate(page);
    await expect(timeSlots(page)).toHaveText(["13:30", "15:30", "16:30"]);
  });

  test("switching the time zone updates the time slots", async ({ page }) => {
    const date = await selectFirstAvailableDate(page);

    await timezoneSelect(page).selectOption(VANCOUVER);
    await expect(timeSlots(page)).toHaveCount(3);
    const firstVancouverSlot = (await timeSlots(page).first().textContent()) ?? "";
    const vancouver = await slotTimes(page);

    await timezoneSelect(page).selectOption(PARIS);
    await expect(timeSlots(page).first()).not.toHaveText(firstVancouverSlot);
    const paris = await slotTimes(page);

    const shift = parisMinusVancouverMinutes(date);
    expect(paris).toEqual(vancouver.map((minutes) => (minutes + shift) % (24 * 60)));
  });

  test('shows "Current time: " for the selected time zone', async ({ page }) => {
    await expectCurrentTimeIn(page, MONTREAL);
  });

  test("current time follows the selected time zone", async ({ page }) => {
    await timezoneSelect(page).selectOption(PARIS);
    await expectCurrentTimeIn(page, PARIS);
    await timezoneSelect(page).selectOption(VANCOUVER);
    await expectCurrentTimeIn(page, VANCOUVER);
  });

  test("confirm button is disabled until a time slot is selected", async ({ page }) => {
    await expect(confirmButton(page)).toBeDisabled();
    await selectFirstAvailableDate(page);
    await expect(confirmButton(page)).toBeDisabled();
    await timeSlots(page).first().click();
    await expect(confirmButton(page)).toBeEnabled();
  });

  test("clicking confirm navigates to the confirmation page", async ({ page }) => {
    await selectFirstAvailableDate(page);
    await timeSlots(page).first().click();
    await confirmButton(page).click();
    await expect(page.getByTestId("confirmation-page")).toBeVisible();
  });
});

test.describe("Confirmation page", () => {
  test("url contains confirm", async ({ page }) => {
    await goToConfirmation(page);
    await expect(page).toHaveURL(/confirm/);
  });

  test("shows the selected date, time and time zone", async ({ page }) => {
    const { date, time } = await goToConfirmation(page, PARIS);
    const summary = page.getByTestId("summary");
    await expect(summary).toContainText(date);
    await expect(summary).toContainText(time);
    await expect(summary).toContainText("Paris, France");
  });

  test("explains that the meeting link is sent once we confirm", async ({ page }) => {
    await goToConfirmation(page);
    await expect(page.getByTestId("meeting-link-message")).toContainText(/meeting link will be sent.*confirm/i);
  });

  test("has Name, Email and Description fields", async ({ page }) => {
    await goToConfirmation(page);
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Description")).toBeVisible();
  });

  test("clicking confirm runs the form validations", async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page, { name: "<b>", email: "nope", description: " " });
    await submitButton(page).click();
    await expect(page.getByTestId("name-error")).toBeVisible();
    await expect(page.getByTestId("email-error")).toBeVisible();
    await expect(page.getByTestId("description-error")).toBeVisible();
    await expect(confirmDialog(page)).toBeHidden();
  });

  test("name must be non-empty", async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page, { name: "   " });
    await submitButton(page).click();
    await expect(page.getByTestId("name-error")).toBeVisible();
    await fillContact(page, { name: "Anne-Marie O'Neil" });
    await submitButton(page).click();
    await expect(page.getByTestId("name-error")).toBeHidden();
  });

  test("email must have a valid format", async ({ page }) => {
    await goToConfirmation(page);
    for (const email of ["ada", "ada@", "ada@example", "ada @example.com"]) {
      await fillContact(page, { email });
      await submitButton(page).click();
      await expect(page.getByTestId("email-error")).toBeVisible();
    }
    await fillContact(page);
    await submitButton(page).click();
    await expect(page.getByTestId("email-error")).toBeHidden();
  });

  test("description must be non-empty", async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page, { description: "   " });
    await submitButton(page).click();
    await expect(page.getByTestId("description-error")).toBeVisible();
    await fillContact(page);
    await submitButton(page).click();
    await expect(page.getByTestId("description-error")).toBeHidden();
  });

  test("every field rejects dangerous strings", async ({ page }) => {
    await goToConfirmation(page);
    const fields = [
      { label: "Name", key: "name" },
      { label: "Email", key: "email" },
      { label: "Description", key: "description" },
    ] as const;
    for (const { label, key } of fields) {
      for (const dangerous of ["<script>alert(1)</script>", "javascript:alert(1)", "{{7*7}}"]) {
        // Keep the value otherwise valid so only the dangerous string can trigger the error.
        const value = key === "email" ? `${dangerous}@example.com` : `${contact[key]} ${dangerous}`;
        await fillContact(page, { [key]: value });
        await submitButton(page).click();
        await expect(page.getByTestId(`${key}-error`), `${label}: ${value}`).toBeVisible();
        await expect(confirmDialog(page)).toBeHidden();
      }
      await fillContact(page);
      await submitButton(page).click();
      await expect(page.getByTestId(`${key}-error`)).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(confirmDialog(page)).toBeHidden();
    }
  });

  test("confirm button is disabled until all 3 fields are non-empty", async ({ page }) => {
    await goToConfirmation(page);
    await expect(submitButton(page)).toBeDisabled();
    await page.getByLabel("Name").fill(contact.name);
    await expect(submitButton(page)).toBeDisabled();
    await page.getByLabel("Email").fill(contact.email);
    await expect(submitButton(page)).toBeDisabled();
    await page.getByLabel("Description").fill(contact.description);
    await expect(submitButton(page)).toBeEnabled();
  });

  test("clicking confirm opens an alert dialog", async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    await expect(confirmDialog(page)).toBeVisible();
  });

  test('dialog shows the date and time, with "OK" and "Cancel" buttons', async ({ page }) => {
    const { date, time } = await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    await expect(confirmDialog(page)).toContainText(date);
    await expect(confirmDialog(page)).toContainText(time);
    await expect(confirmDialog(page).getByRole("button", { name: "OK" })).toBeVisible();
    await expect(confirmDialog(page).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test('clicking "Cancel" closes the dialog', async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    await confirmDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirmDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/confirm/);
  });

  test('clicking "OK" navigates to the success page', async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    await confirmDialog(page).getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("success-page")).toBeVisible();
  });

  test("the server's booking-request API, called with the API key, returns exactly one booking with the entered data", async ({ page, request }) => {
    // Tests share one server, so a unique email identifies this test's booking.
    const email = `ada+${test.info().testId}-${Date.now()}@example.com`;
    const { isoDate: date, time, timeZone } = await goToConfirmation(page, PARIS);
    await fillContact(page, { email });
    await submitButton(page).click();
    await confirmDialog(page).getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("success-page")).toBeVisible();

    const response = await request.get("/api/booking-requests", {
      params: { email },
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(response.ok()).toBe(true);
    const bookings: BookingRequest[] = await response.json();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      timeZone,
      name: contact.name,
      email,
      description: contact.description,
    });
    expect(inZone(bookings[0].startsAt, timeZone)).toEqual({ date, time });
  });

  test("the server's booking-request API rejects listing bookings without a valid API key", async ({ request }) => {
    // No key, a wrong key, and the right key without the "Bearer " scheme.
    const attempts: Record<string, string>[] = [{}, { Authorization: "Bearer wrong-key" }, { Authorization: API_KEY }];
    for (const headers of attempts) {
      const response = await request.get("/api/booking-requests", { headers });
      expect(response.status()).toBe(401);
    }
  });

  test("when the booking request fails, the dialog shows an error and the page stays on the confirmation page", async ({ page }) => {
    await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    const ok = confirmDialog(page).getByRole("button", { name: "OK" });

    // Covers both a server error response and the server being unreachable.
    const failures = [(route: Route) => route.fulfill({ status: 500 }), (route: Route) => route.abort("connectionrefused")];
    for (const fail of failures) {
      await page.unrouteAll();
      await page.route("**/api/booking-requests", fail);
      await ok.click();
      await expect(page.getByTestId("booking-error")).toBeVisible();
      await expect(confirmDialog(page)).toBeVisible();
      await expect(page).toHaveURL(/confirm/);
      await expect(page.getByTestId("success-page")).toBeHidden();
      await expect(ok).toBeEnabled();
    }
  });
});

test.describe("Success page", () => {
  async function goToSuccess(page: Page) {
    const selected = await goToConfirmation(page);
    await fillContact(page);
    await submitButton(page).click();
    await confirmDialog(page).getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("success-page")).toBeVisible();
    return selected;
  }

  test("url contains success", async ({ page }) => {
    await goToSuccess(page);
    await expect(page).toHaveURL(/success/);
  });

  test("shows the selected date and time, and the entered name, email and description", async ({ page }) => {
    const { date, time } = await goToSuccess(page);
    const success = page.getByTestId("success-page");
    for (const text of [date, time, contact.name, contact.email, contact.description]) await expect(success).toContainText(text);
  });
});
