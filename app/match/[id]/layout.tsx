import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { matchesData } from '@/lib/data/matches';
import { resolveMatchDetailTargetSync } from '@/lib/matches/resolve-match';

// Legacy hard-coded records include example.com assets and are not verified news
// or fixtures. Preserve their existing UI/URLs, but do not advertise them for indexing.
export const metadata: Metadata = {
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

/**
 * حارس المسار القديم `/match/[id]`:
 *   • معرّفات السجلات القديمة الثابتة تمرّ كما هي (اختبارات الحفظ تضمن بقاء واجهتها).
 *   • معرّفات المباريات الحقيقية (كتالوج/مخزن من أي مصدر) تمرّ ليحوّلها المستخدم إلى
 *     `/matches/[id]` — فلا يُسجَّل 404 لرابط مباراة صحيحة بأسماء قديمة للمسارات.
 *   • أي معرّف مجهول → `notFound()` فورًا (لا soft 404).
 */
export default async function LegacyMatchLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (matchesData.some(match => match.id === id)) return children;

  // معرّف مباراة حقيقي من الكتالوج أو المخزن: يُحوَّل في الصفحة إلى المسار الموحّد.
  const target = resolveMatchDetailTargetSync(id);
  if (target.kind !== 'unavailable') return children;

  notFound();
}
