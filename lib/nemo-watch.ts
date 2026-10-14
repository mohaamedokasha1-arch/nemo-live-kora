import { NEMO_SPORTS_BASE_URL } from './catalog';
import type { ResolvedMatchView } from './matches/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  نظام رابط المشاهدة الديناميكي الموحّد (Global Dynamic Watch Link System)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  مصدر واحد لا غير لكل روابط المشاهدة الخارجية في المشروع. أي صفحة أو بطاقة أو زر
 *  يحتاج رابط مشاهدة يمرّ من هنا — فلا يوجد رابط مكتوب يدويًا في أي مكوّن.
 *
 *  آلية التحويل (Dynamic Watch Redirect) — القرار النهائي لصاحب المنتج:
 *
 *   الزائر يدوس الزر الأحمر في صفحة المباراة ← تُفتح **صفحة المشاهدة** على منصة
 *   NEMO Sports في تبويب جديد ← **ويختار المباراة بنفسه من هناك**.
 *
 *   ولهذا الوجهة الموحّدة هي العنوان الصافي نفسه لكل مباريات الموقع:
 *
 *       https://nemo-sports.vercel.app/watch
 *
 *   بلا أي معرّف أو معامل استعلام. هذا هو الشكل الذي طلبه صاحب المنتج صراحةً وهو
 *   الأنسب تقنيًا كذلك: الجهة التي تعرف المباريات وتعرضها هي المنصة، فلا نجبرها على
 *   فهم معرّف داخلي ولا نُرسل معرّفًا قد تتجاهله فيصل الزائر إلى صفحة بلا تحديد.
 *
 *  ⚠️ ملاحظة تحقّق يحفظها هذا الملف ليعرفها أي مطوّر يعدّله:
 *  تقرير التدقيق `docs/AUDIT-2026-10-12-BROADCAST-LINK.md` سجّل أن مسار `/watch` على
 *  الموقع المنشور هو **صفحة دليل/بوابة مشاهدة عامة** لا تختار مباراة بعينها، وأن الهدف
 *  `#selected-match-broadcast` غير مدعوم. وهذا **مطابق للسلوك المطلوب** هنا: الصفحة
 *  تعرض البثوث والزائر يختار منها، فلم يعد ذلك قيدًا بل هو التصميم نفسه.
 *  (ولهذا أيضًا لا يدّعي نص الزر ولا ملاحظته أن الرابط يفتح مباراة محددة.)
 *
 *  التوسعة بلا كود — متغيّرات بيئة فقط:
 *   • `NEXT_PUBLIC_NEMO_WATCH_BASE_URL` — تغيير عنوان صفحة المشاهدة في الموقع كله.
 *   • `NEXT_PUBLIC_NEMO_WATCH_MODE` — `gateway` (الافتراضي) أو `id-param` (إرفاق
 *     معرّف المباراة كمعامل استعلام) أو `exact-first` (تقديم صفحة المباراة المطابقة
 *     المُتحقَّق منها حين توجد ثم البوابة).
 */

/** مسار بوابة المشاهدة على المنصة الرئيسية. */
export const NEMO_WATCH_PATH = '/watch';

/** اسم المعامل الذي يحمل معرّف المباراة في رابط البوابة. */
export const NEMO_WATCH_ID_PARAM = 'id';

/**
 * أنماط التوجيه المتاحة:
 *  • `gateway` (الافتراضي) — عنوان صفحة المشاهدة الصافي لكل المباريات، والزائر يختار
 *    المباراة بنفسه من الصفحة. هذا هو نظام الموقع الدائم.
 *  • `id-param` — إرفاق معرّف المباراة كمعامل استعلام (`?id=...`) لمن يريد تجربته.
 *  • `exact-first` — تقديم صفحة المباراة المطابقة المُتحقَّق منها حين توجد، ثم البوابة.
 */
export type NemoWatchMode = 'gateway' | 'id-param' | 'exact-first';

const READ_MODE = (): NemoWatchMode => {
  const raw = process.env.NEXT_PUBLIC_NEMO_WATCH_MODE?.trim();
  return raw === 'id-param' || raw === 'exact-first' ? raw : 'gateway';
};

export const NEMO_WATCH_MODE: NemoWatchMode = READ_MODE();

/**
 * الوجهة الأساسية الموحّدة. قابلة للتجاوز عبر متغيّر بيئة عام لأنه يُستخدم في
 * روابط تُعرض للمتصفح (client-safe)، فيجب أن يبدأ بـ `NEXT_PUBLIC_`.
 */
export const NEMO_WATCH_BASE_URL = (() => {
  const override = process.env.NEXT_PUBLIC_NEMO_WATCH_BASE_URL?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString().replace(/\/$/, '');
    } catch {
      // قيمة غير صالحة → نتجاهلها ونعود إلى الافتراضي بدل إنتاج رابط مكسور.
    }
  }
  return `${NEMO_SPORTS_BASE_URL}${NEMO_WATCH_PATH}`;
})();

/**
 * يبني رابط بوابة المشاهدة لمباراة — الصيغة: `<BASE>?id=<match-id>`.
 * يتعامل مع وجود معاملات مسبقة في الرابط الأساسي (`?x=1` → `&id=`) بدل إنتاج `??`.
 */
export function buildPlatformWatchUrl(matchId: string): string {
  const base = NEMO_WATCH_BASE_URL;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${NEMO_WATCH_ID_PARAM}=${encodeURIComponent(matchId)}`;
}

/** نوع الوجهة المحسوبة، ودرجة دقتها. */
export type WatchDestinationKind = 'verified_match_page' | 'platform_watch';

export interface WatchDestination {
  /** الرابط النهائي الذي يُفتح للمستخدم. */
  url: string;
  kind: WatchDestinationKind;
  /** هل تفتح هذه الوجهة المباراة المحددة نفسها على المنصة؟ */
  opensExactMatch: boolean;
  /** معرّف المباراة الذي استُخدم في بناء الرابط. */
  matchId: string;
  /**
   * صفحة هذه المباراة تحديدًا على المنصة إن كانت مُتحقَّقًا منها — تُعرض كرابط ثانوي
   * صغير، ولا تزاحم الزر الرئيسي. `null` إن لم توجد صفحة مطابقة موثّقة.
   */
  exactMatchUrl: string | null;
  /** نص الزر الرئيسي. */
  labelAr: string;
  /** ملاحظة صادقة أسفل الزر. */
  noteAr: string;
}

/**
 * الوصف الصادق للوجهة — مطلوب لئلا يوحي الزر للمستخدم بوجود بث نشط مُتحقَّق منه
 * لمجرد أن الرابط يعمل.
 */
const DESTINATION_COPY: Record<WatchDestinationKind, { labelAr: string; noteAr: string }> = {
  verified_match_page: {
    labelAr: '🔴 اضغط هنا لمشاهدة البث المباشر للمباراة',
    noteAr:
      'يفتح صفحة هذه المباراة تحديدًا على منصة NEMO Sports، وتظهر حالة البث الفعلية هناك.',
  },
  platform_watch: {
    labelAr: '🔴 اضغط هنا لمشاهدة البث المباشر للمباراة',
    noteAr:
      'يفتح صفحة المشاهدة على منصة NEMO Sports في تبويب جديد؛ تختار منها المباراة التي تريد متابعتها.',
  },
};

/**
 * يحلّ وجهة المشاهدة لمباراة واحدة بمعرّفها.
 *
 * @param matchId معرّف المباراة (كما يظهر في رابط صفحة التفاصيل).
 * @param verifiedMatchPageUrl صفحة المباراة المطابقة على المنصة إن كانت مُتحقَّقًا منها.
 */
export function resolveWatchDestination(input: {
  matchId: string;
  verifiedMatchPageUrl?: string | null;
  /** تجاوز النمط الافتراضي (يُستخدم في الاختبارات ولوحات الإدارة). */
  mode?: NemoWatchMode;
}): WatchDestination {
  const mode = input.mode ?? NEMO_WATCH_MODE;
  const verified = input.verifiedMatchPageUrl?.trim();
  const exactMatchUrl = verified && /^https?:\/\//i.test(verified) ? verified : null;

  /*
   * النمط الافتراضي (`gateway`): عنوان صفحة المشاهدة الصافي — بلا معرّف ولا معامل.
   * الزائر يفتح الصفحة ويختار المباراة بنفسه، وهذا ما طلبه صاحب المنتج صراحةً.
   */
  if (mode === 'gateway') {
    return {
      url: NEMO_WATCH_BASE_URL,
      kind: 'platform_watch',
      opensExactMatch: false,
      matchId: input.matchId,
      exactMatchUrl,
      ...DESTINATION_COPY.platform_watch,
    };
  }

  // نمط تجريبي اختياري: إرفاق معرّف المباراة كمعامل، أو تقديم صفحة المباراة المطابقة.
  if (mode === 'id-param' || !exactMatchUrl) {
    return {
      url: buildPlatformWatchUrl(input.matchId),
      kind: 'platform_watch',
      opensExactMatch: false,
      matchId: input.matchId,
      exactMatchUrl,
      ...DESTINATION_COPY.platform_watch,
    };
  }

  return {
    url: exactMatchUrl,
    kind: 'verified_match_page',
    opensExactMatch: true,
    matchId: input.matchId,
    exactMatchUrl,
    ...DESTINATION_COPY.verified_match_page,
  };
}

/**
 * يختار أفضل معرّف متاح للمباراة لتمريره إلى بوابة المشاهدة.
 *
 * سلسلة الأولوية (الأدق أولًا):
 *  ① `sportscoreSlug` — هو صيغة المعرّف المستخدمة فعليًا في مسارات المباريات على
 *     منصة NEMO Sports (مثل `zamalek-sc-vs-al-ahly-fc`)، فهو الأقرب لفهم المنصة له.
 *  ② `apiFootballFixtureId` — معرّف المباراة لدى مزوّد البيانات العالمي.
 *  ③ `thesportsdbEventId` — معرّف بديل من مزوّد آخر.
 *  ④ معرّف صفحة التفاصيل في البوابة (مستقر وفريد دائمًا، فلا ينتهي الرابط أبدًا).
 */
export function resolveWatchMatchId(view: ResolvedMatchView): string {
  const source = view.entry.source;
  const live = view.sourceMatch?.externalIds;

  const candidates = [
    source?.sportscoreSlug,
    live?.sportscoreSlug,
    source?.apiFootballFixtureId,
    live?.apiFootballFixtureId,
    source?.thesportsdbEventId,
    live?.thesportsdbEventId,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }

  return view.entry.id;
}

/**
 * يحلّ معرّف المباراة لسجل من المخزن (صفحات المصادر الخام خارج الكتالوج).
 *
 * كان السجل الخام يمرّر معرّفه الداخلي وحده (`match-api-football-1612251`)، وهو معرّف
 * خاص بالبوابة لا تعرفه المنصة. هنا نطبّق نفس سلسلة الأولوية المستخدمة في الكتالوج
 * (`sportscoreSlug` ← `apiFootballFixtureId` ← `thesportsdbEventId`) ثم نرجع للمعرّف
 * الداخلي كملاذ أخير — فلا تفقد أي مباراة من المصادر الخارجية وجهتها الديناميكية.
 */
export function resolveWatchMatchIdForRecord(record: {
  id: string;
  externalIds?: {
    sportscoreSlug?: string;
    apiFootballFixtureId?: string;
    thesportsdbEventId?: string;
    footballDataMatchId?: string;
  } | null;
}): string {
  const external = record.externalIds;
  const candidates = [
    external?.sportscoreSlug,
    external?.apiFootballFixtureId,
    external?.thesportsdbEventId,
    external?.footballDataMatchId,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }

  return record.id;
}

/** وجهة المشاهدة لمباراة كاملة من الكتالوج (المسار المستخدم في صفحتي التفاصيل والبث). */
export function resolveWatchDestinationForView(view: ResolvedMatchView): WatchDestination {
  return resolveWatchDestination({
    matchId: resolveWatchMatchId(view),
    verifiedMatchPageUrl: view.verifiedNemoMatchUrl,
  });
}

/** وجهة المشاهدة لسجل مباراة من المخزن معرّفه مستقر (صفحات المصادر الخام). */
export function resolveWatchDestinationForMatchId(
  matchId: string,
  verifiedMatchPageUrl?: string | null,
  mode?: NemoWatchMode
): WatchDestination {
  return resolveWatchDestination({ matchId, verifiedMatchPageUrl, mode });
}

/** وجهة المشاهدة لسجل مخزن كامل — يختار المعرّف الأفضل تلقائيًا من معرّفات المصادر. */
export function resolveWatchDestinationForRecord(record: {
  id: string;
  externalIds?: {
    sportscoreSlug?: string;
    apiFootballFixtureId?: string;
    thesportsdbEventId?: string;
    footballDataMatchId?: string;
  } | null;
  nemoLink: { verified: boolean; url: string | null };
}, mode?: NemoWatchMode): WatchDestination {
  return resolveWatchDestination({
    matchId: resolveWatchMatchIdForRecord(record),
    verifiedMatchPageUrl: record.nemoLink.verified ? record.nemoLink.url : null,
    mode,
  });
}
