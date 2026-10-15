'use client';

import React, { useState } from 'react';
import { matchesData } from '@/lib/data/matches';
import { MatchCard } from '@/components/matches/MatchCard';

type DateType = 'today' | 'tomorrow';

export default function MatchesPage() {
  const [activeDate, setActiveDate] = useState<DateType>('today');

  // تحديد التاريخ
  const today = '2026-10-15';
  const tomorrow = '2026-10-16';
  const selectedDate = activeDate === 'today' ? today : tomorrow;

  // تصفية المباريات حسب التاريخ
  const filteredMatches = matchesData.filter(
    (match) => match.matchDate === selectedDate
  );

  // تجميع المباريات حسب الدوري
  const groupedByLeague = filteredMatches.reduce((acc, match) => {
    const leagueKey = match.league.name;
    if (!acc[leagueKey]) {
      acc[leagueKey] = [];
    }
    acc[leagueKey].push(match);
    return acc;
  }, {} as Record<string, typeof filteredMatches>);

  // ترتيب البطولات (الأهم أولاً)
  const leagueOrder = [
    'الدوري المصري الممتاز',
    'دوري القسم الثاني',
    'الدوري السعودي للمحترفين',
    'دوري أبطال أوروبا',
    'الدوري الإنجليزي الممتاز',
    'الدوري الإسباني',
    'الدوري الإيطالي',
    'الدوري الألماني',
    'الدوري الفرنسي',
    'الدوري الهولندي',
    'دوري الإمارات',
    'دوري نجوم QNB',
  ];

  const sortedLeagues = Object.entries(groupedByLeague).sort((a, b) => {
    const aIndex = leagueOrder.indexOf(a[0]);
    const bIndex = leagueOrder.indexOf(b[0]);
    return (
      (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
    );
  });

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black'>
      {/* الهيدر */}
      <div className='bg-gradient-to-r from-blue-900 to-blue-800 py-8 border-b-4 border-blue-600'>
        <div className='max-w-7xl mx-auto px-4'>
          <h1 className='text-4xl font-bold text-white mb-4'>
            📅 جدول المباريات
          </h1>
          <p className='text-blue-200 text-lg'>
            اختر اليوم لمشاهدة جميع المباريات
          </p>
        </div>
      </div>

      {/* المفاتيح العلوية (اليوم / غدًا) */}
      <div className='bg-gray-800 border-b border-gray-700 sticky top-0 z-10'>
        <div className='max-w-7xl mx-auto px-4 py-4'>
          <div className='flex gap-4'>
            <button
              onClick={() => setActiveDate('today')}
              className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${
                activeDate === 'today'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🗓️ اليوم (الخميس 15 أكتوبر)
            </button>
            <button
              onClick={() => setActiveDate('tomorrow')}
              className={`px-6 py-3 rounded-lg font-bold transition-all duration-300 ${
                activeDate === 'tomorrow'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🗓️ غدًا (الجمعة 16 أكتوبر)
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
            {sortedLeagues.map(([leagueName, matches]) => (
              <div key={leagueName} className=''>
                {/* عنوان البطولة */}
                <div className='flex items-center gap-3 mb-4 pb-3 border-b-2 border-blue-600'>
                  <span className='text-2xl'>⚽</span>
                  <h2 className='text-2xl font-bold text-white'>
                    {leagueName}
                  </h2>
                  <span className='ml-auto text-sm text-gray-400'>
                    ({matches.length} مباراة)
                  </span>
                </div>

                {/* شبكة المباريات */}
                <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                  {matches.map((match) => (
                    <MatchCard key={match.id} match={match} />
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
                {Math.max(...filteredMatches.map((m) => m.channel.length))}
              </p>
              <p className='text-gray-300'>قنوات النقل</p>
            </div>
            <div className='text-center'>
              <p className='text-3xl font-bold text-red-400'>
                {new Set(
                  filteredMatches.map((m) => m.league.country)
                ).size}
              </p>
              <p className='text-gray-300'>دول</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
