# Deep audit — 2026-10-12 (branch `arena/00632731-nemo-live-kora`)

Scope: production verification, PR #6 review, broadcast CTA destination, Egyptian league
ingestion, news, SEO, and analytics readiness. Main site `mohaamedokasha1-arch/sport` was read
only and is not modified.

## 1. Environment limits (read this first)

- The sandbox cannot reach `nemo-sports.vercel.app`, `nemo-live-kora-matchat.vercel.app`,
  `news.google.com`, SportScore, or TheSportsDB over bash HTTP. A local `next start` run
  recorded `fetch failed` for both match sources (`meta.lastMatchesSyncResult`).
- TheSportsDB was read through the fetch tool. Those captures are in `tests/fixtures/thesportsdb/`.
- Every HTTP check of production is **pending an external run**. Nothing here proves live
  production behaviour.

## 2. Broken issues — evidence and status

| # | Issue | Evidence | Status |
|---|---|---|---|
| B1 | Broadcast CTA pointed at `/matches/{slug}#live-stream`, not `/watch` | `lib/nemo-resolver.ts` (PR #6); main-site `app/matches/[slug]/page.tsx` renders `#live-stream` for every match, so the anchor is a section, not a stream | Fixed: every CTA → `https://nemo-sports.vercel.app/watch` |
| B2 | Unlinked cards said "لا يتوفر رابط بث" | `components/MatchCard.tsx` (PR #6) | Fixed: every card links to `/watch` with the label "قسم البث العام على NEMO Sports" |
| B3 | League 4830 is "Korean KBO League" (baseball) but mapped to Egypt Cup | `lookupleague.php?id=4830` → "Korean KBO League"; `eventsnextleague.php?id=4830` → `events: null`; catalog `thesportsdbId: '4830'` on EGY_CUP | Fixed: removed from follow list, excluded by id, removed from catalog mapping |
| B4 | Fabricated kick-off: `${dateEvent}T${strTime \|\| '16:00:00'}Z` | `lib/sources/thesportsdb.ts` (PR #6) | Fixed: no guessed time; record flagged `kickoffConfirmed: false`, shown as "الموعد غير مؤكد" |
| B5 | One malformed SportScore `time` discarded the whole batch | `mapSportScoreMatchToRecord` threw on `new Date('not-a-date').toISOString()`; `isolateSource` dropped the batch | Fixed: per-record validation and skip count |
| B6 | Stale provider "live" stayed live for up to 6 h after kick-off | `normalizeMatchStatus` window 6 h; `guardStaleLiveStatus` checked only `lastUpdatedAt`, which every sync resets | Fixed: plausible window 180 min after kick-off; live also requires known kick-off |
| B7 | `not_started` stayed "لم تبدأ بعد" after kick-off | Snapshot: Mokawloon vs ZED (kick-off 14:00Z, 2026-10-12) stored `not_started`; TheSportsDB round 6: FT 1-1 | Fixed: 15-minute grace, then "بانتظار تأكيد الحالة"; FT merges over stale record |
| B8 | Free-tier coverage: next/past return 1 event, `eventsday` caps at 3, so day/past miss round-6 results | Captured `eventspastleague` (1 event), `eventsday` (3 events); round 6 has 6 events | Fixed for the Egyptian league: `eventsround.php` per round (window = stored season's highest round −1..+1). Coverage gap remains for other leagues (see §5) |
| B9 | TheSportsDB chain ran sequentially with no time bound on the request path | `fetchTheSportsDBMatches` loop, 7 s timeout, 1 retry | Fixed in quick mode: 4 s timeout, no retry, 8 s total budget; skipped endpoints are recorded |
| B10 | Test runs rewrote committed `data/gateway-store.json` | `npm test` persisted the store | Fixed: `npm test` sets `NEMO_GATEWAY_STORE_PERSIST=off`; the cron test opts back in on its temp copy |
| B11 | News: all six stored items `rejected` | Snapshot items have `originalUrl` = `news.google.com/rss/search?q=…` (seed data stored the feed URL as the item link); last RSS sync `ok:false`, `httpStatus:null` | Cause identified: seed data plus failed fetch, not the validator (which correctly rejects search URLs). Live relay resolution remains unverified (§4) |
| B12 | Per-match links in `/sources` diagnostics and news related lists | `app/sources/page.tsx`, `app/news/[slug]/page.tsx`, `lib/news/match-linker.ts` | Fixed: `/watch` only, or plain text |
| B13 | JSON-LD `SportsEvent.url` pointed at per-match pages | `lib/seo/match-structured-data.ts` | Fixed: no per-match `url` |

## 3. PR #6 — fixed vs remaining

Fixed on this branch: B1–B10, B12, B13 (above).

Remaining:
- Egypt Cup (4830 successor) has **no verified TheSportsDB soccer id**. `search_all_leagues.php?c=Egypt` lists only 4829 and 5185. The Egypt Cup is not ingested from TheSportsDB. SportScore covers only the sources it already had; this was not expanded.
- `data/gateway-store.json` still contains the old `direct_match` / `competition_fallback` objects. Migration recomputes `nemoLink` on load, so behaviour is correct, but the file on disk is stale.
- Production behaviour after deploy is unverified (hosts unreachable).
- `THESPORTSDB_API_KEY` defaults to `3`. TheSportsDB documents `123` as the free key. Set the variable explicitly.
- Only `/api/cron/update-matches` is in `vercel.json`. `/api/cron/sync` and `/api/cron/sync-news` exist but are not scheduled.

## 4. News

- **Cause of the six `rejected` items:** the snapshot stores the RSS search-feed URL as each item's link, and the items have empty excerpts. The validator correctly rejects these as `invalid_url`. Seed data (`lib/db/seed-data.ts`) created these records, not a live article fetch.
- **Resolver behaviour (reproduced with a synthetic RSS item, `tests/fixtures/google-news/`):** a relay that answers 200 HTML with no `Location` header stays unresolved and is rejected. A relay that answers 302 to a publisher URL resolves.
- **Not verified:** whether Google News relay links resolve in production. News ingestion was not run live.
- **Decision:** no fabricated items. Public pages show only `published` items. The existing empty state ("لا توجد أخبار جديدة مؤكدة للعرض حاليًا") is kept. Google search and relay URLs are never displayed.
- **Not changed:** the six seeded rejected rows remain in the snapshot. They are not public.

## 5. League coverage

| Competition | TheSportsDB id | Status |
|---|---|---|
| Egyptian Premier League | 4829 | Verified name. Fetched per round (`eventsround`). |
| Egypt League Cup | 5185 | Verified name. Next/past/day only (1–3 events per call). |
| CAF Confederation Cup | 5057 | Verified name. Next/past/day only. |
| Egypt Cup | none verified | Gap. 4830 is KBO baseball. |

## 6. `/watch` link tests

Covered in `tests/broadcast-link-and-sync.test.ts` and `tests/audit-2026-10-12.test.ts`:
- Clean URL: `https://nemo-sports.vercel.app/watch`, no fragment, no query, no per-match slug.
- SportScore, TheSportsDB, unmapped, and placeholder-slug matches all resolve to the same CTA.
- Server-rendered `MatchCard` contains the `/watch` href and the general-section label. Unconfirmed-kick-off cards show "الموعد غير مؤكد" and no 16:00 time.
- Source scan: no `#live-stream`, no `nemo-sports…/matches`, no `direct_match` in `lib/`, `components/`, or `app/`.
- Local `next start`: home page HTML contains 22 `/watch` links, zero `live-stream`, and zero per-match NEMO links.

Main-site dependency: `/watch` on the main site is a general Watch Guide listing operator-registered streams, with an empty state when none exist. This branch needs no main-site change, but the CTA label says "general section" for that reason.

## 7. SEO readiness (facts from code and local build)

- `robots.txt` allows `/`, disallows `/api/` and `/admin`, and points to `/sitemap.xml`.
- `sitemap.xml` lists the home page and `/matches/{date}` pages.
- Canonical: `/` for today, `/matches/{date}` for other dates. Home canonical is `https://nemo-live-kora-matchat.vercel.app`.
- JSON-LD: `ItemList` of `SportsEvent` entries. No per-match `url` (no verified per-match page). `eventStatus` only for not_started, postponed, and cancelled.
- No indexing is promised. Google indexing depends on crawling and quality signals outside this code.
- Search Console actions (for the owner, after deploy): add the property, submit `/sitemap.xml`, and use URL Inspection on `/` and one `/matches/{date}` page. These steps are not executed here.

## 8. Ads and analytics

- **Code present:** none found. No analytics, tag manager, ad script, or consent code in `app/`, `components/`, or `lib/`.
- **Ads returned:** none verified.
- **Approval status:** unknown. No ad network account is referenced in the repo.
- **Consent:** no consent mechanism exists. Adding analytics or ads would require one first.
- **Revenue:** no data. Do not estimate.

## 9. Revenue priorities (after the owner reviews this branch)

1. Keep the `/watch` destination stable; traffic depends on it.
2. Add privacy-respecting analytics with consent before measuring anything.
3. Evaluate ads only after consent and a policy review. No pop-ups, redirects, or match-like ad placements.

## 10. Environment variable names (values not recorded)

NEXT_PUBLIC_NEMO_SPORTS_URL, GATEWAY_SITE_URL, DEFAULT_TIMEZONE, SPORTSCORE_BASE_URL, FOOTBALL_DATA_BASE_URL, FOOTBALL_DATA_API_KEY, THESPORTSDB_BASE_URL, THESPORTSDB_API_KEY, API_FOOTBALL_BASE_URL, API_FOOTBALL_KEY, GOOGLE_NEWS_RSS_BASE_URL, CRON_SECRET, NEMO_INGEST_TOKEN, NEMO_GATEWAY_STORE_PERSIST (set to `off` to disable disk writes; `npm test` sets it).

## 11. Verification

See the final report. Commands: `npx tsc --noEmit`, `npm run lint`, `npm test` (65 tests), `npm run build`, local `next start` smoke.
