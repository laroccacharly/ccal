// Implements the scenarios in cal.test.md.
//
// There is no booking page yet, so this file defines the contract it must meet:
//   data-testid="month-label"      text like "September 2026"
//   data-testid="prev-month"       previous month arrow
//   data-testid="next-month"       next month arrow
//   data-testid="day"              one <button> per day, with data-date="YYYY-MM-DD";
//                                  "greyed out" means the button is disabled
//   data-testid="selected-date"    shows the currently selected date
//   data-testid="timezone-select"  <select> whose option values are IANA zones
//   data-testid="time-slot"        one <button> per time slot, text "HH:mm" (24h)
//   data-testid="confirm-button"   the "ok" button
//   data-testid="confirmation-page" root of the confirmation page

import { test, expect, type Page } from "@playwright/test";

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

function toMinutes(time: string) {
  const [hours, minutes] = time.trim().split(":").map(Number);
  return hours * 60 + minutes;
}

const monthLabelEl = (page: Page) => page.getByTestId("month-label");
const days = (page: Page) => page.getByTestId("day");
const day = (page: Page, date: string) => page.locator(`[data-testid="day"][data-date="${date}"]`);
const enabledDays = (page: Page) => page.locator('[data-testid="day"]:not([disabled])');
const selectedDate = (page: Page) => page.getByTestId("selected-date");
const timeSlots = (page: Page) => page.getByTestId("time-slot");
const timezoneSelect = (page: Page) => page.getByTestId("timezone-select");
const confirmButton = (page: Page) => page.getByTestId("confirm-button");

// Selects the first available date, moving to the next month if the current one has none left.
async function selectFirstAvailableDate(page: Page) {
  if ((await enabledDays(page).count()) === 0) await page.getByTestId("next-month").click();
  const first = enabledDays(page).first();
  const date = await first.getAttribute("data-date");
  await first.click();
  return date!;
}

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
});

test.describe("Date select", () => {
  test("shows the current month and year", async ({ page }) => {
    await expect(monthLabelEl(page)).toHaveText(monthLabel(new Date()));
  });

  test("greys out past days, today and tomorrow", async ({ page }) => {
    const tomorrow = isoDate(addDays(new Date(), 1));
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
    const [year, month, dayOfMonth] = date.split("-").map(Number);
    const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
    await expect(selectedDate(page)).toHaveText(`${monthName} ${dayOfMonth} ${year}`);
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
