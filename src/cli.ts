#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ccal");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

const USAGE = `Usage:
  ccal login
  ccal meet create --email=<address> [--email=<address> ...]
                   [--title=<text>] [--start=<datetime>] [--duration=<minutes>]

  --start     ISO date-time, e.g. 2026-09-29T15:00 (local time). Default: now
  --duration  Length in minutes. Default: 30
  --title     Event title. Default: "Meeting"`;

type Token = { access_token: string; refresh_token: string; expires_at: number; email?: string };

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function clientCredentials() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) die("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the environment.");
  return { id, secret };
}

async function requestToken(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(params) });
  const body = await res.json();
  if (!res.ok) die(`Token request failed: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

function emailFromIdToken(idToken?: string) {
  if (!idToken) return undefined;
  return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).email;
}

async function saveToken(token: Token) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await Bun.write(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function login() {
  const { id, secret } = clientCredentials();
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const state = crypto.randomUUID();

  // Desktop OAuth clients accept any loopback port as the redirect URI.
  const { promise: codePromise, resolve, reject } = Promise.withResolvers<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/") return new Response("Not found", { status: 404 });
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code || url.searchParams.get("state") !== state) {
        reject(new Error(error ?? "invalid callback"));
        return new Response("Login failed. You can close this tab.");
      }
      resolve(code);
      return new Response("Logged in to ccal. You can close this tab.");
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}`;

  const authUrl = new URL(AUTH_URL);
  authUrl.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  console.log(`Opening your browser to log in. If it does not open, visit:\n${authUrl}\n`);
  Bun.spawn(["xdg-open", authUrl.toString()], { stdout: "ignore", stderr: "ignore" });

  let code: string;
  try {
    code = await codePromise;
  } catch (e) {
    die(`Login failed: ${(e as Error).message}`);
  } finally {
    server.stop();
  }

  const body = await requestToken({
    grant_type: "authorization_code",
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!body.refresh_token) die("Google did not return a refresh token; try `ccal login` again.");

  const email = emailFromIdToken(body.id_token);
  await saveToken({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
    email,
  });
  console.log(`Logged in${email ? ` as ${email}` : ""}.`);
}

async function accessToken() {
  const file = Bun.file(TOKEN_FILE);
  if (!(await file.exists())) die("Not logged in. Run `ccal login` first.");
  const token: Token = await file.json();
  if (Date.now() < token.expires_at - 60_000) return token.access_token;

  const { id, secret } = clientCredentials();
  const body = await requestToken({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: id,
    client_secret: secret,
  });
  await saveToken({ ...token, access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 });
  return body.access_token as string;
}

async function meetCreate(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: "string", multiple: true },
      title: { type: "string", default: "Meeting" },
      start: { type: "string" },
      duration: { type: "string", default: "30" },
    },
  });
  const emails = values.email ?? [];
  if (emails.length === 0) die(`At least one --email is required.\n\n${USAGE}`);

  const start = values.start ? new Date(values.start) : new Date();
  if (Number.isNaN(start.getTime())) die(`Invalid --start: ${values.start}`);
  const minutes = Number(values.duration);
  if (!Number.isFinite(minutes) || minutes <= 0) die(`Invalid --duration: ${values.duration}`);
  const end = new Date(start.getTime() + minutes * 60_000);

  const url = new URL(EVENTS_URL);
  url.searchParams.set("conferenceDataVersion", "1"); // required for Google to create the Meet link
  url.searchParams.set("sendUpdates", "all"); // Google emails the invite to every attendee

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: values.title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: emails.map((email) => ({ email })),
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    }),
  });
  const event = await res.json();
  if (!res.ok) die(`Creating the event failed: ${event.error?.message ?? res.status}`);

  console.log(event.hangoutLink ?? "(no Meet link was returned)");
  console.error(`Invite sent to ${emails.join(", ")} for ${start.toLocaleString()}.`);
}

const [command, sub, ...rest] = process.argv.slice(2);
if (command === "login") await login();
else if (command === "meet" && sub === "create") await meetCreate(rest);
else die(USAGE);
