/* Typy danych zwracanych przez backend (api/normalize.js, api/instagram.js). */

export type MediaType = "image" | "video" | "carousel"

export interface Profile {
  id?: string | null
  username: string
  fullName: string
  bio: string
  externalUrl: string
  avatar: string
  verified: boolean
  private: boolean
  category: string
  isBusiness?: boolean
  isProfessional?: boolean
  followers: number | null
  following: number | null
  posts: number | null
  highlights?: number | null
}

export interface Post {
  shortcode: string
  thumbnail: string
  type: MediaType
  isVideo: boolean
  views?: number | null
  takenAt?: number | null
  likes: number | null
  comments: number | null
  caption: string
  alt: string
  location?: string
  tagged: string[]
}

export interface FollowersPage {
  ok: boolean
  username: string
  userId: string
  users: { username: string; id: string }[]
  nextCursor: string | null
  limited: boolean
}

export interface Connection {
  username: string
  count: number
  kinds?: ("tag" | "mention")[]
}

export interface Hashtag {
  tag: string
  count: number
}

export interface Audience {
  available: boolean
  sampleSize: number
  female: number
  male: number
  unknown: number
  source: string
  sample?: {
    username: string
    fullName: string
    gender: "female" | "male" | "unknown"
    confidence: number
  }[]
}

export interface TopicScore {
  category: string
  hits: number
  share: number
}

export interface Topics {
  topics: TopicScore[]
  ranked: TopicScore[]
  [k: string]: unknown
}

export interface Interest {
  label: string
  kind: "kategoria" | "konto" | "hashtag"
  weight: number
}

export interface Classification {
  primary: string
  confidence: number
  labels: { label: string; reason: string }[]
}

export interface Sentiment {
  available: boolean
  reason?: string
  sampleSize: number
  positive: number
  neutral: number
  negative: number
  positivePct: number
  neutralPct: number
  negativePct: number
  tone: string
  examples?: { positive?: string; negative?: string }
}

export interface ProfilePayload {
  ok: true
  fetchedAt?: string
  ms?: number
  cached?: boolean
  cacheAgeMs?: number
  profile: Profile
  posts: Post[]
  connections: Connection[]
  hashtags?: Hashtag[]
  audience: Audience | null
  content: {
    topics: Topics | null
    interests: Interest[]
    classification: Classification | null
    sentiment: Sentiment | null
  } | null
}

export interface FriendList {
  ok: true
  username: string
  type: "followers" | "following"
  count: number
  users: string[]
  truncated: boolean
  pages?: number
  stopReason?: string
}

export interface Whoami {
  ok: true
  username: string
  fullName?: string
  avatar?: string
  userId?: string
  cookies?: string[]
}

/** Jedno znalezione konto IG w lokalnym Firefoksie. */
export interface FirefoxCandidate {
  profile: string
  userId: string | null
  names: string[]
  /** Gotowy nagłówek Cookie (sessionid=…; …) do przekazania jak przy „Wklej”. */
  cookie: string
  lastAccessed: number
}

export interface FirefoxImport {
  ok: boolean
  candidates: FirefoxCandidate[]
  error?: string
}

export interface Health {
  ok: true
  version: string
  node: string
  platform: string
  pid: number
  uptimeMs: number
  host: string
  port: number
  sea: boolean
  cooldown?: {
    active: boolean
    remainingMs: number
    strikes: number
    lastAt: string | null
    /** Stan per konto (klucz = userId / "anon"); obecne przy puli kont. */
    accounts?: Record<string, { active: boolean; remainingMs: number; strikes: number; lastAt: string | null }>
  }
  cache?: { entries: number; ttlMs: number }
}

/** Odpowiedź IG dołączana do błędu (bez cookie). */
export interface Upstream {
  method?: string
  url?: string
  finalUrl?: string
  redirected?: boolean
  status?: number
  statusText?: string
  ms?: number
  bytes?: number
  timeoutMs?: number
  headers?: Record<string, string>
  body?: string
  authenticated?: boolean
  /** Nazwy ciasteczek wysłanych do IG (bez wartości). */
  cookies?: string[]
}

export interface ApiErrorBody {
  code: string
  status?: number
  message: string
  hint?: string | null
  stage?: string | null
  detail?: string | null
  upstream?: Upstream | null
  job?: string
  ms?: number
  traceId?: string
  /** Po ilu ms Instagram powinien znów odpowiadać (rate limit). */
  retryAfterMs?: number | null
  /** Gdzie powstał błąd: serwer lokalny, IG, czy sama aplikacja. */
  origin?: "server" | "client"
  path?: string
}

export type TraceEvent =
  | {
      type: "step"
      id: string
      stage: string
      label: string
      status: "start" | "progress" | "ok" | "warn" | "error"
      ms?: number
      detail?: string
      t: number
      at: string
    }
  | {
      type: "log"
      level: "info" | "warn" | "error" | "debug"
      message: string
      data?: unknown
      t: number
      at: string
    }
  | {
      type: "progress"
      stage: string
      current: number
      total: number
      label?: string
      t: number
      at: string
    }
