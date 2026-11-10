// The Worker runs under `alchemy dev` for the end-to-end tests. Alchemy records each run in its own
// .alchemy/log/<time>-pid<pid>.ndjson, the Worker's console output included. Reading it back lets a test see background
// errors that never reach an HTTP response, such as a failed admin email. In production the same errors go to
// Cloudflare's Workers Logs (query them with `ccf worker errors`).
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { Schema } from "effect"

// The stage the e2e Playwright config runs `alchemy dev` with.
const STAGE = "e2e"

const LOG_DIR = path.join(process.cwd(), ".alchemy", "log")

// The fields of a log record this reads: the run's arguments on its first record, then the Worker's output.
const LogRecord = Schema.fromJsonString(
  Schema.Struct({
    time: Schema.Finite,
    kind: Schema.String,
    attributes: Schema.optional(
      Schema.Struct({ fqn: Schema.optional(Schema.String) })
    ),
    data: Schema.optional(
      Schema.Struct({
        argv: Schema.optional(Schema.Array(Schema.String)),
        text: Schema.optional(Schema.String),
      })
    ),
  })
)
type LogRecord = typeof LogRecord.Type

const parseRecords = (contents: string): LogRecord[] =>
  contents
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => Schema.decodeSync(LogRecord)(line))

const isStageRun = (records: LogRecord[]) => {
  const argv = records.find((record) => record.kind === "run")?.data?.argv ?? []
  return argv.includes("--stage") && argv.includes(STAGE)
}

const workerOutputSince = (records: LogRecord[], since: number) =>
  records
    .filter(
      (record) =>
        record.kind === "output" &&
        record.attributes?.fqn === "Worker" &&
        record.time >= since
    )
    .map((record) => record.data?.text ?? "")

const logFilesWrittenSince = async (since: number) => {
  const names = await readdir(LOG_DIR).catch((): string[] => [])
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".ndjson"))
      .map(async (name) => {
        const filePath = path.join(LOG_DIR, name)
        const { mtimeMs } = await stat(filePath)
        return { filePath, mtimeMs }
      })
  )
  return files
    .filter(({ mtimeMs }) => mtimeMs >= since)
    .map(({ filePath }) => filePath)
}

// Every line the Worker logged since `since` (epoch ms) under the e2e stage.
export const workerLogLinesSince = async (since: number): Promise<string[]> => {
  const lines: string[] = []
  for (const filePath of await logFilesWrittenSince(since)) {
    const records = parseRecords(await readFile(filePath, "utf-8"))
    if (isStageRun(records)) {
      lines.push(...workerOutputSince(records, since))
    }
  }
  return lines
}
