# Local HTTP route inventory

Origin: http://127.0.0.1:3000. Production build; bundled data, persistence off. Status is final after redirects; chains, titles, descriptions, headings and internal links are recorded in before.json and after.json. Canonicals use production origin. These are initial HTML observations, not browser-DOM results. No X-Robots-Tag was found in these HTML probes.

| Requested route | Before → after | Hops | Canonical after | Robots after | H1 count |
|---|---|---|---|---|---|
| / | 200 → 200 | 0 | https://nemo-live-kora.vercel.app | index, follow | 1 |
| /matches | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches | index, follow | 1 |
| /news | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/news | noindex, follow | 1 |
| /news/archive | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/news/archive | noindex, follow | 1 |
| /about | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/about | index, follow | 1 |
| /contact | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/contact | index, follow | 1 |
| /privacy-policy | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/privacy-policy | index, follow | 1 |
| /terms | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/terms | index, follow | 1 |
| /robots.txt | 200 → 200 | 0 | — | — | — |
| /sitemap.xml | 200 → 200 | 0 | — | — | — |
| /ads.txt | 200 → 200 | 0 | — | — | — |
| /matches/zamalek-vs-al-ahly-2026-10-11 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/zamalek-vs-al-ahly-2026-10-11 | index, follow | 1 |
| /matches/zed-vs-azam-2026-10-16 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/zed-vs-azam-2026-10-16 | index, follow | 1 |
| /matches/al-ittihad-alexandria-vs-zamalek-2026-10-20 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20 | index, follow | 1 |
| /matches/2026-10-16 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/2026-10-16 | index, follow | 1 |
| /matches/2026-10-19 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/2026-10-19 | index, follow | 1 |
| /matches/2026-10-20 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/2026-10-20 | index, follow | 1 |
| /matches/match-api-football-1636498 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1636498 | index, follow | 1 |
| /live/match-api-football-1636498 | 404 → 404 | 0 | — | noindex | 0 |
| /matches/match-api-football-1570416 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1570416 | index, follow | 1 |
| /live/match-api-football-1570416 | 404 → 404 | 0 | — | noindex | 0 |
| /matches/match-api-football-1570413 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1570413 | index, follow | 1 |
| /live/match-api-football-1570413 | 404 → 404 | 0 | — | noindex | 0 |
| /match/egy-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/does-not-exist-xyz | 200 → 404 | 0 | — | noindex | 0 |
| /match/2026-10-20 | 200 → 404 | 0 | — | noindex | 0 |
| /matches/match-api-football-1612249 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612249 | index, follow | 1 |
| /matches/match-api-football-1612250 | 200 → 200 | 1 | https://nemo-live-kora.vercel.app/matches/zamalek-vs-al-ahly-2026-10-11 | index, follow | 1 |
| /matches/match-api-football-1612251 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612251 | index, follow | 1 |
| /matches/match-api-football-1612252 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612252 | index, follow | 1 |
| /matches/match-api-football-1612253 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612253 | index, follow | 1 |
| /matches/match-api-football-1612259 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612259 | index, follow | 1 |
| /matches/match-api-football-1612260 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612260 | index, follow | 1 |
| /matches/match-api-football-1612261 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1612261 | index, follow | 1 |
| /matches/match-api-football-1612263 | 200 → 200 | 1 | https://nemo-live-kora.vercel.app/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20 | index, follow | 1 |
| /matches/match-api-football-1640289 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1640289 | index, follow | 1 |
| /matches/match-api-football-1640291 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1640291 | index, follow | 1 |
| /matches/match-api-football-1640292 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1640292 | index, follow | 1 |
| /matches/match-api-football-1640290 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1640290 | index, follow | 1 |
| /matches/match-api-football-1640293 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1640293 | index, follow | 1 |
| /matches/match-api-football-1636497 | 200 → 200 | 1 | https://nemo-live-kora.vercel.app/matches/zed-vs-azam-2026-10-16 | index, follow | 1 |
| /matches/match-api-football-1603036 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1603036 | index, follow | 1 |
| /matches/match-api-football-1603040 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1603040 | index, follow | 1 |
| /matches/match-sportscore-k82rekhg090zrep | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-k82rekhg090zrep | index, follow | 1 |
| /matches/match-sportscore-vjxm8ghgej5nr6o | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-vjxm8ghgej5nr6o | index, follow | 1 |
| /matches/match-sportscore-318q66h09voqo9j | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-318q66h09voqo9j | index, follow | 1 |
| /matches/match-sportscore-pxwrxlhgyj5kryk | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-pxwrxlhgyj5kryk | index, follow | 1 |
| /matches/match-sportscore-l5ergph4kndlr8k | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-l5ergph4kndlr8k | index, follow | 1 |
| /matches/match-sportscore-k82rekhg0vyzrep | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-k82rekhg0vyzrep | index, follow | 1 |
| /matches/match-sportscore-dn1m1gh318v6moe | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-dn1m1gh318v6moe | index, follow | 1 |
| /matches/match-sportscore-l7oqdeh8glx6r51 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-l7oqdeh8glx6r51 | index, follow | 1 |
| /matches/match-sportscore-4wyrn4h6g35zq86 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-4wyrn4h6g35zq86 | index, follow | 1 |
| /matches/match-sportscore-9vjxm8h59e8nr6o | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-9vjxm8h59e8nr6o | index, follow | 1 |
| /matches/match-sportscore-zp5rzgh658wvq82 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-zp5rzgh658wvq82 | index, follow | 1 |
| /matches/match-api-football-1493743 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1493743 | index, follow | 1 |
| /matches/match-api-football-1493742 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1493742 | index, follow | 1 |
| /matches/match-sportscore-zp5rzgh65w1vq82 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-zp5rzgh65w1vq82 | index, follow | 1 |
| /matches/match-sportscore-x7lm7phw1deym2w | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-sportscore-x7lm7phw1deym2w | index, follow | 1 |
| /matches/match-api-football-1515350 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1515350 | index, follow | 1 |
| /matches/match-api-football-1528340 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/matches/match-api-football-1528340 | index, follow | 1 |
| /match/egy-2026-10-15-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-15-003 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-15-004 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-15-005 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-15-006 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/sau-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/sau-2026-10-15-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/sau-2026-10-15-003 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-15-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-15-003 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/epl-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/epl-2026-10-15-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/laliga-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/laliga-2026-10-15-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/seriea-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/bundesliga-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ligue1-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/uae-2026-10-15-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-16-003 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-16-004 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2026-10-16-005 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/egy-2-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/sau-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/sau-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ucl-2026-10-16-003 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/epl-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/epl-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/laliga-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/laliga-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/seriea-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/seriea-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/bundesliga-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/ligue1-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/eredivisie-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/uae-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/uae-2026-10-16-002 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /match/qatar-2026-10-16-001 | 200 → 200 | 0 | — | noindex, follow | 0 |
| /matches/no-such-match | 404 → 404 | 0 | — | noindex | 0 |
| /news/no-such-article | 404 → 404 | 0 | — | noindex | 0 |
| /not-a-page | 404 → 404 | 0 | — | noindex | 1 |
| /matches/2026-02-30 | 404 → 404 | 0 | — | noindex | 0 |
| /matches/2026-10-17 | 200 → 200 | 1 | https://nemo-live-kora.vercel.app | index, follow | 1 |
| /?date=2026-10-20 | 200 → 200 | 1 | https://nemo-live-kora.vercel.app/matches/2026-10-20 | index, follow | 1 |
| /about/ | 200 → 200 | 1 | https://nemo-live-kora.vercel.app/about | index, follow | 1 |
| /live/zed-vs-azam-2026-10-16 | 200 → 200 | 0 | https://nemo-live-kora.vercel.app/live/zed-vs-azam-2026-10-16 | noindex, follow | 1 |
