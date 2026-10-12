import { formatArabicTimestamp, toCairoDateString } from '../cairo-time';
import { NewsItemRecord } from '../types';

export const NEWS_FRESH_DAYS = 7;

export function toCairoDateStringOrNull(
  input: string | Date | null | undefined
): string | null {
  if (!input) return null;
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return null;
  return toCairoDateString(date);
}

export function newsAgeMs(
  publishedAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  return now.getTime() - published.getTime();
}

export function isFreshNews(
  publishedAt: string | null | undefined,
  now: Date = new Date(),
  freshDays: number = NEWS_FRESH_DAYS
): boolean {
  const age = newsAgeMs(publishedAt, now);
  if (age === null) return false;
  if (age < 0) return true;
  return age <= freshDays * 24 * 60 * 60 * 1000;
}

export function isStaleForLatestSection(
  item: Pick<NewsItemRecord, 'publishedAt' | 'publishedAtKnown'>,
  now: Date = new Date()
): boolean {
  if (!item.publishedAtKnown || !item.publishedAt) return true;
  return !isFreshNews(item.publishedAt, now);
}

export function formatNewsTimestampLabel(
  publishedAt: string | null,
  publishedAtKnown: boolean
): string {
  if (!publishedAtKnown || !publishedAt) {
    return 'تاريخ النشر غير معروف';
  }
  return formatArabicTimestamp(publishedAt);
}

export function compareNewsByRealDate(
  a: Pick<NewsItemRecord, 'publishedAt' | 'publishedAtKnown' | 'fetchedAt'>,
  b: Pick<NewsItemRecord, 'publishedAt' | 'publishedAtKnown' | 'fetchedAt'>
): number {
  const aTime = a.publishedAtKnown && a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  const bTime = b.publishedAtKnown && b.publishedAt ? Date.parse(b.publishedAt) : NaN;
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid) return bTime - aTime;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt);
}
