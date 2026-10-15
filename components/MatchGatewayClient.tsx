'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatArabicFullDate, isValidDateParam, shiftDateString } from '@/lib/cairo-time';
import { MatchRecord } from '@/lib/types';
import AdsterraBanner from './AdsterraBanner';
import AdsterraNative from './AdsterraNative';
import MatchCard from './MatchCard';

export interface GatewayClientProps {
  selectedDate: string;
  todayCairo: string;
  allMatchesOnDate: MatchRecord[];
  /** وصف آخر محاولة جلب للمباريات (ناجحة أو فاشلة) — يُحسب على الخادم */
  freshnessNote?: string | null;
  /** خريطة `معرّف المباراة ← مسار صفحتها الداخلية` محسوبة على الخادم. */
  landingPaths?: Record<string, string>;
}

export default function MatchGatewayClient({
  selectedDate,
  todayCairo,
  allMatchesOnDate,
  freshnessNote,
  landingPaths,
}: GatewayClientProps) {
  const router = useRouter();
  const yesterdayDate = shiftDateString(todayCairo, -1);
  const tomorrowDate = shiftDateString(todayCairo, 1);
  const readableDate = formatArabicFullDate(selectedDate);
  /**
   * موضع الإعلان المدمج (Native) داخل قائمة المباريات: بعد الكرت الرابع.
   * الشرط `>= 4` يمنع ظهور إعلان في وسط قائمة قصيرة (يوم بمباراتين فقط) لأنه
   * سيلتفّ حوله المحتوى ويبدو مقحَمًا؛ وفي تلك الحالة يظهر بانر أسفل القائمة فقط.
   */
  const inFeedAdIndex = allMatchesOnDate.length >= 4 ? 3 : -1;

  return (
    <section className="kl-matches-section" aria-label="جدول المباريات">
      {/* Unified Header Box with Title + Date Badge + 3 Clean Day Buttons */}
      <div className="kl-schedule-header">
        <div className="kl-schedule-top-row">
          <h1 className="kl-section-title">
            {selectedDate === todayCairo ? 'مباريات اليوم' : `مباريات ${readableDate}`}
          </h1>
          <span className="kl-date-pill">
            {selectedDate === todayCairo ? `${readableDate} · توقيت القاهرة` : 'توقيت القاهرة'}
          </span>
        </div>

        <div className="kl-day-switcher" role="navigation" aria-label="التنقل بين الأيام">
          <Link
            href={`/matches/${yesterdayDate}`}
            className={`kl-day-btn ${selectedDate === yesterdayDate ? 'kl-day-btn-active' : ''}`}
          >
            مباريات الأمس
          </Link>

          <Link
            href="/"
            className={`kl-day-btn ${selectedDate === todayCairo ? 'kl-day-btn-active' : ''}`}
          >
            مباريات اليوم
          </Link>

          <Link
            href={`/matches/${tomorrowDate}`}
            className={`kl-day-btn ${selectedDate === tomorrowDate ? 'kl-day-btn-active' : ''}`}
          >
            مباريات الغد
          </Link>
        </div>

        {freshnessNote ? (
          <p className="kl-news-updated kl-sync-note" role="status">
            {freshnessNote}
          </p>
        ) : null}

        <div className="kl-date-picker-row">
          <label htmlFor="match-date-picker">اختر تاريخًا لعرض المباريات</label>
          <input
            id="match-date-picker"
            type="date"
            value={selectedDate}
            onChange={(event) => {
              const nextDate = event.currentTarget.value;
              if (!isValidDateParam(nextDate)) return;
              router.push(nextDate === todayCairo ? '/' : `/matches/${nextDate}`);
            }}
          />
        </div>
      </div>

      {/* Stack of Clean White Match Cards */}
      {allMatchesOnDate.length > 0 ? (
        <div className="kl-cards-list">
          {allMatchesOnDate.map((match, index) => (
            <React.Fragment key={match.id}>
              <MatchCard match={match} landingPath={landingPaths?.[match.id] ?? null} />
              {/*
                الإعلان المدمج في الوسط: بنفس بطاقة الموقع (حدود وزوايا وظل) فيبدو
                جزءًا طبيعيًا من القائمة لا جسيمًا دخيلًا، مع وسم «إعلان» الصغير.
              */}
              {index === inFeedAdIndex ? (
                <AdsterraNative
                  className="kl-ad-native-in-feed"
                  label="مساحة إعلانية مدفوعة داخل قائمة المباريات"
                />
              ) : null}
            </React.Fragment>
          ))}
          {/* جانب المحتوى على شاشات الكمبيوتر وأسفل القائمة على الهاتف */}
          <AdsterraBanner
            size="300x250"
            className="kl-ad-after-cards"
            label="مساحة إعلانية أسفل جدول المباريات"
          />
        </div>
      ) : (
        <div className="kl-empty-box">
          <p className="kl-empty-title">لا توجد مباريات مسجلة في هذا التاريخ حالياً</p>
          <div className="kl-empty-links">
            <Link href="/" className="kl-day-btn kl-day-btn-active">
              مباريات اليوم
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
