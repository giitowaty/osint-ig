import * as React from "react"
import { ImageOffIcon } from "lucide-react"

import { useApiBase } from "@/hooks/use-api-base"
import { imageUrl } from "@/lib/runtime"
import { cn } from "@/lib/utils"

/** Obrazek z CDN Instagrama ładowany przez proxy backendu, z czytelnym zastępnikiem. */
export function IgImage({
  src,
  alt = "",
  className,
  fallback,
}: {
  src: string
  alt?: string
  className?: string
  fallback?: React.ReactNode
}) {
  const base = useApiBase()
  const [failed, setFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  if (!src || failed || base === null) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
        title={failed ? "Nie udało się pobrać obrazka z CDN Instagrama" : undefined}
      >
        {fallback ?? <ImageOffIcon className="size-4 opacity-60" />}
      </div>
    )
  }
  return (
    <img
      src={imageUrl(base, src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={cn("bg-muted object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0", className)}
    />
  )
}
