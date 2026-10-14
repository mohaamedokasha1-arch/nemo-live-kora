import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getManualStatus, listManualNews } from '@/lib/admin/manual-store';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getGatewayDatabase } from '@/lib/db/store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import NewsEditor from '../../../_components/news-editor';
import { adminMetadata, guardAdminPage } from '../../../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تعديل خبر', ...adminMetadata };

/** تعديل خبر مكتوب في اللوحة: على نفس المسار الرابط القصير، فلا تتغيّر صفحة مفهرسة. */
export default async function AdminNewsEditPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage('news:write', 'تعديل خبر');
  if (!guard.allowed) return guard.denied;

  const { id } = await params;
  const newsId = decodeURIComponent(id);
  const record = listManualNews().find((item) => item.id === newsId) ?? null;

  if (!record) {
    const existing = getGatewayDatabase().news.find((item) => item.id === newsId);
    return (
      <>
        <div className="kl-admin-note kl-admin-note-warn">
          {existing
            ? 'هذا الخبر قادم من مصدر خارجي ولا يُعدَّل نصّه من اللوحة. يمكنك تغيير حالة نشره أو أرشفته من قائمة الأخبار، أو كتابة خبر خاص بك من نفس الصفحة.'
            : 'لا يوجد خبر بهذا المعرّف.'}
        </div>
        <p className="kl-admin-note">
          <Link href="/admin/news/manage">← رجوع إلى إدارة الأخبار</Link>
        </p>
      </>
    );
  }

  const storage = getManualStatus();
  const canWrite = roleHasPermission(guard.identity!.role, 'news:write');
  const db = getGatewayDatabase();
  const accessNotesAr = Object.values(db.sources)
    .filter((source) => source.providesNews)
    .map((source) => ({
      sourceId: source.id,
      nameAr: source.nameAr,
      noteAr: SOURCE_CAPABILITIES[source.id]?.newsAccessNoteAr ?? 'لم يُسجَّل شرط استخدام لهذا المصدر.',
    }));

  return (
    <>
      <p className="kl-admin-note">
        <Link href="/admin/news/manage">← رجوع إلى إدارة الأخبار</Link>
      </p>
      <NewsEditor
        mode="edit"
        newsId={record.id}
        canWrite={canWrite && storage.writable && storage.durable}
        disabledReasonAr="التخزين غير قابل للكتابة على هذه البيئة — لن يُحفظ التعديل."
        accessNotesAr={accessNotesAr}
        initial={{
          id: record.id,
          title: record.title,
          slug: record.slug,
          excerpt: record.excerpt,
          bodyAr: record.bodyAr,
          imageUrl: record.imageUrl || '',
          canonicalUrl: record.canonicalUrl || '',
          publisherName: record.publisherName,
          categoryAr: record.categoryAr,
          publishedAt: record.publishedAt,
          status: record.status,
          indexable: record.indexable,
          relatedMatchIds: record.relatedMatchIds.join(', '),
        }}
      />
    </>
  );
}
