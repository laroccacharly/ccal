// Encode the captured frames into out/ccal.mp4 at a constant 60 fps, keeping their real timing.
import { fileURLToPath } from "node:url"

import { Schema } from "effect"

const fps = 60
const out = fileURLToPath(new URL("out/", import.meta.url))
const framesDir = `${out}frames/`

// Written by capture.test.ts: each frame's file and capture time, and when recording stopped, in seconds.
const Manifest = Schema.Struct({
  frames: Schema.Array(
    Schema.Struct({ file: Schema.String, time: Schema.Number })
  ),
  end: Schema.Number,
})

// Chrome only emits a frame when something repaints, so each one stays on screen until the next.
const { frames, end } = Schema.decodeUnknownSync(Manifest)(
  await Bun.file(`${framesDir}frames.json`).json()
)
const start = frames[0]?.time
const last = frames.at(-1)?.time
if (start === undefined || last === undefined || !(end > last)) {
  throw new Error("Invalid frame manifest")
}
const ticks = Math.round((end - start) * fps)

const ffmpeg = Bun.spawn(
  [
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-i",
    "-",
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "14",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-movflags",
    "+faststart",
    `${out}ccal.mp4`,
  ],
  { stdin: "pipe", stderr: "pipe" }
)
const stderr = new Response(ffmpeg.stderr).text()
let current = 0
for (let tick = 0; tick < ticks; tick += 1) {
  while (
    current + 1 < frames.length &&
    frames[current + 1].time <= start + tick / fps
  ) {
    current += 1
  }
  await ffmpeg.stdin.write(
    await Bun.file(framesDir + frames[current].file).bytes()
  )
  await ffmpeg.stdin.flush()
}
await ffmpeg.stdin.end()
if ((await ffmpeg.exited) !== 0) {
  throw new Error(`ffmpeg failed: ${await stderr}`)
}
console.log(
  `out/ccal.mp4 ready: ${(ticks / fps).toFixed(2)} seconds at ${fps} fps.`
)
