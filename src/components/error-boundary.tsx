import * as React from "react"

import { ErrorPanel } from "@/components/error-panel"
import { log } from "@/lib/store"

/**
 * Granica błędów: wyjątek w jednym widoku pokazuje diagnostykę w miejscu
 * widoku (z możliwością ponowienia), zamiast wywracać całą aplikację.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; scope: string; resetKey?: unknown },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log("error", "app", `Błąd interfejsu (${this.props.scope}): ${error.message}`, {
      detail: info.componentStack?.split("\n").slice(0, 4).join(" ").trim(),
    })
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    // Zmiana widoku/profilu czyści błąd: użytkownik nie utknie na ekranie awarii.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="p-4 xl:p-5">
        <ErrorPanel
          error={{
            code: "UI_CRASH",
            origin: "client",
            message: `Widok „${this.props.scope}” uległ awarii.`,
            hint: "Pozostałe części aplikacji działają. Spróbuj ponownie; jeśli błąd wraca, skopiuj diagnostykę.",
            detail: `${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 6).join("\n")}`,
          }}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    )
  }
}
