import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { hydrate } from "@/lib/persist"

void hydrate()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="osint-ig-theme">
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)

// Tylko w trybie deweloperskim: dostęp do magazynu z konsoli (debugowanie, testy UI).
if (import.meta.env.DEV) {
  void import("@/lib/store").then((store) => {
    ;(window as unknown as { __osint: typeof store }).__osint = store
  })
}
