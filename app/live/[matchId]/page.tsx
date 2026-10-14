import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findCatalogEntryById } from '@/lib/matches/match-links';
import { resolveMatchView } from '@/lib/matches/match-catalog';
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
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const entry = findCatalogEntryById(matchId);

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
  const entry = findCatalogEntryById(matchId);
  if (!entry) notFound();

  const view = resolveMatchView(entry);
  return <LiveBroadcastView view={view} />;
}
