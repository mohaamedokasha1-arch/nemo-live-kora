import { ImageResponse } from 'next/og';
import { formatArabicFullDate, isValidDateParam } from '@/lib/cairo-time';
import { findCatalogEntriesByCairoDate, resolveMatchView } from '@/lib/matches/match-catalog';
import { findCatalogEntryById } from '@/lib/matches/match-links';
import {
  OG_IMAGE_CONTENT_TYPE,
  OG_IMAGE_SIZE,
  OG_THEME,
  loadOgFonts,
} from '@/lib/seo/og-image';
import { OgText } from '@/lib/seo/og-text';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  صورة المشاركة لكل مباراة — ‎/matches/[id]/opengraph-image
 * ═══════════════════════════════════════════════════════════════════════════════
 *  تُولَّد أوتوماتيكيًا بمقاس **1200×675** (النسبة 16:9 التي تطلبها Google) بمجرد
 *  إضافة المباراة إلى `data/matches.ts` — بدون أي تصميم يدوي ولا أي خطوة إضافية.
 *
 *  الفائدة المباشرة في Search Console:
 *   • إزالة تحذير «Image too small»: كان الحدث يشير إلى شعارات الفرق (مربّعة وصغيرة
 *     ومُستضافة على نطاق خارجي)، وهذا لا يستوفي شرط Google (عرض ≥ 720px).
 *   • إزالة خطأ «Missing field image» نهائيًا: الصورة موجودة لكل مباراة دائمًا وللأبد
 *     لأنها تُولَّد من نفس ملف البيانات.
 *   • صورة مُستضافة على نطاق الموقع → قابلة للزحف دائمًا بخلاف صور CDN الخارجية.
 *   • بطاقة عربية أنيقة عند مشاركة رابط المباراة على الشبكات الاجتماعية.
 *
 *  يخدم المسار الحالتين معًا (مثل الصفحة نفسها):
 *   • /matches/[id]        → بطاقة المباراة (الفريقان + الموعد + الملعب).
 *   • /matches/2026-10-20  → بطاقة جدول اليوم (التاريخ + عدد المباريات).
 *
 *  ⚠️ ثلاث قواعد إلزامية عند تعديل هذا الملف (كلها نتائج قياس فعلي):
 *   1) لا تستخدم `React.Fragment` — Satori يتعامل معه بشكل خاطئ ويُسقط بقية الأقسام.
 *   2) كل `div` يحتوي أكثر من عنصر ابن يجب أن يحمل `display: 'flex'` صريحًا.
 *   3) كل نص عربي/مختلط يُعرض عبر مكوّن `OgText` (وليس كنص خام) لضمان ترتيب وتباعد
 *      الكلمات — راجع `lib/seo/og-text.tsx` لتفاصيل المشكلة والحل.
 */

export const runtime = 'nodejs';
export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;
export const alt = 'نيمو كورة لايف — بطاقة المباراة';

/**
 * إعادة التوليد مرة كل ساعة: البطاقة تتغيّر مع تغيّر حالة المباراة (النتيجة، «انتهت»،
 * «جارية الآن») لكنها لا تتغيّر لحظيًا. التخزين المؤقت هنا مهم لأن Googlebot وزواحف
 * الشبكات الاجتماعية تطلب الصورة منفصلة عن الصفحة، وبدون تخزين تُعاد عملية الرسم
 * (Satori) في كل طلب بلا داعٍ.
 */
export const revalidate = 3600;

/**
 * عرض عمود كل فريق وشارة المنتصف.
 * المجموع 380 + 200 + 380 = 960 داخل عرض 1080 (بعد هوامش 60 يمينًا و60 يسارًا)
 * مع فراغين 20 → الرصيد المتبقي أمان لتفادي أي كسر في السطر.
 */
const TEAM_COLUMN_WIDTH = 380;
const BADGE_WIDTH = 200;

const shellStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: '50px 60px',
  fontFamily: 'Cairo',
  background: `linear-gradient(135deg, ${OG_THEME.bgOuter} 0%, ${OG_THEME.bgInner} 55%, ${OG_THEME.bgOuter} 100%)`,
  color: OG_THEME.text,
};

/** شريط حالة/بطولة بإطار دائري — نصه مركزي. */
function Chip({
  text,
  color,
  maxLength = 40,
}: {
  text: string;
  color?: string;
  maxLength?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        background: OG_THEME.chipBg,
        border: `2px solid ${OG_THEME.chipBorder}`,
        borderRadius: 999,
        padding: '10px 26px',
        fontSize: 27,
        color: color ?? OG_THEME.text,
      }}
    >
      <OgText align="center" gap={7} maxLength={maxLength}>
        {text}
      </OgText>
    </div>
  );
}

/**
 * اسم فريق داخل عمود بعرض ثابت.
 *
 * ⚠️ لماذا عرض ثابت بدل `flex: 1`؟
 * Satori يحسب `flex-basis: 0` بطرق غير متوقعة، فانقسمت أسماء الفرق على أسطر غير
 * متوازنة وخرج شريط «ضد» عن مركزه. العمود الثابت (380px) + صف بـ row-reverse يضمن
 * أن الفريقين متساويان تمامًا وأن الشارة في المنتصف بغض النظر عن طول الأسماء.
 *
 * الالتفاف مسموح (wrap) مع محاذاة مركزية، فيظهر الاسم الطويل على سطرين متناظرين
 * حول المنتصف بدل أن يخرج عن البطاقة.
 */
function TeamName({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        width: TEAM_COLUMN_WIDTH,
        minHeight: 132,
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: 46,
        fontWeight: 700,
        lineHeight: 1.3,
      }}
    >
      <OgText align="center" gap={16} maxLength={34} wrap style={{ width: '100%' }}>
        {text}
      </OgText>
    </div>
  );
}

/** تذييل البطاقة: الهوية على اليمين وزر الإجراء على اليسار. */
function Footer({ note }: { note: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row-reverse',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        borderTop: `2px solid ${OG_THEME.chipBorder}`,
        paddingTop: 24,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', fontSize: 33, fontWeight: 700 }}>
          <OgText gap={9} maxLength={30}>{'نيمو كورة لايف'}</OgText>
        </div>
        <div style={{ display: 'flex', fontSize: 22, color: OG_THEME.muted }}>
          <OgText gap={6} maxLength={30}>{'NEMO Sports'}</OgText>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 27,
          fontWeight: 700,
          color: '#04140a',
          background: OG_THEME.accent,
          borderRadius: 999,
          padding: '14px 32px',
        }}
      >
        <OgText align="center" gap={8} maxLength={30}>
          {note}
        </OgText>
      </div>
    </div>
  );
}

/** بطاقة احتياطية لمعرّف غير موجود في الكتالوج (تمنع إخراج ImageResponse فارغًا). */
function FallbackCard() {
  return (
    <div style={shellStyle}>
      <div style={{ display: 'flex', flexDirection: 'row-reverse', width: '100%' }}>
        <Chip text="نيمو كورة لايف" color={OG_THEME.accent} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 16 }}>
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 700 }}>
          <OgText gap={14} maxLength={40}>{'جدول المباريات والبث المباشر'}</OgText>
        </div>
        <div style={{ display: 'flex', fontSize: 29, color: OG_THEME.muted }}>
          <OgText gap={8} maxLength={70}>
            {'مواعيد المباريات ونتائجها بتوقيت القاهرة على نيمو كورة لايف'}
          </OgText>
        </div>
      </div>
      <Footer note="جدول المباريات" />
    </div>
  );
}

/** بطاقة مباراة واحدة من كتالوج `data/matches.ts`. */
function MatchCard({ matchId }: { matchId: string }) {
  const entry = findCatalogEntryById(matchId);
  if (!entry) return <FallbackCard />;

  const view = resolveMatchView(entry);
  const statusColor = view.isLive
    ? OG_THEME.live
    : view.isFinished
    ? OG_THEME.muted
    : view.status === 'postponed' || view.status === 'cancelled'
    ? OG_THEME.warn
    : OG_THEME.accent;

  const round = entry.competition.roundLabelAr ? ` — ${entry.competition.roundLabelAr}` : '';
  const competitionText = `${entry.competition.nameAr}${round}`;

  const scoreText =
    view.score && Number.isFinite(view.score.home) && Number.isFinite(view.score.away)
      ? `${view.score.home} - ${view.score.away}`
      : 'ضد';

  return (
    <div style={shellStyle}>
      {/* الصف الأول: شريط البطولة على اليمين وحالة المباراة على اليسار */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row-reverse',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <Chip text={competitionText} color={statusColor} maxLength={62} />
        <Chip text={view.statusLabelAr} maxLength={30} />
      </div>

      {/* صف الفريقين: المستضيف يمينًا، والضيف يسارًا، والحالة في المنتصف */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row-reverse',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          gap: 20,
        }}
      >
        <TeamName text={entry.homeTeam.nameAr} />
        <div
          style={{
            display: 'flex',
            width: BADGE_WIDTH,
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: 30,
            fontWeight: 700,
            color: OG_THEME.bgOuter,
            background: OG_THEME.text,
            borderRadius: 20,
            padding: '14px 0',
          }}
        >
          <OgText align="center" gap={8} maxLength={12}>
            {scoreText}
          </OgText>
        </div>
        <TeamName text={entry.awayTeam.nameAr} />
      </div>

      {/* الموعد والملعب */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 8 }}>
        <div style={{ display: 'flex', fontSize: 31 }}>
          <OgText gap={9} maxLength={78}>
            {`${view.cairoDateLabelAr} — ${view.kickoffTimeAr} بتوقيت القاهرة`}
          </OgText>
        </div>
        <div style={{ display: 'flex', fontSize: 25, color: OG_THEME.muted }}>
          <OgText gap={7} maxLength={64}>
            {view.venueName}
          </OgText>
        </div>
      </div>

      <Footer note={view.isFinished ? 'النتيجة والملخص' : 'شاهد البث المباشر'} />
    </div>
  );
}

/** بطاقة جدول مباريات تاريخ معيّن (نفس مسار /matches/[id]). */
function DateCard({ cairoDate }: { cairoDate: string }) {
  const entries = findCatalogEntriesByCairoDate(cairoDate);
  const readableDate = formatArabicFullDate(cairoDate);
  const subtitle =
    entries.length > 0
      ? `${entries.length} مباراة موثّقة بتوقيت القاهرة`
      : 'تابع جدول المباريات ومواعيدها بتوقيت القاهرة';

  return (
    <div style={shellStyle}>
      <div style={{ display: 'flex', flexDirection: 'row-reverse', width: '100%' }}>
        <Chip text="جدول المباريات" color={OG_THEME.accent} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 14 }}>
        <div style={{ display: 'flex', fontSize: 58, fontWeight: 700 }}>
          <OgText gap={14} maxLength={42}>{`مباريات ${readableDate}`}</OgText>
        </div>
        <div style={{ display: 'flex', fontSize: 29, color: OG_THEME.muted }}>
          <OgText gap={8} maxLength={60}>
            {subtitle}
          </OgText>
        </div>
        {entries.slice(0, 4).map((entry) => (
          <div
            key={entry.id}
            style={{ display: 'flex', fontSize: 29, color: OG_THEME.text }}
          >
            <OgText gap={8} maxLength={52}>
              {`${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr}`}
            </OgText>
          </div>
        ))}
      </div>

      <Footer note="جدول المباريات" />
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = (() => {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  })();

  const fonts = await loadOgFonts();
  const content = isValidDateParam(decoded) ? (
    <DateCard cairoDate={decoded} />
  ) : (
    <MatchCard matchId={decoded} />
  );

  return new ImageResponse(content, { ...OG_IMAGE_SIZE, fonts });
}
