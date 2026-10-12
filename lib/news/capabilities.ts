import { SourceId } from '../types';

export interface SourceCapability {
  sourceId: SourceId;
  providesMatches: boolean;
  providesStandings: boolean;
  providesNews: boolean;
  accessType: 'REST JSON API' | 'RSS 2.0 XML Feed';
  newsAccessNoteAr: string;
}

export const SOURCE_CAPABILITIES: Record<SourceId, SourceCapability> = {
  sportscore: {
    sourceId: 'sportscore',
    providesMatches: true,
    providesStandings: true,
    providesNews: false,
    accessType: 'REST JSON API',
    newsAccessNoteAr:
      'مصدر مباريات وترتيب فقط. لا يوفّر خلاصة أخبار أو مقالات، ولا يُعرض كمصدر أخبار ناجح.',
  },
  'football-data': {
    sourceId: 'football-data',
    providesMatches: true,
    providesStandings: true,
    providesNews: false,
    accessType: 'REST JSON API',
    newsAccessNoteAr:
      'مصدر بطولات ومواسم ومباريات. لا يوفّر أخبارًا. مسار المباريات يتطلب FOOTBALL_DATA_API_KEY.',
  },
  thesportsdb: {
    sourceId: 'thesportsdb',
    providesMatches: true,
    providesStandings: false,
    providesNews: false,
    accessType: 'REST JSON API',
    newsAccessNoteAr:
      'مصدر جدول مباريات وشعارات. لا يوفّر واجهة أخبار. لا تُنشأ أخبار من نتائج المباريات.',
  },
  'api-football': {
    sourceId: 'api-football',
    providesMatches: true,
    providesStandings: false,
    providesNews: false,
    accessType: 'REST JSON API',
    newsAccessNoteAr:
      'مصدر إثراء للمباريات والنتائج الحية عند ضبط API_FOOTBALL_KEY. لا يوفّر أخبارًا.',
  },
  'google-news-rss': {
    sourceId: 'google-news-rss',
    providesMatches: false,
    providesStandings: false,
    providesNews: true,
    accessType: 'RSS 2.0 XML Feed',
    newsAccessNoteAr:
      'المصدر الوحيد بين المصادر الخمسة الذي يوفّر عناوين أخبار رياضية عبر RSS، مع نسبة الخبر للناشر الأصلي دون نسخ النص الكامل.',
  },
};

export function sourceProvidesNews(sourceId: SourceId): boolean {
  return SOURCE_CAPABILITIES[sourceId].providesNews;
}
