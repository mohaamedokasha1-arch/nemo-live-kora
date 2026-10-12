import { MatchScore, MatchStatusCode } from './types';

export const CAIRO_TIMEZONE = 'Africa/Cairo';

/**
 * Formats an ISO UTC timestamp or Date into YYYY-MM-DD in Africa/Cairo timezone.
 * Returns an empty string for invalid timestamps rather than inventing today's date.
 */
export function toCairoDateString(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Returns today's date in Africa/Cairo as YYYY-MM-DD.
 */
export function getTodayCairoDate(referenceDate?: Date): string {
  return toCairoDateString(referenceDate ?? new Date());
}

/**
 * Adds or subtracts days from a YYYY-MM-DD date string safely.
 */
export function shiftDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcNoon = new Date(0);
  utcNoon.setUTCFullYear(y, (m || 1) - 1, d || 1);
  utcNoon.setUTCHours(12, 0, 0, 0);
  utcNoon.setUTCDate(utcNoon.getUTCDate() + offsetDays);
  return utcNoon.toISOString().slice(0, 10);
}

/**
 * Validates that a string is a real YYYY-MM-DD calendar date without an arbitrary year window.
 */
export function isValidDateParam(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Formats an ISO UTC timestamp into 24h HH:mm in Africa/Cairo timezone.
 */
export function toCairoTime24(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Formats an ISO UTC timestamp into an Arabic readable time in Africa/Cairo (e.g. "08:00 م").
 */
export function toCairoTimeArabic(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Formats a YYYY-MM-DD date string into a rich Arabic date label (e.g. "الاثنين 12 أكتوبر 2026").
 */
function utcNoonFromDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcNoon = new Date(0);
  utcNoon.setUTCFullYear(y, m - 1, d);
  utcNoon.setUTCHours(12, 0, 0, 0);
  return utcNoon;
}

export function formatArabicFullDate(dateStr: string): string {
  if (!isValidDateParam(dateStr)) return dateStr;
  const utcNoon = utcNoonFromDateString(dateStr);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(utcNoon);
}

/**
 * Formats a YYYY-MM-DD date string into a short Arabic label (e.g. "الاثنين 12 أكتوبر").
 */
export function formatArabicShortDate(dateStr: string): string {
  if (!isValidDateParam(dateStr)) return dateStr;
  const utcNoon = utcNoonFromDateString(dateStr);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(utcNoon);
}

/**
 * Formats an ISO timestamp into Arabic date + time in Africa/Cairo for "آخر تحديث".
 */
export function formatArabicTimestamp(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Returns relative Arabic label for date tabs ("أمس", "اليوم", "غدًا", or weekday).
 */
export function getRelativeDayLabelAr(
  targetDate: string,
  todayCairo: string = getTodayCairoDate()
): string | null {
  if (targetDate === todayCairo) return 'اليوم';
  if (targetDate === shiftDateString(todayCairo, -1)) return 'أمس';
  if (targetDate === shiftDateString(todayCairo, 1)) return 'غدًا';
  return null;
}

/**
 * Strict mapping of raw provider status to canonical MatchStatusCode & Arabic label.
 * NEVER infers "انتهت" solely from elapsed time if the provider still says "not_started"/"NS".
 */
export function normalizeMatchStatus(
  rawStatus: string | null | undefined,
  rawStatusText?: string | null,
  utcKickoff?: string,
  now: Date = new Date()
): {
  status: MatchStatusCode;
  statusLabelAr: string;
  statusNoteAr: string | null;
} {
  const norm = (rawStatus || '').trim().toUpperCase();
  const textNorm = (rawStatusText || '').trim().toUpperCase();

  if (
    norm === 'FT' ||
    norm === 'FINISHED' ||
    norm === 'AET' ||
    norm === 'PEN' ||
    norm === 'AWD' ||
    norm === 'ENDED' ||
    textNorm === 'FINISHED' ||
    textNorm === 'FT'
  ) {
    let note: string | null = null;
    if (norm === 'AET') note = 'بعد الوقت الإضافي';
    else if (norm === 'PEN') note = 'بركلات الترجيح';
    else if (norm === 'AWD') note = 'نتيجة اعتبارية من المصدر';
    return { status: 'finished', statusLabelAr: 'انتهت', statusNoteAr: note };
  }

  if (
    norm === 'LIVE' ||
    norm === 'IN_PLAY' ||
    norm === '1H' ||
    norm === '2H' ||
    norm === 'HT' ||
    norm === 'ET' ||
    norm === 'BT' ||
    norm === 'P'
  ) {
    if (utcKickoff) {
      const kickoffMs = new Date(utcKickoff).getTime();
      if (!Number.isNaN(kickoffMs)) {
        const elapsedMs = now.getTime() - kickoffMs;
        const maxEarlyLiveMs = 15 * 60 * 1000;
        // Upper bound for a plausible live match (2 halves, HT, stoppage, extra time).
        const maxLiveAgeMs = 180 * 60 * 1000;
        if (elapsedMs < -maxEarlyLiveMs || elapsedMs > maxLiveAgeMs) {
          return {
            status: 'unconfirmed',
            statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
            statusNoteAr:
              elapsedMs > maxLiveAgeMs
                ? 'المصدر يصفها بالمباشرة رغم تجاوز مدة المباراة المعتادة؛ لا نعرضها كمباراة جارية.'
                : 'المصدر يصفها بالمباشرة قبل موعد بدايتها المتوقع؛ الحالة تحتاج إلى تحقق.',
          };
        }
      } else {
        return {
          status: 'unconfirmed',
          statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
          statusNoteAr: 'تعذر التحقق من موعد المباراة للتحقق من حالة البث المباشر.',
        };
      }
    } else {
      return {
        status: 'unconfirmed',
        statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
        statusNoteAr: 'لا يتوفر موعد بداية موثوق للتحقق من حالة المباراة المباشرة.',
      };
    }

    let note: string | null = null;
    if (norm === 'HT' || textNorm === 'HT' || textNorm === 'HALFTIME') {
      note = 'استراحة بين الشوطين';
    } else if (norm === '1H') {
      note = 'الشوط الأول';
    } else if (norm === '2H') {
      note = 'الشوط الثاني';
    }
    return { status: 'live', statusLabelAr: 'جارية', statusNoteAr: note };
  }

  if (
    norm === 'PST' ||
    norm === 'POSTPONED' ||
    textNorm.includes('POSTPONED')
  ) {
    return { status: 'postponed', statusLabelAr: 'مؤجلة', statusNoteAr: 'تأجلت بقرار رسمي من المصدر' };
  }

  if (
    norm === 'CANC' ||
    norm === 'CANCELLED' ||
    norm === 'CANCELED' ||
    norm === 'ABD' ||
    textNorm.includes('CANCEL')
  ) {
    return { status: 'cancelled', statusLabelAr: 'أُلغيت', statusNoteAr: 'ألغيت من المصدر' };
  }

  if (
    norm === 'SUSP' ||
    norm === 'SUSPENDED' ||
    norm === 'INT' ||
    norm === 'INTERRUPTED' ||
    norm === 'PAUSED'
  ) {
    return { status: 'suspended', statusLabelAr: 'متوقفة', statusNoteAr: 'المباراة متوقفة مؤقتًا' };
  }

  if (
    norm === 'NS' ||
    norm === 'TIMED' ||
    norm === 'SCHEDULED' ||
    norm === 'UPCOMING' ||
    norm === 'NOT_STARTED'
  ) {
    // Rule: NEVER infer "انتهت" from elapsed time alone.
    // If kickoff is more than 15 minutes in the past and provider still says NS, keep status as
    // "لم تبدأ" or "غير مؤكدة" with an explicit transparent note.
    if (utcKickoff) {
      const kickoffMs = new Date(utcKickoff).getTime();
      if (!Number.isNaN(kickoffMs) && now.getTime() - kickoffMs > 30 * 60 * 1000) {
        return {
          status: 'unconfirmed',
          statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
          statusNoteAr: 'تجاوز موعد البداية دون تأكيد تحديث الحالة من المصدر',
        };
      }
    }
    return { status: 'not_started', statusLabelAr: 'لم تبدأ', statusNoteAr: null };
  }

  return {
    status: 'unconfirmed',
    statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
    statusNoteAr: 'الحالة التفصيلية غير متوفرة من المصدر حاليًا',
  };
}

/**
 * Safely parses a score value without EVER converting null/undefined/empty into 0.
 */
export function parseNullableScore(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/**
 * Formats a MatchScore for display. Returns null if either side's score is missing,
 * ensuring missing scores are NEVER displayed as "0 - 0".
 */
export function formatScoreDisplay(score: MatchScore, status: MatchStatusCode): {
  hasScore: boolean;
  homeDisplay: string;
  awayDisplay: string;
  summaryText: string;
} {
  if (
    score.home !== null &&
    score.away !== null &&
    Number.isFinite(score.home) &&
    Number.isFinite(score.away) &&
    status !== 'not_started' &&
    status !== 'postponed' &&
    status !== 'cancelled'
  ) {
    return {
      hasScore: true,
      homeDisplay: String(score.home),
      awayDisplay: String(score.away),
      summaryText: `${score.home} - ${score.away}`,
    };
  }
  return {
    hasScore: false,
    homeDisplay: '—',
    awayDisplay: '—',
    summaryText: status === 'not_started' ? 'لم تبدأ بعد' : 'النتيجة غير متاحة من المصدر',
  };
}
