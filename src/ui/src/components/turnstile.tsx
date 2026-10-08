import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

// The subset of Cloudflare's Turnstile client API this component uses.
interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      size: "flexible"
      theme: "dark"
      callback: (token: string) => void
      "error-callback": () => void
      "expired-callback": () => void
    }
  ) => string | undefined
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

// Shared by every widget, so the script loads once. A failed load is forgotten, so a retry loads it again.
let script: Promise<TurnstileApi> | undefined

const loadTurnstile = async () => {
  if (script === undefined) {
    const { promise, resolve, reject } = Promise.withResolvers<TurnstileApi>()
    const element = document.createElement("script")
    const fail = () => {
      element.remove()
      script = undefined
      reject(new Error("Turnstile failed to load"))
    }
    element.src = SCRIPT_URL
    element.async = true
    element.addEventListener("load", () => {
      if (window.turnstile === undefined) {
        fail()
      } else {
        resolve(window.turnstile)
      }
    })
    element.addEventListener("error", fail)
    document.head.append(element)
    script = promise
  }
  return await script
}

interface Props {
  onToken: (token: string | null) => void
}

// One widget's lifetime; a retry remounts it with fresh state.
const Widget = ({ onToken, onRetry }: Props & { onRetry: () => void }) => {
  const container = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState("Verifying…")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let widgetId: string | undefined
    const fail = () => {
      onToken(null)
      setStatus("Verification failed or expired. Please retry.")
      setFailed(true)
    }
    const render = async () => {
      let turnstile: TurnstileApi
      try {
        turnstile = await loadTurnstile()
      } catch {
        if (active) {
          fail()
        }
        return
      }
      if (!active || container.current === null) {
        return
      }
      widgetId = turnstile.render(container.current, {
        // Always set: the build fails without it.
        sitekey: import.meta.env.TURNSTILE_SITE_KEY,
        action: "booking",
        // Fills the container width at a fixed 65px height, instead of the compact square.
        size: "flexible",
        // Match the dark-only page, regardless of the OS preference.
        theme: "dark",
        callback: (token) => {
          onToken(token)
          setStatus("Verification complete")
          setFailed(false)
        },
        "error-callback": fail,
        "expired-callback": fail,
      })
    }
    void render()
    // A token must not outlive its widget, e.g. when the dialog closes or a retry replaces it.
    return () => {
      active = false
      if (widgetId !== undefined) {
        window.turnstile?.remove(widgetId)
      }
      onToken(null)
    }
  }, [onToken])

  return (
    <div data-testid="turnstile" className="flex flex-col items-center gap-2">
      {/* Reserves the widget's height so the dialog does not jump when it renders. */}
      <div ref={container} className="min-h-[65px] w-full" />
      <output className="text-muted-foreground text-center text-sm">
        {status}
      </output>
      {failed && (
        <Button variant="outline" onClick={onRetry}>
          Retry verification
        </Button>
      )}
    </div>
  )
}

export const Turnstile = ({ onToken }: Props) => {
  const [attempt, setAttempt] = useState(0)
  return (
    <Widget
      key={attempt}
      onToken={onToken}
      onRetry={() => {
        setAttempt((value) => value + 1)
      }}
    />
  )
}
