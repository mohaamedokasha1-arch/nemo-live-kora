'use client';

import React from 'react';
import Link from 'next/link';
import { formatArabicFullDate, shiftDateString } from '@/lib/cairo-time';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';
import { MatchRecord } from '@/lib/types';
import MatchCard from './MatchCard';

export interface GatewayClientProps {
  selectedDate: string;
  todayCairo: string;
  allMatchesOnDate: MatchRecord[];
}

export default function MatchGatewayClient({
  selectedDate,
  todayCairo,
  allMatchesOnDate,
}: GatewayClientProps) {
  const yesterdayDate = shiftDateString(todayCairo, -1);
  const tomorrowDate = shiftDateString(todayCairo, 1);
  const readableDate = formatArabicFullDate(selectedDate);

  return (
    <section className="kl-matches-section" aria-label="جدول المباريات">
      {/* Unified Header Box with Title + Date Badge + 3 Clean Day Buttons */}
      <div className="kl-schedule-header">
        <div className="kl-schedule-top-row">
          <h1 className="kl-section-title">أهم المباريات</h1>
          <span className="kl-date-pill">{readableDate}</span>
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
      </div>

      {/* Stack of Clean White Match Cards */}
      {allMatchesOnDate.length > 0 ? (
        <div className="kl-cards-list">
          {allMatchesOnDate.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      ) : (
        <div className="kl-empty-box">
          <p className="kl-empty-title">لا توجد مباريات مسجلة في هذا التاريخ حالياً</p>
          <div className="kl-empty-links">
            <Link href="/" className="kl-day-btn kl-day-btn-active">
              مباريات اليوم
            </Link>
            <a
              href={`${NEMO_SPORTS_BASE_URL}/matches?date=${selectedDate}`}
              target="_blank"
              rel="noopener noreferrer"
              className="kl-day-btn"
            >
              جدول NEMO Sports
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
