import { findServedCatalogEntryForMatch } from '@/lib/admin/served-catalog';
import { MetadataRoute } from 'next';
import {
  getTodayCairoDate,
  isValidDateParam,
  shiftDateString,
} from '@/lib/cairo-time';
import { getGatewayDatabase, hydrateStore, queryGatewayMatches } from '@/lib/db/store';
import { getCatalogSitemapItems } from '@/lib/matches/match-catalog';
import { getArchiveNews, getLatestNews, getPublishedNews } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import { GATEWAY_SITE_URL } from '@/lib/site-url';
import { getSiteSettings, loadManualDocument } from '@/lib/admin/manual-store';

/**
 * sitemap.xml ديناميكي:
 *  • الصفحة الرئيسية + جداول التواريخ النشطة + صفحات الأخبار المفهرسة.
 *  • صفحات هبوط كل مباراة في `data/matches.ts` — تُضاف **فورًا** ومعهد توقيت آخر تحديث،
 *    وترتفع أولويتها تلقائيًا للمباريات المباشرة والقريبة.
 */
export const dynamic = 'force-dynamic';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function mostRecentDate(dates: Array<Date | null>, fallback: Date): Date {
  const validDates = dates.filter((date): date is Date => date !== null);
  return validDates.length > 0
    ? validDates.reduce((latest, date) => (date > latest ? date : latest))
    : fallback;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await hydrateStore();
  await loadManualDocument();
  // إعداد إداري واحد يتحكّم في وجود صفحات الأخبار داخل الخريطة (الصفحات نفسها تظل
  // تعمل ومتاحة للزحف عبر الروابط — لا نُخفي محتوى، إنما نُغيّر إشارة الخريطة فقط).
  const includeNewsInSitemap = getSiteSettings().sitemapIncludeNews;
  const now = new Date();
  const todayCairo = getTodayCairoDate();
  const startDate = shiftDateString(todayCairo, -1);
  const endDate = shiftDateString(todayCairo, 7);
  const db = getGatewayDatabase();
  const { availableDates } = queryGatewayMatches({});
  const latestNews = includeNewsInSitemap ? getLatestNews(db.news, 24) : [];
  const archiveNews = includeNewsInSitemap ? getArchiveNews(db.news) : [];
  const indexableNews = includeNewsInSitemap
    ? getPublishedNews(db.news).filter(isIndexableNewsArticle)
    : [];

  // ── صفحات هبوط المباريات (Automated Match Engine) ──
  const matchRoutes: MetadataRoute.Sitemap = getCatalogSitemapItems(now).map((item) => ({
    url: `${GATEWAY_SITE_URL}${item.path}`,
    lastModified: item.lastModified,
    changeFrequency: item.changeFrequency,
    priority: item.priority,
  }));

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${GATEWAY_SITE_URL}/`,
      lastModified: parseDate(db.meta.lastLiveSyncAt) || now,
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${GATEWAY_SITE_URL}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${GATEWAY_SITE_URL}/contact`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${GATEWAY_SITE_URL}/privacy-policy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${GATEWAY_SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  // Listing pages enter the sitemap only when they contain real, indexable articles.
  if (latestNews.some(isIndexableNewsArticle)) {
    staticRoutes.push({
      url: `${GATEWAY_SITE_URL}/news`,
      lastModified: parseDate(db.meta.lastSuccessfulNewsSyncAt) || now,
      changeFrequency: 'hourly',
      priority: 0.7,
    });
  }

  const indexableArchive = archiveNews.filter(isIndexableNewsArticle);
  if (indexableArchive.length > 0) {
    staticRoutes.push({
      url: `${GATEWAY_SITE_URL}/news/archive`,
      lastModified: mostRecentDate(
        indexableArchive.map(
          (item) =>
            parseDate(item.updatedAt) ||
            parseDate(item.publishedAt) ||
            parseDate(item.fetchedAt)
        ),
        now
      ),
      changeFrequency: 'weekly',
      priority: 0.4,
    });
  }

  // Today is represented by the canonical homepage. Keep the indexed schedule window
  // deliberately short; the date picker remains functional but arbitrary dates are not
  // added to the sitemap merely because they are queryable.
  const dateRoutes: MetadataRoute.Sitemap = availableDates
    .filter(
      (entry) =>
        entry.total > 0 &&
        isValidDateParam(entry.date) &&
        entry.date !== todayCairo &&
        entry.date >= startDate &&
        entry.date <= endDate
    )
    .map((entry) => {
      const updatedAt = mostRecentDate(
        db.matches
          .filter((match) => match.cairoDate === entry.date)
          .map((match) => parseDate(match.lastUpdatedAt)),
        now
      );

      return {
        url: `${GATEWAY_SITE_URL}/matches/${entry.date}`,
        lastModified: updatedAt,
        changeFrequency: 'daily' as const,
        priority: entry.egyptianCount > 0 ? 0.8 : 0.6,
      };
    });

  const newsRoutes: MetadataRoute.Sitemap = indexableNews.map((item) => ({
    url: `${GATEWAY_SITE_URL}/news/${item.slug}`,
    lastModified:
      parseDate(item.updatedAt) ||
      parseDate(item.publishedAt) ||
      parseDate(item.fetchedAt) ||
      now,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  /**
   * ⚠️ قرار مقصود: سجلات المصادر الخام (‎/matches/match-api-football-XXXXXXX) **لا**
   * تُضاف إلى خريطة الموقع.
   *
   * السبب: تلك الصفحات تُبنى آليًا من بيانات المصدر فقط (بلا ملعب ولا بث ولا بيانات
   * منظمة)، ومعرّفاتها غير قابلة للقراءة، وهي بذلك «محتوى رقيق» لا يمثّل هدف بحث
   * حقيقيًا. إدراجها كان يُدخل عشرات الروابط منخفضة القيمة في خريطة الموقع فتزاحم
   * صفحات هبوط المباريات (وهي الوجهة الحقيقية على البوابة) وتُشتّت ميزانية الزحف.
   *
   * الصفحات نفسها تبقى موجودة ومتاحة للزائر وللروبوت (index/follow) وتصل إليها
   * الروابط الداخلية من الجداول — لكننا لا نُعلنها كوجهات في خريطة الموقع.
   * أما صفحات هبوط الكتالوج فهي المسار الرسمي المُعلن لكل مباراة.
   *
   * للحصول على رقم تحقّقي: كم سجل مصدر خام استُثني من الخريطة الآن.
   */
  const excludedSourceOnlyCount = db.matches.filter(
    (match) =>
      !findServedCatalogEntryForMatch(match) &&
      match.kickoffConfirmed === true &&
      match.cairoDate >= startDate &&
      match.cairoDate <= endDate
  ).length;
  if (excludedSourceOnlyCount > 0) {
    console.info(
      `[sitemap] استُثني ${excludedSourceOnlyCount} سجل مصدر خام من خريطة الموقع (محتوى رقيق) — الوجهة الرسمية هي صفحات هبوط الكتالوج.`
    );
  }

  return [...staticRoutes, ...matchRoutes, ...dateRoutes, ...newsRoutes];
}
