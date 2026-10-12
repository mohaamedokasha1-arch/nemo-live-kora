export type SourceId =
  | 'sportscore'
  | 'football-data'
  | 'thesportsdb'
  | 'api-football'
  | 'google-news-rss';

export type SourceHealthStatus =
  | 'active'
  | 'partial_keyless'
  | 'requires_api_key'
  | 'degraded'
  | 'error';

export type CompetitionRegion =
  | 'egypt'
  | 'africa'
  | 'arab'
  | 'europe'
  | 'world'
  | 'americas'
  | 'asia';

export type MatchStatusCode =
  | 'not_started'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'unconfirmed';

export type NemoLinkType =
  | 'direct_match'
  | 'competition_fallback'
  | 'schedule_fallback'
  | 'unavailable';

export type NemoMatchCriterion =
  | 'original_match_id'
  | 'competition_id'
  | 'team_ids'
  | 'match_date'
  | 'mapping_table';

export interface SourceDefinition {
  id: SourceId;
  name: string;
  nameAr: string;
  type: 'REST JSON API' | 'RSS 2.0 XML Feed';
  baseUrl: string;
  requiresKey: boolean;
  keyEnvVar: string | null;
  isKeyConfigured: boolean;
  status: SourceHealthStatus;
  statusLabelAr: string;
  dataTypesProvided: string[];
  rateLimitPolicy: string;
  testedEndpoints: string[];
  lastSyncAt: string | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  recordsImported: number;
  errorCount: number;
  notesAr: string;
}

export interface CompetitionRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  countryAr: string;
  countryEn: string;
  region: CompetitionRegion;
  priority: number;
  isEgyptianPriority: boolean;
  logoUrl: string | null;
  nemoCompetitionSlug: string | null;
  currentSeason: string;
  sourceIds: {
    sportscoreSlug?: string;
    thesportsdbId?: string;
    footballDataCode?: string;
    apiFootballId?: number;
  };
}

export interface SeasonRecord {
  id: string;
  competitionId: string;
  competitionCode: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  currentMatchday: number | null;
  sourceId: SourceId;
}

export interface TeamRecord {
  id: string;
  nameAr: string;
  nameEn: string;
  shortNameAr: string;
  countryAr: string;
  countryEn: string;
  logoUrl: string | null;
  isEgyptian: boolean;
  isNationalTeam: boolean;
  stadium: string | null;
  nemoTeamUrl: string | null;
  externalIds: {
    sportscoreSlug?: string;
    thesportsdbId?: string;
    footballDataId?: number;
    apiFootballId?: number;
  };
}

export interface NemoLinkResolution {
  url: string | null;
  linkType: NemoLinkType;
  labelAr: string;
  subLabelAr: string;
  verified: boolean;
  matchedBy: NemoMatchCriterion[];
  competitionUrl: string | null;
  scheduleUrl: string;
}

export interface MatchTeamSummary {
  id: string;
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  isEgyptian: boolean;
  nemoTeamUrl?: string | null;
}

export interface MatchScore {
  home: number | null;
  away: number | null;
  halfTimeHome?: number | null;
  halfTimeAway?: number | null;
}

export interface MatchIncidentSummary {
  minute: number;
  type: 'goal' | 'penalty_goal' | 'yellow_card' | 'red_card' | 'substitution';
  side: 'home' | 'away';
  player: string;
  detail?: string;
}

export interface MatchRecord {
  id: string;
  competitionId: string;
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  competitionLogo: string | null;
  countryAr: string;
  region: CompetitionRegion;
  priority: number;
  isEgyptianInterest: boolean;
  seasonLabel: string;
  roundLabelAr: string | null;
  utcKickoff: string;
  cairoDate: string;
  cairoTime: string;
  homeTeam: MatchTeamSummary;
  awayTeam: MatchTeamSummary;
  status: MatchStatusCode;
  statusLabelAr: string;
  statusNoteAr: string | null;
  liveMinute: number | null;
  score: MatchScore;
  incidents?: MatchIncidentSummary[];
  venue: string | null;
  primarySource: SourceId;
  contributingSources: SourceId[];
  externalIds: {
    sportscoreSlug?: string;
    sportscoreTrackerId?: string;
    thesportsdbEventId?: string;
    apiFootballFixtureId?: string;
    footballDataMatchId?: string;
  };
  nemoLink: NemoLinkResolution;
  lastUpdatedAt: string;
}

export interface StandingRowRecord {
  position: number;
  teamId: string;
  teamNameAr: string;
  teamNameEn: string;
  teamLogo: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  noteAr?: string | null;
  nemoTeamUrl?: string | null;
}

export interface CompetitionStandingTable {
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  competitionLogo: string | null;
  seasonLabel: string;
  sourceId: SourceId;
  updatedAt: string;
  nemoCompetitionUrl: string | null;
  rows: StandingRowRecord[];
}

export interface NewsItemRecord {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  cairoDate: string;
  cairoTimeLabel: string;
  publisherName: string;
  publisherUrl: string | null;
  language: 'ar' | 'en';
  categoryAr: string;
  sourceId: 'google-news-rss';
}

export interface NemoMappingEntry {
  canonicalMatchId: string;
  sportscoreSlug: string | null;
  thesportsdbEventId: string | null;
  apiFootballFixtureId: string | null;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  verifiedNemoMatchSlug: string | null;
  verifiedNemoCompetitionSlug: string | null;
  verifiedAt: string;
  verificationNoteAr: string;
}

export interface SourceSyncResult {
  sourceId: SourceId;
  status: SourceHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  matchesFetched: number;
  standingsFetched: number;
  newsFetched: number;
  usedCachedSnapshot: boolean;
  messageAr: string;
}

export interface SyncLogEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: 'live' | 'daily' | 'standings' | 'manual';
  trigger: string;
  sourceResults: SourceSyncResult[];
  totalMatchesInStore: number;
  totalStandingsInStore: number;
  totalNewsInStore: number;
}

export interface SourceErrorEntry {
  id: string;
  sourceId: SourceId;
  timestamp: string;
  endpoint: string;
  httpStatus: number | null;
  errorCode: string;
  message: string;
  messageAr: string;
}

export interface GatewayDatabase {
  meta: {
    schemaVersion: string;
    gatewayName: string;
    mainSiteUrl: string;
    timezone: string;
    lastFullSyncAt: string;
    lastLiveSyncAt: string;
  };
  sources: Record<SourceId, SourceDefinition>;
  competitions: CompetitionRecord[];
  seasons: SeasonRecord[];
  teams: TeamRecord[];
  matches: MatchRecord[];
  standings: Record<string, CompetitionStandingTable>;
  news: NewsItemRecord[];
  nemoMappingTable: NemoMappingEntry[];
  syncLogs: SyncLogEntry[];
  sourceErrors: SourceErrorEntry[];
}
