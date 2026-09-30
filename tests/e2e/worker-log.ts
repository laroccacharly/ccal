// The Worker runs under `alchemy dev` for the end-to-end tests, and writes its console output to one file per
// workerd generation under .alchemy/log/<stage>/Worker. Reading it back lets a test see background errors that never
// reach an HTTP response, such as a failed admin email. In production the same errors go to Cloudflare's Workers
// Logs (query them with `ccf worker errors`).
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

// The stage the e2e Playwright config runs `alchemy dev` with.
const STAGE = "e2e"

// Every line the Worker logged since `since` (epoch ms), from the oldest written file first.
export const workerLogLinesSince = async (since: number): Promise<string[]> => {
  const dir = path.join(process.cwd(), ".alchemy", "log", STAGE, "Worker")
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(dir, name)
      const { mtimeMs } = await stat(filePath)
      return { filePath, mtimeMs }
    })
  )
  const lines: string[] = []
  for (const { filePath } of files
    .filter(({ mtimeMs }) => mtimeMs >= since)
    .toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
    const contents = await readFile(filePath, "utf-8")
    lines.push(...contents.split("\n"))
  }
  return lines
}
