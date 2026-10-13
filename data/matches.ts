import type { MatchCatalogEntry } from '@/lib/matches/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NEMO LIVE KORA — ملف المباريات المركزي (Automated Match Engine Source of Truth)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ✅ لإضافة مباراة جديدة: أضف كائنًا واحدًا إلى المصفوفة `MATCH_CATALOG` بالأسفل.
 *     بمجرد الحفظ (ثم النشر) يُنفّذ النظام أوتوماتيكيًا:
 *
 *     1) صفحة هبوط كاملة الكلمات المفتاحية      → /matches/[id]
 *     2) صفحة بث داخلية + زر مشاهدة             → /live/[id]
 *     3) بيانات SportsEvent المنظمة كاملة        → ‎<script type="application/ld+json">
 *     4) إضافة الرابط إلى خريطة الموقع فورًا     → /sitemap.xml (بتوقيت آخر تحديث)
 *     5) بطاقة المباراة في الصفحة الرئيسية تُربط داخليًا بصفحة الهبوط
 *
 *  ⚠️ قواعد صارمة (لمنع أخطاء Google Search Console):
 *     • لا تُضف `broadcast.url` إلا لرابط بث **تم التحقق منه فعليًا**، وإلا أبقِ
 *       `status: 'unverified'` و `url: null` — الصفحة ستشرح الحالة بصدق ولن تدّعي بثًا.
 *     • `kickoffUtc` يجب أن يكون ISO 8601 صحيحًا بتوقيت UTC، و`cairoDate` مطابقًا له
 *       بتوقيت القاهرة (يُتحقَّق منه في `validateMatchCatalogEntry` واختبارات المشروع).
 *     • `durationMinutes` تحدد `endDate` المتوقع (الافتراضي 120 دقيقة + وقت بدل ضائع).
 *     • `location` تُبنى تلقائيًا: `kind: 'stadium'` → Place، و`'hybrid'` → Place + VirtualLocation.
 *     • `organizer` = البطولة، و`performer` = الفريقان، و`offers` = صفحة البث المجانية.
 *     • حالة المباراة (`status`) تُترجم تلقائيًا إلى `eventStatus` صالح في Schema.org.
 */

/**
 * ① مباراة قادمة — كلاسيكو الدوري المصري (نموذج كامل الحقول).
 *    ملاحظة: `venue.kind: 'hybrid'` = المباراة في الملعب + تغطية/بث عبر الإنترنت،
 *    فيُنتج المُولّد `location` كمصفوفة [Place, VirtualLocation] مع
 *    `eventAttendanceMode: MixedEventAttendanceMode`.
 */
const ittihadVsZamalek: MatchCatalogEntry = {
  id: 'al-ittihad-alexandria-vs-zamalek-2026-10-20',
  status: 'scheduled',
  kickoffUtc: '2026-10-20T17:00:00.000Z',
  durationMinutes: 120,
  endDateUtc: null,
  cairoDate: '2026-10-20',
  homeTeam: {
    id: 'team-ittihad-alex',
    nameAr: 'الاتحاد السكندري',
    nameEn: 'Al Ittihad Alexandria',
    shortNameAr: 'الاتحاد',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/bqnmfm1786058466.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/Al%20Ittihad%20Alexandria',
  },
  awayTeam: {
    id: 'team-zamalek',
    nameAr: 'الزمالك',
    nameEn: 'Zamalek SC',
    shortNameAr: 'الزمالك',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/tgekj81580930027.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/Zamalek%20SC',
  },
  competition: {
    code: 'EGY',
    nameAr: 'الدوري المصري الممتاز',
    nameEn: 'Egyptian Premier League',
    countryAr: 'مصر',
    region: 'egypt',
    seasonLabel: '2026-2027',
    roundLabelAr: 'الجولة 7',
    competitionPageUrl: 'https://nemo-sports.vercel.app/competitions/egyptian-league',
  },
  venue: {
    kind: 'hybrid',
    name: 'استاد برج العرب بالإسكندرية',
    cityAr: 'الإسكندرية',
    cityEn: 'Alexandria',
    countryAr: 'مصر',
    countryCode: 'EG',
    onlineLabelAr: 'بث وتغطية مباشرة عبر الإنترنت — نيمو كورة لايف',
  },
  broadcast: {
    // لا يوجد بث موثّق لهذه المباراة بعد؛ الحقل `url` يبقى null ولا يُختلق رابط.
    status: 'unverified',
    url: null,
    embedUrl: null,
    labelAr: 'مشاهدة التغطية المباشرة',
    providerNameAr: 'نيمو كورة لايف',
    isFree: true,
    price: '0',
    priceCurrency: 'EGP',
    availableFromUtc: null,
    notesAr:
      'تُفتح صفحة المشاهدة الداخلية، وتظهر فيها حالة البث الفعلية عند توفرها من مصدر مُتحقَّق منه.',
  },
  keywords: [
    'مباراة الاتحاد السكندري والزمالك',
    'الاتحاد السكندري ضد الزمالك',
    'بث مباشر الاتحاد السكندري الزمالك',
    'مشاهدة مباراة الزمالك اليوم',
    'الدوري المصري الممتاز الجولة 7',
    'موعد مباراة الزمالك بتوقيت القاهرة',
    'Al Ittihad Alexandria vs Zamalek live',
  ],
  source: {
    matchId: 'match-api-football-1612263',
    provider: 'thesportsdb',
    providerMatchId: '2561134',
    thesportsdbEventId: '2561134',
    apiFootballFixtureId: '1612263',
    competitionCode: 'EGY',
    homeTeamId: 'team-ittihad-alex',
    awayTeamId: 'team-zamalek',
    cairoDate: '2026-10-20',
  },
  updatedAt: '2026-10-13T06:00:00.000Z',
};

/**
 * ② مباراة قادمة — كأس الكونفدرالية الأفريقية (مثال على بطولة أفريقية + فريق غير مصري).
 */
const zedVsAzam: MatchCatalogEntry = {
  id: 'zed-vs-azam-2026-10-16',
  status: 'scheduled',
  kickoffUtc: '2026-10-16T17:00:00.000Z',
  durationMinutes: 120,
  cairoDate: '2026-10-16',
  homeTeam: {
    id: 'team-zed',
    nameAr: 'زد إف سي',
    nameEn: 'ZED FC',
    shortNameAr: 'زد',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/dfpdle1729784943.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/ZED%20FC',
  },
  awayTeam: {
    id: 'team-tsdb-140638',
    nameAr: 'عزام التنزاني',
    nameEn: 'Azam FC',
    shortNameAr: 'عزام',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/8y9c9r1679380577.png',
    countryAr: 'تنزانيا',
    countryCode: 'TZ',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/Azam',
  },
  competition: {
    code: 'CAFC',
    nameAr: 'كأس الكونفدرالية الأفريقية',
    nameEn: 'CAF Confederation Cup',
    countryAr: 'أفريقيا',
    region: 'africa',
    seasonLabel: '2026-2027',
    roundLabelAr: 'الجولة 2',
    competitionPageUrl: 'https://nemo-sports.vercel.app/competitions/caf-confederation-cup',
  },
  venue: {
    kind: 'hybrid',
    name: 'استاد القاهرة الدولي',
    cityAr: 'القاهرة',
    cityEn: 'Cairo',
    countryAr: 'مصر',
    countryCode: 'EG',
    onlineLabelAr: 'بث وتغطية مباشرة عبر الإنترنت — نيمو كورة لايف',
  },
  broadcast: {
    status: 'unverified',
    url: null,
    labelAr: 'مشاهدة التغطية المباشرة',
    providerNameAr: 'نيمو كورة لايف',
    isFree: true,
    price: '0',
    priceCurrency: 'EGP',
  },
  keywords: [
    'مباراة زد وعزام التنزاني',
    'بث مباشر كأس الكونفدرالية الأفريقية',
    'موعد مباراة زد إف سي',
    'مشاهدة مباراة زد اليوم',
    'CAF Confederation Cup live',
  ],
  source: {
    matchId: 'match-api-football-1636497',
    provider: 'thesportsdb',
    providerMatchId: '2601875',
    thesportsdbEventId: '2601875',
    apiFootballFixtureId: '1636497',
    competitionCode: 'CAFC',
    homeTeamId: 'team-zed',
    awayTeamId: 'team-tsdb-140638',
    cairoDate: '2026-10-16',
  },
  updatedAt: '2026-10-13T06:00:00.000Z',
};

/**
 * ③ مباراة منتهية — قمة الزمالك والأهلي (11 أكتوبر 2026).
 *    مثال على: (أ) تجاوز الـ SEO اليدوي، (ب) نتيجة مؤكدة من المصدر،
 *    (ج) `kind: 'stadium'` → `location` كائن Place صافٍ بدون VirtualLocation.
 */
const zamalekVsAlAhly: MatchCatalogEntry = {
  id: 'zamalek-vs-al-ahly-2026-10-11',
  status: 'finished',
  kickoffUtc: '2026-10-11T17:00:00.000Z',
  durationMinutes: 120,
  cairoDate: '2026-10-11',
  homeTeam: {
    id: 'team-zamalek',
    nameAr: 'الزمالك',
    nameEn: 'Zamalek SC',
    shortNameAr: 'الزمالك',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/tgekj81580930027.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/Zamalek%20SC',
  },
  awayTeam: {
    id: 'team-al-ahly',
    nameAr: 'الأهلي',
    nameEn: 'Al Ahly FC',
    shortNameAr: 'الأهلي',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/x8753q1751421890.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://nemo-sports.vercel.app/teams/Al%20Ahly%20FC',
  },
  competition: {
    code: 'EGY',
    nameAr: 'الدوري المصري الممتاز',
    nameEn: 'Egyptian Premier League',
    countryAr: 'مصر',
    region: 'egypt',
    seasonLabel: '2026-2027',
    roundLabelAr: 'الجولة 6 — قمة الكرة المصرية',
    competitionPageUrl: 'https://nemo-sports.vercel.app/competitions/egyptian-league',
  },
  venue: {
    kind: 'stadium',
    name: 'استاد القاهرة الدولي',
    cityAr: 'القاهرة',
    cityEn: 'Cairo',
    countryAr: 'مصر',
    countryCode: 'EG',
  },
  broadcast: {
    status: 'not_available',
    url: null,
    labelAr: 'انتهت المباراة — الملخص والنتيجة',
    providerNameAr: null,
    isFree: true,
    price: '0',
    priceCurrency: 'EGP',
  },
  keywords: [
    'مباراة الزمالك والأهلي',
    'قمة الكرة المصرية',
    'نتيجة مباراة الزمالك ضد الأهلي',
    'ملخص الزمالك والأهلي',
    'الدوري المصري الممتاز',
  ],
  seo: {
    title: 'الزمالك ضد الأهلي | النتيجة والملخص — الدوري المصري',
    description:
      'نتيجة مباراة الزمالك ضد الأهلي في قمة الدوري المصري الممتاز بتاريخ 11 أكتوبر 2026، مع موعد المباراة وملعبها وكل التفاصيل والروابط الرسمية للمشاهدة.',
    imageUrl: null,
    keywords: ['الزمالك', 'الأهلي', 'قمة الكرة المصرية', 'الدوري المصري'],
    excludeFromSitemap: false,
  },
  source: {
    matchId: 'match-api-football-1612250',
    provider: 'sportscore',
    providerMatchId: 'l5ergph49xdlr8k',
    sportscoreSlug: 'zamalek-sc-vs-al-ahly-fc',
    thesportsdbEventId: '2561121',
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-11',
  },
  updatedAt: '2026-10-12T06:00:00.000Z',
};

/** ⬇️ الملف الذي يُبني منه الموقع بالكامل: أضف المباريات الجديدة هنا. */
export const MATCH_CATALOG: MatchCatalogEntry[] = [
  ittihadVsZamalek,
  zedVsAzam,
  zamalekVsAlAhly,
];

/** أول مباراة في الملف تُعرض كـ«مباراة الأسبوع» داخل بوابة الصفحة الرئيسية. */
export const FEATURED_MATCH_ID = ittihadVsZamalek.id;

/**
 * نموذج كامل جاهز للنسخ واللصق (⚠️ غير مضاف إلى `MATCH_CATALOG` ولا يُنشر أبدًا).
 * يوضّح شكل مباراة **لها بث مجاني مُتحقَّق منه** + بث مضمّن + تجاوزات اختيارية.
 */
export const MATCH_CATALOG_TEMPLATE: MatchCatalogEntry = {
  id: 'example-home-team-vs-away-team-2026-11-01',
  status: 'scheduled', // scheduled | live | finished | postponed | cancelled | suspended
  kickoffUtc: '2026-11-01T18:00:00.000Z', // ISO 8601 بتوقيت UTC
  durationMinutes: 120, // endDate = kickoff + 120 دقيقة
  endDateUtc: null, // ضع قيمة ISO صريحة بدلًا من الحساب التلقائي عند الحاجة
  cairoDate: '2026-11-01', // نفس اليوم بتوقيت القاهرة
  homeTeam: {
    id: 'team-example-home',
    nameAr: 'الفريق المضيف',
    nameEn: 'Home Team',
    shortNameAr: 'المضيف',
    logoUrl: 'https://example.com/home-logo.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://example.com/teams/home-team',
  },
  awayTeam: {
    id: 'team-example-away',
    nameAr: 'الفريق الضيف',
    nameEn: 'Away Team',
    shortNameAr: 'الضيف',
    logoUrl: 'https://example.com/away-logo.png',
    countryAr: 'مصر',
    countryCode: 'EG',
    teamPageUrl: 'https://example.com/teams/away-team',
  },
  competition: {
    code: 'EGY',
    nameAr: 'الدوري المصري الممتاز',
    nameEn: 'Egyptian Premier League',
    countryAr: 'مصر',
    region: 'egypt',
    seasonLabel: '2026-2027',
    roundLabelAr: 'الجولة 8',
    competitionPageUrl: 'https://example.com/competitions/egyptian-league',
  },
  venue: {
    kind: 'hybrid', // stadium | online | hybrid
    name: 'استاد القاهرة الدولي',
    cityAr: 'القاهرة',
    cityEn: 'Cairo',
    countryAr: 'مصر',
    countryCode: 'EG',
    onlineLabelAr: 'بث مباشر عبر الإنترنت',
  },
  broadcast: {
    status: 'verified_free', // verified_free | verified_paid | unverified | not_available
    url: 'https://example.com/watch/example-match',
    embedUrl: 'https://example.com/embed/example-match',
    labelAr: 'شاهد البث المباشر مجانًا',
    providerNameAr: 'اسم مزوّد البث',
    isFree: true,
    price: '0',
    priceCurrency: 'EGP', // EGP | USD | SAR | AED | EUR
    availableFromUtc: '2026-11-01T17:30:00.000Z',
    notesAr: 'البث مجاني ويبدأ قبل الانطلاق بنصف ساعة.',
  },
  keywords: [
    'الفريق المضيف ضد الفريق الضيف',
    'بث مباشر مباراة المضيف والضيف',
    'موعد مباراة المضيف والضيف بتوقيت القاهرة',
  ],
  seo: {
    title: 'الفريق المضيف ضد الفريق الضيف | بث مباشر وموعد المباراة',
    description: 'كل تفاصيل مباراة المضيف ضد الضيف: الموعد بتوقيت القاهرة، الملعب، القناة، ورابط المشاهدة.',
    imageUrl: null,
    keywords: ['الفريق المضيف', 'الفريق الضيف'],
    excludeFromSitemap: false,
  },
  source: {
    matchId: null,
    provider: 'thesportsdb',
    providerMatchId: null,
    sportscoreSlug: null,
    thesportsdbEventId: null,
    apiFootballFixtureId: null,
    competitionCode: 'EGY',
    homeTeamId: 'team-example-home',
    awayTeamId: 'team-example-away',
    cairoDate: '2026-11-01',
  },
  updatedAt: '2026-10-13T06:00:00.000Z',
  schema: {
    homeScore: null,
    awayScore: null,
    previousStartDateUtc: null,
    eventStatusOverride: null,
  },
};
