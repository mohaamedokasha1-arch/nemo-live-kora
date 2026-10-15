'use client';

import React, { useState } from 'react';
import { formatArabicShortDate } from '@/lib/cairo-time';
import { MatchRecord } from '@/lib/types';
import MatchCard from '@/components/MatchCard';
import ScheduleAutoRefresh from '@/components/ScheduleAutoRefresh';

type DateType = 'today' | 'tomorrow';

/**
 * صفحة «جدول المباريات» (`/matches`): تبويبا اليوم والغد.
 *
 * التخطيط (العناوين، التبويبان، التجميع حسب البطولة، شريط الإحصاءات) هو نفسه الذي كانت عليه
 * الصفحة؛ الذي تغيّر هو **مصدر البيانات فقط**: كانت تقرأ قائمة ثابتة مكتوبة يدويًا بتاريخين
 * ثابتين (15 و16 أكتوبر) وشعارات وقنوات مُفترضة، فصارت تقرأ مباريات المخزن الحقيقية
 * (SportScore + TheSportsDB) لتاريخَي اليوم والغد **بتوقيت القاهرة** المحسوبين على الخادم في
 * كل طلب — فتنتقل الصفحة وحدها إلى التاريخين الجديدين بعد منتصف الليل.
 * البطاقات هي بطاقات الموقع نفسها (`components/MatchCard`)، وتقود إلى صفحة تفاصيل كل مباراة.
 */
export default function MatchesScheduleTabs({
  todayCairo,
  tomorrowCairo,
  todayMatches,
  tomorrowMatches,
  landingPaths,
}: {
  todayCairo: string;
  tomorrowCairo: string;
  todayMatches: MatchRecord[];
  tomorrowMatches: MatchRecord[];
  landingPaths?: Record<string, string>;
}) {
  const [activeDate, setActiveDate] = useState<DateType>('today');

  const filteredMatches = activeDate === 'today' ? todayMatches : tomorrowMatches;

  // تجميع المباريات حسب البطولة — بترتيب الأولوية القادم من المخزن (الكرة المصرية أولًا)
  const groupedByLeague = new Map<string, { priority: number; matches: MatchRecord[] }>();
  for (const match of filteredMatches) {
    const leagueKey = match.competitionNameAr;
    const group = groupedByLeague.get(leagueKey);
    if (group) {
      group.matches.push(match);
      group.priority = Math.min(group.priority, match.priority);
    } else {
      groupedByLeague.set(leagueKey, { priority: match.priority, matches: [match] });
    }
  }
  const sortedLeagues = Array.from(groupedByLeague.entries()).sort(
    (a, b) => a[1].priority - b[1].priority
  );

  const egyptianCount = filteredMatches.filter((m) => m.isEgyptianInterest).length;
  const countriesCount = new Set(filteredMatches.map((m) => m.countryAr)).size;

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black'>
      <ScheduleAutoRefresh
        todayCairo={todayCairo}
        hasLiveMatches={todayMatches.some((m) => m.status === 'live')}
      />
      {/* الهيدر */}
      <div className='bg-gradient-to-r from-blue-900 to-blue-800 py-8 border-b-4 border-blue-600'>
        <div className='max-w-7xl mx-auto px-4'>
          <h1 className='text-4xl font-bold text-white mb-4'>
            📅 جدول المباريات
          </h1>
          <p className='text-blue-200 text-lg'>
            اختر اليوم لمشاهدة جميع المباريات · المواعيد بتوقيت القاهرة
          </p>
        </div>
      </div>

      {/* المفاتيح العلوية (اليوم / غدًا) */}
      <div className='bg-gray-800 border-b border-gray-700 sticky top-0 z-10'>
        <div className='max-w-7xl mx-auto px-4 py-4'>
          <div className='flex gap-4'>
            <button
              onClick={() => setActiveDate('today')}
              aria-pressed={activeDate === 'today'}
              className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${
                activeDate === 'today'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🗓️ اليوم ({formatArabicShortDate(todayCairo)})
            </button>
            <button
              onClick={() => setActiveDate('tomorrow')}
              aria-pressed={activeDate === 'tomorrow'}
              className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${
                activeDate === 'tomorrow'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🗓️ غدًا ({formatArabicShortDate(tomorrowCairo)})
            </button>
          </div>
        </div>
      </div>

      {/* المحتوى الرئيسي */}
      <div className='max-w-7xl mx-auto px-4 py-8'>
        {filteredMatches.length === 0 ? (
          <div className='text-center py-16'>
            <p className='text-2xl text-gray-400'>
              لا توجد مباريات في هذا اليوم
            </p>
          </div>
        ) : (
          <div className='space-y-8'>
            {sortedLeagues.map(([leagueName, group]) => (
              <div key={leagueName} className=''>
                {/* عنوان البطولة */}
                <div className='flex items-center gap-3 mb-4 pb-3 border-b-2 border-blue-600'>
                  <span className='text-2xl'>⚽</span>
                  <h2 className='text-2xl font-bold text-white'>
                    {leagueName}
                  </h2>
                  <span className='ml-auto text-sm text-gray-400'>
                    ({group.matches.length} مباراة)
                  </span>
                </div>

                {/* شبكة المباريات */}
                <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 kl-cards-list'>
                  {group.matches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      landingPath={landingPaths?.[match.id] ?? null}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* إحصائيات */}
      <div className='bg-gray-800 border-t border-gray-700 py-6 mt-12'>
        <div className='max-w-7xl mx-auto px-4'>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
            <div className='text-center'>
              <p className='text-3xl font-bold text-blue-400'>
                {filteredMatches.length}
              </p>
              <p className='text-gray-300'>إجمالي المباريات</p>
            </div>
            <div className='text-center'>
              <p className='text-3xl font-bold text-green-400'>
                {sortedLeagues.length}
              </p>
              <p className='text-gray-300'>عدد البطولات</p>
            </div>
            <div className='text-center'>
              <p className='text-3xl font-bold text-yellow-400'>
                {egyptianCount}
              </p>
              <p className='text-gray-300'>مباريات الكرة المصرية</p>
            </div>
            <div className='text-center'>
              <p className='text-3xl font-bold text-red-400'>
                {countriesCount}
              </p>
              <p className='text-gray-300'>دول</p>
            </div>
          </div>
          {/* نسب البيانات المطلوب في شروط SportScore المجانية */}
          <p className='kl-news-updated kl-source-attribution'>
            بيانات المباريات من{' '}
            <a href='https://sportscore.com/' rel='dofollow' title='Sports data by SportScore'>
              SportScore
            </a>{' '}
            وTheSportsDB
          </p>
        </div>
      </div>
    </div>
  );
}
