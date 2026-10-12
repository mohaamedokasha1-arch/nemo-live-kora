import { MatchRecord } from '../types';

function eventStatusUrl(status: MatchRecord['status']): string | null {
  switch (status) {
    case 'not_started':
      return 'https://schema.org/EventScheduled';
    case 'postponed':
      return 'https://schema.org/EventPostponed';
    case 'cancelled':
      return 'https://schema.org/EventCancelled';
    default:
      // Schema.org has no equivalent useful state here; do not label a live or finished
      // fixture as scheduled or invent a non-standard EventStatusType.
      return null;
  }
}

export function createMatchScheduleStructuredData(
  date: string,
  matches: MatchRecord[]
): Record<string, unknown> | null {
  if (matches.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `جدول مباريات ${date} — نيمو كورة لايف`,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: matches.length,
    itemListElement: matches.slice(0, 20).map((match, index) => {
      const eventStatus = eventStatusUrl(match.status);
      const startDate = Number.isFinite(Date.parse(match.utcKickoff))
        ? match.utcKickoff
        : null;
      const item: Record<string, unknown> = {
        '@type': 'SportsEvent',
        name: `${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr}`,
        sport: 'Association football',
        homeTeam: {
          '@type': 'SportsTeam',
          name: match.homeTeam.nameAr,
        },
        awayTeam: {
          '@type': 'SportsTeam',
          name: match.awayTeam.nameAr,
        },
      };

      if (startDate) item.startDate = startDate;
      if (eventStatus) item.eventStatus = eventStatus;
      if (match.venue) {
        item.location = {
          '@type': 'Place',
          name: match.venue,
        };
      }
      // Deliberately omit `url`: this page describes the fixture list, not a canonical event
      // detail page on the gateway. Third-party NEMO destinations are not event URLs here.

      return {
        '@type': 'ListItem',
        position: index + 1,
        item,
      };
    }),
  };
}

/** JSON-LD is embedded in a script element; escape HTML-significant characters. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
