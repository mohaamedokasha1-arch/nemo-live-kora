# Match Detail 404 — Root-Cause Fix (2026-10-17)

## Symptom

Clicking any match card in the schedule opened `الصفحة غير موجودة` (the local 404 page) at
`/matches/[id]`, for matches listed on the homepage/schedule of NEMO Sports (SportScore /
TheSportsDB data).

## Root cause

`app/matches/[id]/page.tsx` resolved the match id **only from the store snapshot**
(`hydrateStore()` → `findMatchRecordById()`), without refreshing and without any provider
lookup. Two compounding facts made this fail in production while passing locally:

1. Schedule pages call `ensureFreshMatches()` and therefore render **freshly synced** matches
   whose ids (e.g. `match-thesportsdb-2561134`) are not in the bundled seed snapshot
   `data/gateway-store.json`.
2. On serverless (Vercel) the writable snapshot lives in per-instance `/tmp`; a **cold
   instance** serving the detail request seeds from the bundled snapshot only. The freshly
   synced id is unknown there → `notFound()` → 404 for a match that exists in the schedule
   and at the provider.

A secondary defect amplified the blast radius: `lib/sources/thesportsdb.ts` and
`lib/sources/api-football.ts` froze `SOURCE_ENDPOINTS.*` into module-level `const`s at import
time — the opposite of the live-getter contract documented in `lib/config/env.ts` — so any
runtime endpoint override was silently ignored (this also made provider-mocking in tests
impossible).

## Fix (all on `arena/fc3b17e0-nemo-live-kora`)

| Area | Change |
| --- | --- |
| `lib/matches/match-id-hints.ts` (new) | Pure parser: `match-api-football-<n>`, `match-thesportsdb-<n>`, `match-football-data-<n>`, `match-sportscore-<slug\|tracker>`, `match-synthetic-*`, unknown. |
| `lib/matches/resolve-match.ts` (new) | One resolution pipeline used by **both** `generateMetadata` and the page body (metadata can never disagree with content): catalog → store (duplicate-aware) → `ensureFreshMatches()` retry → **targeted provider recovery by id** → graceful outcome. |
| `lib/sources/thesportsdb.ts` | `fetchTheSportsDBEventById()` via `lookupevent.php?id=`; endpoint base now read **live** per call. |
| `lib/sources/api-football.ts` | `fetchApiFootballFixtureById()` via `GET /fixtures?id=`; endpoint base now read **live** per call. |
| `app/matches/[id]/page.tsx` | Record branch now self-heals; recovered records are upserted into the store (next hit is sync); date branch passes `landingPaths` to the client (SSR/CSR consistency). |
| `components/MatchUnavailableView.tsx` (new) | Honest, useful fallback for provider-backed ids whose data cannot be fetched (HTTP 200 + `noindex`, links to schedule/news). Unknown junk ids still hard-404 — no soft-404 pages. |
| `app/live/[matchId]`, `app/match/[id]` | Real match ids from any provider **redirect (307)** to `/matches/[id]` instead of 404; legacy hard-coded fixtures keep their exact old UI (`components/LegacyMatchDetail.tsx`), unknown ids still 404 (preserves `tests/seo-preservation.test.ts`). |
| `components/MatchLandingView.tsx` | Renders `أحداث المباراة` (goals/cards/subs) when — and only when — the source record carries `incidents`. |
| `next.config.mjs` | `allowedDevOrigins` for `*.e2b.app` preview hosts (dev HMR was blocked cross-origin). |

## Recovery pipeline (production order)

1. `data/matches.ts` catalog + admin manual matches (bundled — always present).
2. Store snapshot, duplicate-aware (`duplicateOfId` → survivor record; catalog match →
   canonical redirect).
3. `ensureFreshMatches()` (same freshness window as the schedule) then re-read — this is the
   step that heals cold instances for anything inside the sync window.
4. Targeted provider fetch by the external id embedded in the URL (TheSportsDB
   `lookupevent.php?id=`, API-Football `GET /fixtures?id=`); the fetched record is upserted
   (strong-identity dedup keeps a single record) and served immediately.
5. Provider-backed id still missing → `MatchUnavailableView` (200, `noindex`).
   Unrecognized id → real `notFound()`.

## Evidence

Local verification with a mock TheSportsDB provider (`lookupevent.php`), cold-store
conditions (`NEMO_GATEWAY_STORE_PERSIST=off`, no writable snapshot):

| Probe | Before | After |
| --- | --- | --- |
| `/matches/match-thesportsdb-9900001` (fresh id, absent from seed) | 404 | **200** — full match (score 2:1, venue, status) from provider, second hit 0.12s from store |
| `/matches/match-thesportsdb-4242424` (provider has no such event) | 404 | **200** `تفاصيل المباراة غير متاحة حالياً` + `noindex` |
| `/matches/random-junk-xyz` | 404 | 404 (kept honest) |
| `/matches/match-api-football-1612263` (record with catalog page) | 200 soft | **307** → `/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20` |
| `/match/match-api-football-1612249` (old route) | 404 | **307** → `/matches/match-api-football-1612249` |
| `/live/match-api-football-1570413` (record id) | 404 | **307** → details page (carries the watch CTA) |

Automated coverage added:

- `tests/match-detail-routing.test.ts` — 14 cases: id parsing per provider, store/catalog/
  alias resolution, duplicate-survivor reads, injected provider recovery + merge-into-
  existing, fallback UI copy, legacy `/match/[id]` gate + redirect, unknown-id 404 contract.
- `tests/match-recovery-provider.test.ts` — 2 integration cases against an in-process mock
  HTTP provider (no external network): full recovery round-trip incl. persistence, and the
  provider-miss fallback contract.

Suite: **351 tests, 0 failures** (`npm test`); `npm run lint`, `npm run typecheck`,
`npm run build`, `npm run audit:prod` all clean.

## Reproduce

```bash
npm ci
npm test                                   # includes the two new files above
THESPORTSDB_BASE_URL=http://127.0.0.1:<mock>/api/v1/json \
NEMO_GATEWAY_STORE_PERSIST=off npm run dev  # mock serves lookupevent.php?id=9900001
curl -i localhost:3000/matches/match-thesportsdb-9900001   # 200 recovered match
curl -i localhost:3000/matches/match-thesportsdb-4242424   # 200 fallback (noindex)
curl -i localhost:3000/matches/random-junk-xyz             # 404
```

## Notes / non-goals

- Lineups and possession/stats are **not** invented: the current source adapters expose
  score/status/incidents only, and the UI states honestly when extra data is unavailable
  (repository-wide "no invented data" rule).
- Durable cross-instance storage (KV/blob) remains an infrastructure option; this fix removes
  the dependency on it for detail pages — every instance now self-heals per request.
- The unused legacy card `components/matches/MatchCard.tsx` still targets `/match/[id]`;
  since that route now delegates real ids to `/matches/[id]`, old links land correctly
  (kept as-is per `docs/SEO-AUDIT-2026-10-17.md`).
