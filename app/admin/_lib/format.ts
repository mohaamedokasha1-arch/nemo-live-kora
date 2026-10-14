/**
 * تنسيق التواريخ في اللوحة — دالة خالصة في وحدة **خادم/عميل** مشتركة.
 *
 * لماذا بملف منفصل؟ لأن تعريفها داخل `_components/ui.tsx` (وهي وحدة `'use client'`)
 * يجعل استدعاءها من صفحات الخادم (`app/admin/<قسم>/page.tsx`) خطأً حقيقيًا في RSC:
 * «Attempted to call formatDateAr() from the server but it is on the client» —
 * ظهر فعليًا في نسخة الإنتاج (500) ولم يظهر في التطوير. نقلها هنا يُصلح السبب لا العَرَض.
 */
export function formatDateAr(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(date);
}

/** فرق الزمن بصيغة عربية موجزة: «قبل ٣ دقائق» / «قبل ساعتين» / «قبل يوم». */
export function formatAgeAr(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'قبل يوم' : `قبل ${days} يوم`;
}
