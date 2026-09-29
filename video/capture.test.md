# Simple UI walkthrough recording

Implemented by `capture.test.ts`. Records the real UI, using a fixed October 2026 date and intercepted APIs. No real booking is stored and no invite is sent. No CLI, title cards, captions, or time-zone detour.

1. Load the calendar with October 5, 7, and 9 available; wait for local fonts. Render a 1280×720 layout at 1.5× pixel density so every frame is a sharp 1920×1080 image.
2. Start recording only once the calendar is loaded, so the video opens on it with no loading frames.
3. Show a visible pointer gliding to October 7 and clicking it. Verify the selected date.
4. Glide to the first Montreal time slot and click. Verify 13:30 is selected and the continue button is enabled.
5. Click Ok and verify the confirmation page shows October 7 and 13:30.
6. Glide to and click each input, showing focus/caret, then type Alex Morgan, alex@example.com, and A quick introduction. character by character. Verify all values and the enabled Confirm button.
7. Click Confirm, verify the dialog, then click its OK button. Assert the mocked POST contains the contact details, 2026-10-07T17:30:00.000Z, and America/Toronto. Return a demo success response.
8. Verify the success page contains the selected date, time, and contact details; move the pointer aside and hold the result for three seconds.
9. Save every painted frame losslessly with its timestamp. Packaging turns them into a constant-frame-rate 1920×1080 video with the original timing. The pointer and small click pulses are recording-only overlays, never changes to the app itself. All video assets remain Git-ignored.
