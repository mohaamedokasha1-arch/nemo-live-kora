import { readFile } from 'node:fs/promises';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  جدول الكرون كما هو مضبوط فعلًا في المستودع
 * ═══════════════════════════════════════════════════════════════════════════════
 *  تُقرأ المهام من `vercel.json` نفسه — لا نكتب في اللوحة مواعيد من الذاكرة.
 *  وإن تعذّرت القراءة (بيئة لا تحتوي الملف) نقول ذلك صراحة بدل اختراع جدول.
 *
 *  ملاحظة تشغيلية: خطة Vercel المجانية تسمح بمهمتين مجدولتين في اليوم، وهما
 *  مستخدَمتان بالكامل (05:00 و16:00 UTC). لذلك لا نضيف مهمة ثالثة، والنسخة
 *  الاحتياطية المجدولة تُنفّذ داخل مهمة الصباح نفسها.
 */

export interface CronJobInfo {
  path: string;
  schedule: string;
  titleAr: string;
  localTimeAr: string;
}

export interface CronTableInfo {
  ok: boolean;
  jobs: CronJobInfo[];
  messageAr: string | null;
  noteAr: string | null;
}

const TITLES: Record<string, string> = {
  '/api/cron/sync': 'مزامنة كاملة (المباريات + الأخبار) + النسخة الاحتياطية المجدولة',
  '/api/cron/sync-news': 'مزامنة الأخبار فقط',
  '/api/cron/update-matches': 'تحديث النتائج والمواعيد (بلا مصادقة داخلية)',
};

/** تحويل تعبير كرون بسيط `دقيقة ساعة * * *` إلى توقيت القاهرة (UTC+2/3 ثابت عمليًا +2 أو +3). */
function toCairoLabel(schedule: string): string {
  const match = /^(\d{1,2})\s+(\d{1,2})\s/.exec(schedule.trim());
  if (!match) return 'حسب تعبير الجدولة نفسه';
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  const fmt = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return `${fmt(hour + 3)} (صيفًا UTC+3) / ${fmt(hour + 2)} (شتاءً UTC+2)`;
}

export async function getCronTable(): Promise<CronTableInfo> {
  let jobs: Array<{ path: string; schedule: string }> | null = null;
  try {
    const raw = await readFile(new URL('../../vercel.json', import.meta.url), 'utf-8');
    const parsed = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> };
    jobs = parsed.crons ?? null;
  } catch {
    jobs = null;
  }

  if (!jobs || jobs.length === 0) {
    return {
      ok: false,
      jobs: [],
      messageAr:
        'تعذّرت قراءة جدول الكرون من vercel.json في هذه البيئة، فلا نعرض جدولًا غير مؤكَّد. راجع الملف في المستودع أو لوحة Vercel.',
      noteAr: null,
    };
  }

  return {
    ok: true,
    jobs: jobs.map((job) => ({
      path: job.path,
      schedule: job.schedule,
      titleAr: TITLES[job.path] || 'مهمة مجدولة',
      localTimeAr: toCairoLabel(job.schedule),
    })),
    messageAr: null,
    noteAr:
      'المهام المجدولة تعمل من منصة Vercel نفسها بعد النشر؛ وإن تعطّلت لأي سبب (تجاوز حد الخطة مثلًا) يظل المحتوى يخدم الزوار من آخر بيانات صحيحة محفوظة، ويمكن للتشغيل اليدوي من هذه الصفحة تحديثها فورًا.',
  };
}
