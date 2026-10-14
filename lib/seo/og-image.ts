import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  صورة المشاركة المُولَّدة (1200×675) — أساس متطلب Google للصورة في SportsEvent
 * ═══════════════════════════════════════════════════════════════════════════════
 *  لماذا هذا الملف؟
 *  ---------------
 *  Google تشترط في نتائج الأحداث المُنسّقة (Event rich results) أن يحتوي الحدث على
 *  صورة بعرض **لا يقل عن 720 بكسل** (والموصى به 1200×675 بنسبة 16:9 وبحجم أقل من 5MB)،
 *  وأن تكون الصورة قابلة للزحف. أما شعارات الفرق (crests) فهي مربّعة وصغيرة الحجم
 *  ومُستضافة على نطاق خارجي، لذلك لا تصلح كصورة أساسية للحدث — وقد كانت تُنتج تحذير
 *  «Image too small» في Search Console.
 *
 *  الحل: توليد صورة **مُستضافة على نطاقنا** بمقاس 1200×675 لكل مباراة عبر `next/og`
 *  (Satori)، فتصبح الصورة موجودة دائمًا وبالمقاس الصحيح مع أي مباراة جديدة تُضاف إلى
 *  `data/matches.ts` — بدون أي خطوة يدوية.
 *
 *  ملاحظة فنية حاسمة:
 *  Satori لا يدعم صيغ WOFF/WOFF2، ويدعم فقط TTF/OTF — لذلك تُخزَّن خطوط Cairo بصيغة
 *  TTF داخل `assets/fonts/` (مُشتقّة من حزمة `@fontsource/cairo` بنفس ترخيص OFL).
 *
 *  ⚠️ درس عملي مهم: @fontsource تشحن الخط مقسّمًا إلى مجموعتين منفصلتين
 *  (`arabic` للعربية والأرقام الهندية، و`latin` للحروف اللاتينية وأرقام ASCII
 *  وعلامات الترقيم). وSatori **لا يطبّق رجوعًا تلقائيًا بين خطين بنفس اسم العائلة**،
 *  فكانت النتيجة حذف أي محرف غير موجود في الخط الأول — اختفت الشرطة (—) والرقم "7"
 *  من البطاقة. لذلك يدُمج الخطّان في ملف واحد لكل وزن (400 و700) يغطي 514 محرفًا،
 *  فيظهر النص العربي والإنجليزي والأرقام كاملة في بطاقة واحدة بلا أي محرف ناقص.
 */

/** المقياس القياسي لبطاقات المشاركة (16:9 الموصى به من Google). */
export const OG_IMAGE_SIZE = { width: 1200, height: 675 } as const;

export const OG_IMAGE_CONTENT_TYPE = 'image/png';

/** اسم عائلة الخط كما يُسجَّل في Satori (يجب أن يطابق `fontFamily` في التصميم). */
export const OG_FONT_FAMILY = 'Cairo';

/** ألوان الهوية المستخدمة في البطاقة. */
export const OG_THEME = {
  bgInner: '#1b2836',
  bgOuter: '#0f1722',
  accent: '#22c55e',
  live: '#ef4444',
  warn: '#f59e0b',
  text: '#f8fafc',
  muted: '#94a3b8',
  chipBg: 'rgba(255,255,255,0.08)',
  chipBorder: 'rgba(255,255,255,0.16)',
} as const;

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
};

/**
 * تحميل الخطوط مرة واحدة وتخزينها في الذاكرة.
 * عند تعذّر قراءة ملف خطّي نُبقي المشكلة صريحة (throw) بدل إنتاج صورة مشوّهة
 * بمربعات فارغة بدل الحروف العربية.
 */
let fontsPromise: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      // ملف واحد لكل وزن يغطي العربية + اللاتينية + الأرقام + الترقيم معًا،
      // لأن Satori لا يطبّق رجوعًا بين خطوط مختلفة بنفس اسم العائلة.
      const files: Array<{ file: string; weight: 400 | 700 }> = [
        { file: 'cairo-400.ttf', weight: 400 },
        { file: 'cairo-700.ttf', weight: 700 },
      ];

      const loaded = await Promise.all(
        files.map(async ({ file, weight }) => ({
          name: OG_FONT_FAMILY,
          data: await readFile(path.join(FONT_DIR, file)),
          weight,
          style: 'normal' as const,
        }))
      );

      return loaded;
    })();
  }
  return fontsPromise;
}

/**
 * تنظيف أي نص قبل تمريره إلى Satori:
 *  • إزالة محارف التحكم وعلامات الاتجاه الصريحة ومحدّدات الكائنات (تُفسد تشكيل العربية).
 *  • توحيد المسافات المتتالية.
 *  • تقييد الطول حتى لا يتجاوز النص حدود البطاقة ثابتة المقاس.
 */
export function sanitizeOgText(value: string, maxLength = 120): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * ⚠️ تتبّع مهم لمنع الانحدار في المستقبل:
 * كان تباعد الكلمات العربية في البطاقات خطأً حقيقيًا (0.5em مضاعفة لكل فراغ بسبب
 * خلل في قياس المسافة داخل Satori). بعد تجريب عدة حلول فاشلة (منها U+00A0 الذي صلح
 * التباعد لكنه عطّل ترتيب Bidi وقلب ترتيب الكلمات)، اعتُمد حلّ التفكيك إلى كلمات
 * عناصر flex في `row-reverse`. التفاصيل والقياسات موثّقة في `lib/seo/og-text.tsx`،
 * وهو المسار الوحيد المعتمد لعرض أي نص داخل بطاقات المشاركة.
 */
