import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { matchesData } from '@/lib/data/matches';
import { resolveMatchDetailTargetSync } from '@/lib/matches/resolve-match';
import LegacyMatchDetail from '@/components/LegacyMatchDetail';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المسار التوافقي القديم `/match/[id]` — يوحّد الوجهات بدل ترك 404
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * صفحات الموقع الحالية كلها تحت `/matches/[id]` (بطاقات الجدول، خريطة الموقع،
 * البيانات المنظمة). لكن روابطًا قديمة — وبطاقات من إصدارات سابقة — قد تشير إلى
 * `/match/<id>`، وكانت تنتهي بـ 404 لأن المسار يقرأ البيانات القديمة فقط.
 *
 * السلوك الآن (بلا كسر لأي رابط قديم):
 *   • معرّف السجلات القديمة الثابتة → نفس العرض القديم كما هو (noindex).
 *   • أي معرّف مباراة حقيقي (كتالوج أو سجل مخزن من SportScore/TheSportsDB/API-Football)
 *     → تحويل دائم إلى الصفحة الموحدة `/matches/[id]` التي تحمل التفاصيل والبث.
 *   • أي معرّف مجهول → 404 حقيقي (يفرضه `layout.tsx` قبل هذه الصفحة).
 */
export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /* ① السجلات القديمة الثابتة: العرض القديم كما كان. */
  const legacyMatch = matchesData.find((match) => match.id === id);
  if (legacyMatch) return <LegacyMatchDetail match={legacyMatch} />;

  /* ② معرّف مباراة حقيقي من أي مصدر → الصفحة الموحدة. */
  const target = resolveMatchDetailTargetSync(id);
  if (target.kind === 'alias') redirect(target.to);
  if (target.kind === 'catalog' || target.kind === 'record') redirect(target.path);

  /* ③ مجهول: `layout.tsx` يمنع الوصول إلى هنا، والحماية النهائية من النشر المستقبلي. */
  notFound();
}
