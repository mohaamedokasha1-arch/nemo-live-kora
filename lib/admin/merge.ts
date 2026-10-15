import { buildMatchRecordFromManual, ManualCompetitionOverride, ManualDocument } from './manual-document';
import { applyOverrideToMatch, clearManualRecordCache } from './overrides';
import { findManualOverride, getSourceControl } from './manual-store';
import {
  consolidateDuplicateFixtures,
  type FixtureConsolidationReport,
} from '../matches/fixture-consolidation';
import { defaultSourceRank } from '../sources/priority';
import type { GatewayDatabase, MatchRecord, NewsItemRecord, SourceId } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  دمج الطبقة اليدوية في مخزن الموقع
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  هذه الدالة هي «الجسر» الذي يجعل تعديلات المدير تعيش داخل نفس المخزن الذي تقرأ
 *  منه كل صفحات الموقع — بلا أي كود خاص في الصفحات نفسها.
 *
 *  ولماذا ملف مستقل؟ لأن `lib/db/store.ts` هو من يناديها بعد التحميل، فلو استدعى
 *  هو `lib/admin/service.ts` لصار بينهما استيراد دائري. هنا لا يُستورد المخزن
 *  إطلاقًا: الدالة تستقبل قاعدة البيانات وتُعدّلها، وهذا يمنع الدورة تمامًا.
 */

export interface ManualLayerApplyResult {
  manualMatches: number;
  overriddenMatches: number;
  manualNews: number;
  competitionOverrides: number;
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** يحوّل خبرًا يدويًا إلى نفس شكل أخبار المصادر، فيمرّ في كل مسارات العرض. */
export function buildNewsRecordFromManual(record: ManualDocument['news'][number]): NewsItemRecord {
  const cairoDate = record.cairoDate;
  return {
    origin: 'manual',
    id: record.id,
    sourceItemId: null,
    sourceId: 'google-news-rss',
    title: record.title,
    slug: record.slug,
    bodyText: record.bodyAr || null,
    link: record.canonicalUrl || `/news/${record.slug}`,
    originalUrl: record.canonicalUrl,
    publishedAt: record.publishedAt,
    publishedAtKnown: true,
    updatedAt: record.updatedAt,
    fetchedAt: record.createdAt,
    lastSyncedAt: record.updatedAt,
    cairoDate,
    cairoTimeLabel: '',
    excerpt: record.excerpt,
    imageUrl: record.imageUrl,
    publisherName: record.publisherName,
    publisherUrl: null,
    language: 'ar',
    categoryAr: record.categoryAr,
    publishStatus:
      record.status === 'published' ? 'published' : record.status === 'pending' ? 'pending' : 'stale',
    rejectionReason: null,
    rejectionReasonAr: null,
    duplicateOfId: null,
    relatedMatchIds: record.relatedMatchIds,
    relatedTeamIds: [],
    relatedCompetitionCodes: [],
    nemoRelatedUrl: null,
    nemoRelatedLabelAr: null,
  };
}

/**
 * يدمج الطبقة اليدوية في قاعدة بيانات الموقع:
 *  • يستبدل مباريات/أخبار الإدارة بالحالة الحالية للمستند (فيُزيل ما حُذف من اللوحة).
 *  • يُطبّق التثبيتات على سجلات المصادر.
 *  • يُطبّق تجاوزات البطولات (الأولوية/الموسم) على كل مباريات البطولة.
 *
 * الدالة **idempotent** تمامًا وبلا أي ذاكرة داخل العملية: كل سجل يدوي يحمل الوسم
 * `origin: 'manual'`، فيُعرف ما جاء من الإدارة وما جاء من المصادر بلا لبس — حتى بعد
 * إعادة التشغيل أو على نسخة أخرى (وهو ما كان ناقصًا: الحذف كان يعتمد على ذاكرة العملية
 * فتبقى مباراة محذوفة ظاهرة في اللقطة المخزَّنة).
 */
export function mergeManualLayerIntoDatabase(
  db: GatewayDatabase,
  document: ManualDocument
): ManualLayerApplyResult {
  const byId = new Map<string, MatchRecord>(
    db.matches.filter((match) => match.origin !== 'manual').map((match) => [match.id, match])
  );
  for (const manual of document.matches) {
    byId.set(manual.id, buildMatchRecordFromManual(manual));
  }

  const overridesByCode = new Map<string, ManualCompetitionOverride>(
    Object.entries(document.competitionOverrides)
  );
  let overridden = 0;
  db.matches = Array.from(byId.values())
    .map((match) => {
      const override = document.overrides.find((item) => item.matchId === match.id) ?? null;
      let next = override ? applyOverrideToMatch(match, override) : match;
      if (override) overridden += 1;
      const competitionOverride = overridesByCode.get(next.competitionCode);
      if (competitionOverride) {
        next = {
          ...next,
          priority: competitionOverride.priority ?? next.priority,
          seasonLabel: competitionOverride.currentSeason ?? next.seasonLabel,
          competitionNameAr: competitionOverride.nameAr ?? next.competitionNameAr,
          competitionNameEn: competitionOverride.nameEn ?? next.competitionNameEn,
          competitionLogo: competitionOverride.logoUrl ?? next.competitionLogo,
        };
      }
      return next;
    })
    .sort((a, b) =>
      a.priority !== b.priority ? a.priority - b.priority : Date.parse(a.utcKickoff) - Date.parse(b.utcKickoff)
    );

  const newsById = new Map<string, NewsItemRecord>(
    db.news.filter((item) => item.origin !== 'manual').map((item) => [item.id, item])
  );
  for (const manual of document.news) {
    newsById.set(manual.id, buildNewsRecordFromManual(manual));
  }
  db.news = Array.from(newsById.values()).sort(
    (a, b) => Date.parse(b.publishedAt || b.lastSyncedAt) - Date.parse(a.publishedAt || a.lastSyncedAt)
  );

  // التوحيد بعد الطبقة اليدوية: أي مباراة مكررة تعود من اللقطات القديمة أو من مصدرين
  // تُعلَّم وتُوجَّه إلى سجل أساسي واحد — بلا حذف أي سجل (انظر consolidateDuplicatesInDatabase).
  consolidateDuplicatesInDatabase(db);
  clearManualRecordCache();

  return {
    manualMatches: document.matches.length,
    overriddenMatches: overridden,
    manualNews: document.news.length,
    competitionOverrides: overridesByCode.size,
  };
}

/**
 * توحيد المباريات المكررة عبر المصادر على قاعدة البيانات هذه.
 *
 * تُستدعى من مكانين فقط، وكلاهما يملك قاعدة البيانات في يده:
 *  ① `lib/db/store.ts` بعد كل رفع للمصادر (فتُدمج الحالة الجديدة والحالة المخزَّنة معًا).
 *  ② `mergeManualLayerIntoDatabase` عند تحميل/تحديث المخزن (فتُعالج لقطة قديمة فيها تكرار).
 *
 * الدالة مصممة لتكون idempotent: تشغيلها مرارًا لا يغيّر شيئًا بعد الجولة الأولى.
 */
export function consolidateDuplicatesInDatabase(db: GatewayDatabase): FixtureConsolidationReport {
  const sourceRank = (sourceId: SourceId): number => {
    const control = getSourceControl(sourceId);
    const priority = Number(control?.priority);
    if (Number.isFinite(priority) && priority > 0) return priority;
    return defaultSourceRank(sourceId);
  };
  const result = consolidateDuplicateFixtures(db.matches, {
    sourceRank,
    isFrozen: (matchId) => findManualOverride(matchId)?.lockAll === true,
  });
  if (result.matches !== db.matches) db.matches = result.matches;
  if (result.report.markedDuplicates > 0 || result.report.repointedDuplicates > 0) {
    db.meta.lastFixtureConsolidation = {
      at: new Date().toISOString(),
      groups: result.report.groups,
      markedDuplicates: result.report.markedDuplicates,
      repointedDuplicates: result.report.repointedDuplicates,
      requiresReview: result.report.requiresReview.length,
    };
    console.info(
      '[store] fixture_duplicates_consolidated',
      JSON.stringify(db.meta.lastFixtureConsolidation)
    );
  }
  return result.report;
}

/** للاختبارات: يُصفّر أي ذاكرة عرض مرتبطة بالطبقة اليدوية. */
export function resetManualLayerStateForTests(): void {
  clearManualRecordCache();
}

/** مفتاح مقارنة أسماء الفرق/البطولات — يُستخدم في فحص التكرار. */
export { normalizeKey as normalizeAdminKey };

/**
 * نسخة **بلا** أي سجل إداري: هذه هي التي تُكتب في تخزين الموقع الدائم.
 *
 * السبب: طبقة الإدارة لها تخزينها الدائم المستقل (مستند الإدارة)، فخلطها في لقطة المخزن
 * يجعل الحذف غير مضمون (`store` يحتفظ بسجل حُذف من اللوحة) ويضاعف المصدر. الصفحات تقرأ
 * النسخة المدموجة في الذاكرة، والملف يبقى بيانات المصادر وحدها.
 */
export function stripManualLayerFromDatabase(db: GatewayDatabase): GatewayDatabase {
  if (!db.matches.some((match) => match.origin === 'manual') && !db.news.some((item) => item.origin === 'manual')) {
    return db;
  }
  return {
    ...db,
    matches: db.matches.filter((match) => match.origin !== 'manual'),
    news: db.news.filter((item) => item.origin !== 'manual'),
  };
}
