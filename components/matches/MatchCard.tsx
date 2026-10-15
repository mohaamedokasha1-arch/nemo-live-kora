import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Match } from '@/lib/data/matches';

interface MatchCardProps {
  match: Match;
}

export const MatchCard: React.FC<MatchCardProps> = ({ match }) => {
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'live':
        return 'bg-red-500 animate-pulse';
      case 'finished':
        return 'bg-gray-600';
      default:
        return 'bg-blue-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'live':
        return 'مباشر';
      case 'finished':
        return 'انتهت';
      default:
        return match.matchTime;
    }
  };

  return (
    <Link href={`/match/${match.id}`}>
      <div className='bg-gradient-to-b from-gray-900 to-gray-800 rounded-lg overflow-hidden hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 cursor-pointer border border-gray-700'>
        {/* رأس البطاقة - معلومات البطولة */}
        <div className='flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700'>
          <div className='flex items-center gap-2'>
            {match.league.logo && (
              <Image
                src={match.league.logo}
                alt={match.league.name}
                width={20}
                height={20}
                className='rounded-full'
              />
            )}
            <span className='text-xs text-gray-300 truncate'>
              {match.league.name}
            </span>
          </div>
          <span
            className={`text-xs font-bold px-2 py-1 rounded text-white ${getStatusStyle(
              match.status
            )}`}
          >
            {getStatusText(match.status)}
          </span>
        </div>

        {/* محتوى البطاقة - الفريقان والنتيجة */}
        <div className='px-4 py-4'>
          {/* الفريق الأول */}
          <div className='flex items-center justify-between mb-3'>
            <div className='flex items-center gap-2 flex-1'>
              {match.homeTeam.logo && (
                <Image
                  src={match.homeTeam.logo}
                  alt={match.homeTeam.name}
                  width={32}
                  height={32}
                  className='rounded-full'
                />
              )}
              <span className='text-sm font-semibold text-white truncate'>
                {match.homeTeam.name}
              </span>
            </div>
            <span className='text-xl font-bold text-blue-400 ml-2'>
              {match.homeTeam.score !== undefined ? match.homeTeam.score : '-'}
            </span>
          </div>

          {/* الفاصل والتوقيت */}
          <div className='text-center py-2 border-t border-b border-gray-700 mb-3'>
            <p className='text-xs text-gray-400'>
              {new Date(`2026-10-15T${match.matchTime}`).toLocaleDateString(
                'ar-EG'
              )}
            </p>
            <p className='text-lg font-bold text-white mt-1'>
              {match.matchTime}
            </p>
          </div>

          {/* الفريق الثاني */}
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 flex-1'>
              {match.awayTeam.logo && (
                <Image
                  src={match.awayTeam.logo}
                  alt={match.awayTeam.name}
                  width={32}
                  height={32}
                  className='rounded-full'
                />
              )}
              <span className='text-sm font-semibold text-white truncate'>
                {match.awayTeam.name}
              </span>
            </div>
            <span className='text-xl font-bold text-blue-400 ml-2'>
              {match.awayTeam.score !== undefined ? match.awayTeam.score : '-'}
            </span>
          </div>
        </div>

        {/* تذييل البطاقة - القنوات */}
        {match.channel.length > 0 && (
          <div className='px-4 py-3 bg-gray-800 border-t border-gray-700'>
            <div className='flex flex-wrap gap-1'>
              {match.channel.map((ch, idx) => (
                <span
                  key={idx}
                  className='text-xs bg-red-600/30 text-red-300 px-2 py-1 rounded-full border border-red-500/50'
                >
                  📺 {ch}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
};
