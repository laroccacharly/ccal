// Encode the captured frames into out/ccal.mp4 at a constant 60 fps, keeping their real timing.
import { fileURLToPath } from "node:url";

const fps = 60;
const out = fileURLToPath(new URL("./out/", import.meta.url));
const framesDir = `${out}frames/`;

// Chrome only emits a frame when something repaints, so each one stays on screen until the next.
const { frames, end }: { frames: { file: string; time: number }[]; end: number } =
  await Bun.file(`${framesDir}frames.json`).json();
const start = frames[0]?.time;
if (start === undefined || !(end > frames.at(-1)!.time)) throw new Error("Invalid frame manifest");
const ticks = Math.round((end - start) * fps);

const ffmpeg = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
  "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
  "-c:v", "libx264", "-preset", "slow", "-crf", "14",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-movflags", "+faststart", `${out}ccal.mp4`], { stdin: "pipe", stderr: "pipe" });
const stderr = new Response(ffmpeg.stderr).text();
let current = 0;
for (let tick = 0; tick < ticks; tick++) {
  while (frames[current + 1] && frames[current + 1]!.time <= start + tick / fps) current++;
  ffmpeg.stdin.write(await Bun.file(framesDir + frames[current]!.file).bytes());
  await ffmpeg.stdin.flush();
}
await ffmpeg.stdin.end();
if (await ffmpeg.exited !== 0) throw new Error(`ffmpeg failed: ${await stderr}`);
console.log(`out/ccal.mp4 ready: ${(ticks / fps).toFixed(2)} seconds at ${fps} fps.`);
