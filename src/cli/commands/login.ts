import { AUTH_URL, clientCredentials, GoogleError, requestToken, SCOPES } from "@ccal/shared/google"
import { Console, Deferred, Effect } from "effect"
import { Command } from "effect/unstable/cli"

import { googleLoginFromResponse, saveGoogleLogin } from "../../local/google-login"

const emailFromIdToken = (idToken?: string): string | undefined =>
  idToken ? JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).email : undefined

// Desktop OAuth clients accept any loopback port as the redirect URI.
const callbackServer = (state: string, code: Deferred.Deferred<string, GoogleError>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname !== "/") return new Response("Not found", { status: 404 })
          const error = url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error || !value || url.searchParams.get("state") !== state) {
            Deferred.doneUnsafe(code, Effect.fail(new GoogleError({ detail: `Login failed: ${error ?? "invalid callback"}` })))
            return new Response("Login failed. You can close this tab.")
          }
          Deferred.doneUnsafe(code, Effect.succeed(value))
          return new Response("Logged in to ccal. You can close this tab.")
        },
      }),
    ),
    (server) => Effect.sync(() => server.stop()),
  )

export const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* login() {
    const { id } = yield* clientCredentials
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const challenge = Buffer.from(
      yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    ).toString("base64url")
    const state = crypto.randomUUID()

    const deferred = yield* Deferred.make<string, GoogleError>()
    const { code, redirectUri } = yield* Effect.scoped(
      Effect.gen(function* awaitCallback() {
        const server = yield* callbackServer(state, deferred)
        const callbackUrl = `http://127.0.0.1:${server.port}`
        const authUrl = new URL(AUTH_URL)
        authUrl.search = new URLSearchParams({
          client_id: id,
          redirect_uri: callbackUrl,
          response_type: "code",
          scope: SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString()

        yield* Console.log(`Opening your browser to log in. If it does not open, visit:\n${authUrl}\n`)
        Bun.spawn(["xdg-open", authUrl.toString()], { stdout: "ignore", stderr: "ignore" })
        return { code: yield* Deferred.await(deferred), redirectUri: callbackUrl }
      }),
    )

    const body = yield* requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    if (!body.refresh_token) {
      return yield* new GoogleError({ detail: "Google did not return a refresh token; try `ccal login` again." })
    }
    const email = emailFromIdToken(body.id_token)
    yield* saveGoogleLogin(googleLoginFromResponse(body, email))
    yield* Console.log(`Logged in${email ? ` as ${email}` : ""}.`)
  }),
).pipe(Command.withDescription("Log in with Google"))
