'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { matchesData } from '@/lib/data/matches';

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const match = matchesData.find((m) => m.id === matchId);

  if (!match) {
    return (
      <div className='min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-4xl font-bold text-white mb-4'>❌ لم نجد المباراة</h1>
          <Link
            href='/matches'
            className='inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700'
          >
            العودة إلى جدول المباريات
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black'>
      {/* رابط العودة */}
      <div className='bg-gray-800 border-b border-gray-700 py-4'>
        <div className='max-w-4xl mx-auto px-4'>
          <Link
            href='/matches'
            className='inline-flex items-center gap-2 text-blue-400 hover:text-blue-300'
          >
            ← العودة إلى الجدول
          </Link>
        </div>
      </div>

      {/* المعلومات الأساسية */}
      <div className='bg-gradient-to-b from-blue-900 to-gray-900 py-8'>
        <div className='max-w-4xl mx-auto px-4'>
          {/* البطولة */}
          <div className='flex items-center justify-center gap-2 mb-6'>
            {match.league.logo && (
              <Image
                src={match.league.logo}
                alt={match.league.name}
                width={40}
                height={40}
                className='rounded-full'
              />
            )}
            <span className='text-lg font-semibold text-blue-200'>
              {match.league.name}
            </span>
          </div>

          {/* الفريقان والنتيجة الرئيسية */}
          <div className='flex items-center justify-around mb-8'>
            {/* الفريق الأول */}
            <div className='text-center'>
              {match.homeTeam.logo && (
                <Image
                  src={match.homeTeam.logo}
                  alt={match.homeTeam.name}
                  width={80}
                  height={80}
                  className='rounded-full mx-auto mb-4 shadow-lg'
                />
              )}
              <h2 className='text-2xl font-bold text-white'>
                {match.homeTeam.name}
              </h2>
              {match.homeTeam.score !== undefined && (
                <p className='text-5xl font-bold text-blue-400 mt-2'>
                  {match.homeTeam.score}
                </p>
              )}
            </div>

            {/* الوقت والحالة */}
            <div className='text-center mx-8'>
              <div className='text-6xl font-bold text-white mb-4'>
                {match.homeTeam.score !== undefined &&
                match.awayTeam.score !== undefined
                  ? `${match.homeTeam.score} - ${match.awayTeam.score}`
                  : match.matchTime}
              </div>
              <span className='inline-block px-4 py-2 bg-blue-600 text-white rounded-full font-bold'>
                {match.status === 'live'
                  ? '🔴 مباشر'
                  : match.status === 'finished'
                  ? '✅ انتهت'
                  : '⏱️ لم تبدأ'}
              </span>
            </div>

            {/* الفريق الثاني */}
            <div className='text-center'>
              {match.awayTeam.logo && (
                <Image
                  src={match.awayTeam.logo}
                  alt={match.awayTeam.name}
                  width={80}
                  height={80}
                  className='rounded-full mx-auto mb-4 shadow-lg'
                />
              )}
              <h2 className='text-2xl font-bold text-white'>
                {match.awayTeam.name}
              </h2>
              {match.awayTeam.score !== undefined && (
                <p className='text-5xl font-bold text-blue-400 mt-2'>
                  {match.awayTeam.score}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* التفاصيل الإضافية */}
      <div className='max-w-4xl mx-auto px-4 py-8'>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {/* معلومات المباراة */}
          <div className='bg-gray-800 rounded-lg p-6 border border-gray-700'>
            <h3 className='text-xl font-bold text-white mb-4'>
              📋 معلومات المباراة
            </h3>
            <div className='space-y-3'>
              <div className='flex justify-between'>
                <span className='text-gray-400'>التاريخ:</span>
                <span className='text-white font-semibold'>
                  {new Date(match.matchDate).toLocaleDateString('ar-EG', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-400'>الوقت:</span>
                <span className='text-white font-semibold'>{match.matchTime}</span>
              </div>
              {match.matchweek && (
                <div className='flex justify-between'>
                  <span className='text-gray-400'>الجولة:</span>
                  <span className='text-white font-semibold'>
                    الجولة {match.matchweek}
                  </span>
                </div>
              )}
              {match.venue && (
                <div className='flex justify-between'>
                  <span className='text-gray-400'>الملعب:</span>
                  <span className='text-white font-semibold'>{match.venue}</span>
                </div>
              )}
              {match.referee && (
                <div className='flex justify-between'>
                  <span className='text-gray-400'>الحكم:</span>
                  <span className='text-white font-semibold'>{match.referee}</span>
                </div>
              )}
            </div>
          </div>

          {/* قنوات النقل */}
          <div className='bg-gray-800 rounded-lg p-6 border border-gray-700'>
            <h3 className='text-xl font-bold text-white mb-4'>
              📺 قنوات البث المباشر
            </h3>
            <div className='space-y-2'>
              {match.channel.length > 0 ? (
                match.channel.map((ch, idx) => (
                  <div
                    key={idx}
                    className='flex items-center gap-2 p-3 bg-red-600/20 border border-red-500/50 rounded-lg'
                  >
                    <span className='text-xl'>📡</span>
                    <span className='text-white font-semibold'>{ch}</span>
                  </div>
                ))
              ) : (
                <p className='text-gray-400'>لا توجد قنوات محددة</p>
              )}
            </div>
          </div>
        </div>

        {/* زر العودة */}
        <div className='mt-8 text-center'>
          <Link
            href='/matches'
            className='inline-block px-8 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all'
          >
            العودة إلى جدول المباريات
          </Link>
        </div>
      </div>
    </div>
  );
}
