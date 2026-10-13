export const LIST_PAGE_SIZE = 50

export function pageSlice<T>(items: readonly T[], requestedPage: number, size = LIST_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.max(0, Math.min(requestedPage, pages - 1))
  const offset = page * size
  return { items: items.slice(offset, offset + size), page, pages, offset }
}

export function duration(ms: number) {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}
