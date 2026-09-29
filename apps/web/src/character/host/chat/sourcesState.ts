export type Source = { url: string; title: string; host: string }

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export function faviconUrl(host: string): string | null {
  const safe = host.trim().toLowerCase()
  return HOST.test(safe) ? `https://icons.duckduckgo.com/ip3/${safe}.ico` : null
}

export function isHttpsSource(source: Pick<Source, 'url'>): boolean {
  try {
    return new URL(source.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function mergeSources(groups: readonly (readonly Source[] | undefined)[]): Source[] {
  const seen = new Set<string>()
  const result: Source[] = []

  for (const group of groups) {
    for (const source of group ?? []) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      result.push(source)
      if (result.length === 12) return result
    }
  }

  return result
}
