import type { Metadata } from 'next';
import { isIndexableCatalogEntry } from '../matches/match-catalog';
import { buildMatchOgImagePath } from '../matches/match-links';
import type { ResolvedMatchView } from '../matches/types';
import { GATEWAY_SITE_URL } from '../site-url';
import { SCHEMA_SITE_NAME, buildMatchDescription } from './sports-event';

/**
 * أدوات الوسوم المعيارية (Canonical) ووسوم المشاركة المشتركة لكل صفحات الموقع.
 * الهدف: منع تكرار المحتوى عبر تثبيت رابط معياري واحد لكل صفحة + عنوان ووصف فريدين.
 */

const SITE_OG_IMAGE = `${GATEWAY_SITE_URL}/og-cover.jpg`;

/**
 * رابط صورة المشاركة المُولَّدة (1200×675) لمباراة — تُنشئها
 * `app/matches/[id]/opengraph-image.tsx` أوتوماتيكيًا لكل معرّف في `data/matches.ts`.
 */
export function buildMatchOgImageUrl(id: string): string {
  return `${GATEWAY_SITE_URL}${buildMatchOgImagePath(id)}`;
}

function clampDescription(value: string, max = 300): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** رابط معياري نسبي (يستخدمه Next مع metadataBase لإنتاج الرابط المطلق). */
export function canonical(path: string): Metadata['alternates'] {
  return { canonical: path };
}

export function buildMatchLandingMetadata(view: ResolvedMatchView): Metadata {
  const { entry } = view;
  const title =
    entry.seo?.title?.trim() ||
    `${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr} | موعد المباراة ${view.cairoDateLabelAr} والمشاهدة المباشرة`;
  const description = clampDescription(
    entry.seo?.description?.trim() || buildMatchDescription(view)
  );
  // نفس الصورة المُعلنة في البيانات المنظمة (1200×675) حتى لا تختلف صورة المشاركة
  // عن صورة الحدث — وأي تعارض بينهما يُضعف النتيجة المُنسّقة.
  const image = entry.seo?.imageUrl?.trim() || buildMatchOgImageUrl(entry.id);
  const keywords = [...(entry.keywords || []), ...(entry.seo?.keywords || [])];

  return {
    title,
    description,
    keywords,
    alternates: canonical(view.canonicalPath),
    openGraph: {
      type: 'website',
      locale: 'ar_EG',
      siteName: SCHEMA_SITE_NAME,
      title,
      description,
      url: view.canonicalUrl,
      images: [{ url: image, width: 1200, height: 675, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
    // شبكة أمان: صفحة بلا محتوى صحيح أو بطلب noindex صريح (`seo.noindex`) لا
    // تُفهرس — ونفس هذه البوابة حرفيًا تُصفّي خريطة الموقع (`getCatalogSitemapItems`)
    // فلا تعارض أبدًا بين إشارة الصفحة وإشارة الخريطة.
    robots: { index: isIndexableCatalogEntry(entry), follow: true },
  };
}

/**
 * صفحة المشاهدة الداخلية لم تُنشأ للفهرسة (محتوى مختصر ومتشابه مع صفحة الهبوط)،
 * لكنها مفيدة للزائر وتحمل روابط داخلية واضحة + مساحة إعلانية جاهزة.
 */
export function buildLivePageMetadata(view: ResolvedMatchView): Metadata {
  const { entry } = view;
  const title = `${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr} — مشاهدة البث المباشر`;
  const description = clampDescription(
    `صفحة المشاهدة المباشرة لمباراة ${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr} في ${entry.competition.nameAr}. ` +
      `الموعد: ${view.cairoDateLabelAr} الساعة ${view.kickoffTimeAr} بتوقيت القاهرة، مع زر المشاهدة المباشرة.`
  );

  return {
    title,
    description,
    alternates: canonical(view.livePath),
    robots: { index: false, follow: true },
    openGraph: {
      type: 'website',
      locale: 'ar_EG',
      siteName: SCHEMA_SITE_NAME,
      title,
      description,
      url: view.liveUrl,
      // نفس بطاقة المباراة المُولَّدة (1200×675) — الصفحة غير مفهرسة لكنها تُشارَك
      // على الشبكات الاجتماعية، فتحتاج بطاقة صحيحة المقاس.
      images: [
        { url: entry.seo?.imageUrl?.trim() || buildMatchOgImageUrl(entry.id), width: 1200, height: 675, alt: title },
      ],
    },
  };
}

/** وسوم الصفحات القانونية والثابتة (سياسة الخصوصية، الشروط، من نحن، اتصل بنا). */
export function buildStaticPageMetadata(input: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}): Metadata {
  return {
    title: input.title,
    description: clampDescription(input.description),
    alternates: canonical(input.path),
    robots: { index: input.index !== false, follow: true },
    openGraph: {
      type: 'website',
      locale: 'ar_EG',
      siteName: SCHEMA_SITE_NAME,
      title: input.title,
      description: clampDescription(input.description),
      url: `${GATEWAY_SITE_URL}${input.path === '/' ? '/' : input.path}`,
      images: [{ url: SITE_OG_IMAGE, width: 1200, height: 675, alt: input.title }],
    },
  };
}

export { SITE_OG_IMAGE };
