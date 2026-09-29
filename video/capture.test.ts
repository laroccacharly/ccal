// Implements capture.test.md. Only mocked demo APIs; no real bookings or invites.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const framesDir = fileURLToPath(new URL("./out/frames/", import.meta.url));
const pointerStart = { x: 1100, y: 610 };

// Recording-only pointer and click pulses; never part of the shipped app.
const installPointer = (start: { x: number; y: number }) => {
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      #demo-pointer { position:fixed; left:0; top:0; z-index:2147483647; pointer-events:none;
        filter:drop-shadow(0 1px 2px #0004); will-change:transform; }
      .demo-click { position:fixed; width:32px; height:32px; margin:-16px 0 0 -16px;
        border:2px solid #555; border-radius:50%; pointer-events:none; z-index:2147483646;
        animation:demo-click-pulse .4s ease-out forwards; }
      @keyframes demo-click-pulse { from { opacity:.65; transform:scale(.35); }
        to { opacity:0; transform:scale(1.25); } }
    `;
    document.head.append(style);
    const pointer = document.createElement("div");
    pointer.id = "demo-pointer";
    pointer.innerHTML = '<svg width="24" height="30" viewBox="0 0 24 30"><path d="M2 2 L2 24 L8 18 L13 28 L17 26 L12 16 L21 16 Z" fill="white" stroke="#222" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const moveTo = (x: number, y: number) => { pointer.style.transform = `translate(${x}px, ${y}px)`; };
    moveTo(start.x, start.y);
    document.body.append(pointer);
    document.addEventListener("mousemove", (event) => moveTo(event.clientX, event.clientY));
    document.addEventListener("mousedown", (event) => {
      const pulse = document.createElement("div");
      pulse.className = "demo-click";
      pulse.style.left = `${event.clientX}px`;
      pulse.style.top = `${event.clientY}px`;
      document.body.append(pulse);
      pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
    });
  });
};

// Saves every frame Chrome paints, losslessly, with its timestamp.
const startRecording = async (page: Page) => {
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; time: number }[] = [];
  const writes: Promise<void>[] = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(5, "0")}.png`;
    frames.push({ file, time: metadata.timestamp ?? Date.now() / 1000 });
    writes.push(writeFile(`${framesDir}${file}`, Buffer.from(data, "base64")));
    void cdp.send("Page.screencastFrameAck", { sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1920, maxHeight: 1080 });
  return async () => {
    const end = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);
    expect(frames.length).toBeGreaterThan(0);
    await writeFile(`${framesDir}frames.json`, JSON.stringify({ frames, end }));
  };
};

test("record a simple UI booking workflow with pointer, clicks, and typing", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(installPointer, pointerStart);
  // Freeze Date, not timers: real movement, click animations, and caret blinking still run.
  await page.clock.setFixedTime(new Date("2026-10-01T14:00:00Z"));
  await page.route("**/api/availability", (route) => route.fulfill({
    json: { days: [5, 7, 9].map((day) => {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      return { date, slots: [17, 19, 20].map((hour) => `${date}T${hour}:30:00.000Z`) };
    }) },
  }));
  let submitted = false;
  await page.route("**/api/booking-requests", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      name: "Alex Morgan", email: "alex@example.com", description: "A quick introduction.",
      startsAt: "2026-10-07T17:30:00.000Z", timeZone: "America/Toronto",
    });
    submitted = true;
    await route.fulfill({ status: 201, json: { ok: true } });
  });

  // Intentional real-time pacing for the screencast, not synchronization sleeps.
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let pointer = pointerStart;
  // Time-based easing keeps the glide speed steady however long each move takes.
  const glide = async (to: { x: number; y: number }, duration = 650) => {
    const from = pointer;
    const started = performance.now();
    for (let t = 0; t < 1;) {
      t = Math.min(1, (performance.now() - started) / duration);
      const ease = t * t * (3 - 2 * t);
      await page.mouse.move(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
      await pause(8);
    }
    pointer = to;
  };
  const click = async (target: Locator) => {
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await glide(center);
    await pause(160);
    await page.mouse.click(center.x, center.y);
    await pause(450);
  };
  const type = async (label: string, value: string) => {
    const input = page.getByLabel(label, { exact: true });
    await click(input);
    await expect(input).toBeFocused();
    await input.pressSequentially(value, { delay: 80 });
    await expect(input).toHaveValue(value);
    await pause(350);
  };

  await page.goto("/");
  await expect(page.getByTestId("month-label")).toHaveText("October 2026");
  await expect(page.locator('[data-testid="day"]:not([disabled])')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const stopRecording = await startRecording(page);

  await pause(1200);
  await click(page.locator('[data-date="2026-10-07"]'));
  await expect(page.getByTestId("selected-date")).toHaveText("October 7 2026");
  await click(page.getByTestId("time-slot").first());
  await expect(page.getByTestId("time-slot").first()).toHaveText("13:30");
  await expect(page.getByTestId("time-slot").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("confirm-button")).toBeEnabled();
  await pause(600);
  await click(page.getByTestId("confirm-button"));
  await expect(page.getByTestId("confirmation-page")).toBeVisible();
  await expect(page.getByTestId("summary")).toContainText("October 7 2026");
  await expect(page.getByTestId("summary")).toContainText("13:30");
  await type("Name", "Alex Morgan");
  await type("Email", "alex@example.com");
  await type("Description", "A quick introduction.");
  await expect(page.getByTestId("submit-button")).toBeEnabled();
  await click(page.getByTestId("submit-button"));
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await pause(800);
  await click(dialog.getByRole("button", { name: "OK", exact: true }));
  await expect(page.getByTestId("success-page")).toBeVisible();
  for (const value of ["October 7 2026", "13:30", "Alex Morgan", "alex@example.com", "A quick introduction."]) {
    await expect(page.getByTestId("success-page")).toContainText(value);
  }
  expect(submitted).toBe(true);
  // Park the pointer away from the final summary.
  await glide({ x: 1000, y: 600 }, 900);
  await pause(3000);
  await stopRecording();
});
