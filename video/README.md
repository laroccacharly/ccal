# ccal UI walkthrough

A silent 1920×1080, 60 fps recording of the real ccal UI: pick a date and time, fill in the contact fields, confirm, and see the result. It uses mocked APIs and fictional contact details, so no booking is stored and no invite is sent.

## Rebuild

Requires Chromium (`bunx playwright install chromium`) and ffmpeg. From this folder:

```sh
bun run capture  # records the tested UI flow, then writes out/ccal.mp4
```

`capture.test.md` describes `capture.test.ts`; update both together, Markdown first. Everything in `out/` is generated and Git-ignored.
