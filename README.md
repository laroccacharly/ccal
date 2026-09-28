# ccal 

Assume .env.example var are in shell env 

ccal login, to login with google 
ccal meet create --email=test@example.com, create a meeting link for that person and send the email. 

## Setup

1. In the Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** (External) and add your Google account as a test user.
   While the app is in "Testing" mode Google expires the login after 7 days; publish it
   ("In production") to keep it indefinitely.
3. Create an **OAuth client ID** of type **Desktop app** and put its ID and secret in
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. `bun install && bun link` to put `ccal` on your PATH, then `ccal login`.

The login token is stored in `~/.config/ccal/token.json`.

## Options for `ccal meet create`

- `--email` — attendee, repeat for several people (required)
- `--title` — event title, default "Meeting"
- `--start` — e.g. `2026-09-29T15:00` in local time, default now
- `--duration` — minutes, default 30

Google sends the invite email itself (with the Meet link); the link is also printed to stdout.
