import React from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { findServedCatalogEntryById } from '@/lib/admin/served-catalog';
import { resolveMatchView } from '@/lib/matches/match-catalog';
import {
  redirectIfAlias,
  resolveMatchDetailTarget,
} from '@/lib/matches/resolve-match';
import { buildMatchLandingPath } from '@/lib/matches/match-links';
import { hydrateStore } from '@/lib/db/store';
import { buildLivePageMetadata } from '@/lib/seo/metadata';
import LiveBroadcastView from '@/components/LiveBroadcastView';

/**
 * صفحة البث الداخلية: /live/[match-id]
 *
 * • صفحة تحويل (Conversion Page) يُنقل إليها الزائر من صفحة هبوط المباراة.
 * • زر المشاهدة الأحمر الموحّد إلى صفحة المشاهدة على منصة NEMO Sports في نافذة جديدة،
 *   مع مساحة إعلانية فوقه وأخرى تحته — بالكود نفسه لكل مباراة.
 * • غير مفهرسة (noindex) عن قصد: المحتوى مكمّل لصفحة الهبوط المعيارية
 *   لتجنّب تكرار المحتوى — مع `follow` للسماح بتمرير الإشارات للروابط الداخلية.
 * • مُهيّأة للإعلانات: مساحات محجوزة بارتفاعات ثابتة (بدون إزاحة تخطيط).
 *
 * 🔧 إصلاح التوجيه (2026-10-17): معرّف سجل مصدر (مثل `match-thesportsdb-2561134`)
 * كان ينتهي بـ 404 هنا لأن الصفحة تقرأ الكتالوج فقط. الآن أي معرّف مباراة حقيقي يُحلَّل
 * من المخزن/المزوّد ويُوجَّه إلى صفحة التفاصيل الكاملة التي تحمل كتلة المشاهدة نفسها،
 * فلا تنقطع رحلة الزائر مهما كان مصدر المعرّف (SportScore أو TheSportsDB أو API-Football).
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const entry = findServedCatalogEntryById(matchId);

  if (!entry) {
    return {
      title: 'صفحة البث غير متاحة',
      robots: { index: false, follow: false },
    };
  }

  return buildLivePageMetadata(resolveMatchView(entry));
}

export default async function LiveMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  await hydrateStore();

  const entry = findServedCatalogEntryById(matchId);
  if (entry) {
    const view = resolveMatchView(entry);
    return <LiveBroadcastView view={view} />;
  }

  /**
   * معرّف سجل/تحويل قديم: الوجهة الصحيحة هي صفحة التفاصيل التي تحمل كتلة المشاهدة
   * الموحّدة (إعلان ← زر ← إعلان) — نفس المحتوى المطلوب من هذه الصفحة، بلا 404.
   */
  const target = await resolveMatchDetailTarget(matchId);
  redirectIfAlias(target);
  if (target.kind === 'record') {
    redirect(buildMatchLandingPath(target.record.id));
  }
  if (target.kind === 'catalog') {
    redirect(target.path);
  }

  notFound();
}
