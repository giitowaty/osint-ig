# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (plus a Tauri desktop build of the same web UI)

## Stack

Vite + React + TypeScript + shadcn/ui (style "Sera", per the user). Shared UI for the web build and the Tauri desktop shell. In Tauri the existing Node backend runs as a sidecar process; the web build talks to the same Node server. The Python `social_analytics` features (centralities, influence ranking) are to be ported into the app.

## Users

The owner, doing OSINT/research: analyzes many Instagram profiles in one session, compares them, and maps connections between accounts. Values data density, a visible log of what the tool is doing, and precise error diagnostics over polish for its own sake.

## Product Purpose

Analyze a public Instagram profile (stats, posts, content topics, interests, comment sentiment, estimated audience gender) and map relationships between accounts (tags, co-authors, mentions, follower/following lists) as a graph. Success: a researcher understands an account and its network quickly and knows exactly why a fetch failed when it does.

## Positioning

Runs locally with no runtime npm dependencies on the backend; audience gender is an explicitly labelled estimate from a PESEL-backed name dictionary, not fake demographics. Optional session-cookie fetching is opt-in and clearly warned.

## Operating Context

Local tool: `npm start` (web, http://localhost:8000) or the desktop app. Instagram fetching is best-effort and frequently rate-limited or login-walled, so failure states are a normal, frequent part of use. Exports: JSON, clipboard, print/PDF. History of analyzed profiles in local storage.

## Capabilities and Constraints

- Public profiles only; private ones expose no content.
- Endpoints: `/api/profile`, `/api/whoami`, `/api/list` (session cookie via `x-ig-session`, never stored server-side).
- Session-based scraping is against Instagram ToS and can get an account banned; UI must keep the warning to use a secondary account.
- Gender section must stay labelled as an estimate from a small sample.
- Bookmarklet collector and browser extension remain as alternatives that keep data in the user's browser.

## Evidence on Hand

No testimonials, users, or metrics exist; do not fabricate any. Name dictionary provenance: `api/data/pesel/PROVENANCE.md`.

## Product Principles

1. Show the work: every network step and failure is visible and specific.
2. Honest estimates: label heuristics as heuristics.
3. Local and private by default: cookies stay with the user.
4. Density over decoration: a research tool fills the screen with data.
