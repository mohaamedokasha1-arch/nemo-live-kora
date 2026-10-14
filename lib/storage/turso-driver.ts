import type { GatewayDatabase, MatchRecord, NewsItemRecord } from '../types';
import {
  FetchLike,
  StorageDriver,
  StoragePingResult,
  StorageReadResult,
  StorageWriteResult,
  isGatewayDatabaseShape,
  resolveFetch,
  withTimeout,
} from './types';

export interface TursoDriverOptions {
  /** e.g. https://nemo-gateway.turso.io (also accepts LIBSQL_URL / TURSO_DATABASE_URL). */
  url: string;
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Statement budget per pipeline request; keeps a big dataset inside provider limits. */
  statementsPerPipeline?: number;
}

interface PipelineRequest {
  type: 'execute';
  stmt: { sql: string; args?: Array<{ type: string; value: string | number | null }> };
  want_rows?: boolean;
}

function text(value: string | null | undefined) {
  return { type: 'text', value: value ?? null };
}
function integer(value: number | null) {
  return { type: 'integer', value: value === null || !Number.isFinite(value) ? null : value };
}

/**
 * Turso / libSQL cloud database driver (HTTP API).
 *
 * This is the recommended production backend: a real hosted SQL database, reachable over plain
 * HTTPS from a serverless function, free at gateway scale, and shared by every instance — so a
 * cron write is visible to the next visitor request and survives deploys and cold starts.
 *
 * Layout:
 *  - `gateway_documents`  — the canonical JSON document. The ONLY table the read path needs.
 *  - `gateway_matches` / `gateway_news` / `gateway_standings` — structured mirror so the data is
 *    queryable in SQL (debugging, ad-hoc reports, future API) instead of a single opaque blob.
 *  - `gateway_meta`       — last write bookkeeping.
 *
 * The document upsert and the meta write run in one atomic pipeline. The mirror is refreshed in
 * a second, chunked pipeline: it is an index over data that is already durable, so a partial
 * mirror refresh degrades introspection but can never lose a match or an article.
 */
export class TursoStorageDriver implements StorageDriver {
  readonly kind = 'turso' as const;
  readonly labelAr = 'قاعدة بيانات Turso/libSQL سحابية';
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly statementsPerPipeline: number;
  private schemaReady: Promise<boolean> | null = null;
  private schemaError: string | null = null;

  constructor(options: TursoDriverOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = resolveFetch(options.fetchImpl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.statementsPerPipeline = options.statementsPerPipeline ?? 120;
  }

  isDurable(): boolean {
    return true;
  }

  describe() {
    // Host only — the token never leaves this class.
    let target = this.url;
    try {
      target = new URL(this.url).host;
    } catch {
      /* keep the raw value */
    }
    return { kind: this.kind, target, durable: true };
  }

  private async pipeline(
    requests: PipelineRequest[],
    label: string
  ): Promise<{ ok: boolean; status: number | null; error?: string; raw?: unknown }> {
    const endpoint = `${this.url}/v2/pipeline`;
    try {
      const response = await withTimeout(
        this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
          cache: 'no-store',
        }),
        this.timeoutMs,
        label
      );
      const rawText = await response.text();
      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}: ${rawText.slice(0, 200)}` };
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return { ok: false, status: response.status, error: 'invalid_json_response' };
      }
      const results = (parsed as { results?: Array<{ type?: string; error?: unknown }> })?.results;
      if (Array.isArray(results)) {
        const failed = results.find((r) => r.type === 'error');
        if (failed) {
          return { ok: false, status: response.status, error: `libsql_error: ${JSON.stringify(failed.error).slice(0, 200)}`, raw: parsed };
        }
      }
      return { ok: true, status: response.status, raw: parsed };
    } catch (error) {
      return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private ensureSchema(): Promise<boolean> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        const statements = [
          `CREATE TABLE IF NOT EXISTS gateway_documents (
             id TEXT PRIMARY KEY,
             payload TEXT NOT NULL,
             bytes INTEGER NOT NULL,
             matches_count INTEGER NOT NULL DEFAULT 0,
             news_count INTEGER NOT NULL DEFAULT 0,
             updated_at TEXT NOT NULL
           )`,
          `CREATE TABLE IF NOT EXISTS gateway_matches (
             id TEXT PRIMARY KEY,
             cairo_date TEXT,
             cairo_time TEXT,
             competition_code TEXT,
             competition_name_ar TEXT,
             status TEXT,
             home_team_ar TEXT,
             away_team_ar TEXT,
             score TEXT,
             is_egyptian_interest INTEGER,
             thesportsdb_event_id TEXT,
             api_football_fixture_id TEXT,
             football_data_match_id TEXT,
             sportscore_tracker_id TEXT,
             nemo_link_url TEXT,
             updated_at TEXT,
             payload TEXT
           )`,
          `CREATE INDEX IF NOT EXISTS idx_matches_date ON gateway_matches (cairo_date)`,
          `CREATE TABLE IF NOT EXISTS gateway_news (
             id TEXT PRIMARY KEY,
             slug TEXT,
             title TEXT,
             publisher_name TEXT,
             publish_status TEXT,
             published_at TEXT,
             original_url TEXT,
             related_match_ids TEXT,
             updated_at TEXT,
             payload TEXT
           )`,
          `CREATE INDEX IF NOT EXISTS idx_news_status ON gateway_news (publish_status)`,
          `CREATE TABLE IF NOT EXISTS gateway_standings (
             competition_code TEXT PRIMARY KEY,
             competition_name_ar TEXT,
             season_label TEXT,
             source_id TEXT,
             rows_count INTEGER,
             updated_at TEXT,
             payload TEXT
           )`,
          `CREATE TABLE IF NOT EXISTS gateway_meta (
             key TEXT PRIMARY KEY,
             value TEXT,
             updated_at TEXT
           )`,
        ];
        const result = await this.pipeline(
          statements.map((sql) => ({ type: 'execute' as const, stmt: { sql } })),
          'turso_schema'
        );
        this.schemaError = result.ok ? null : result.error || 'schema_pipeline_failed';
        return result.ok;
      })();
    }
    return this.schemaReady;
  }

  /** Test/ops helper: drops the internal promise so the next call re-verifies the schema. */
  resetSchemaCache(): void {
    this.schemaReady = null;
    this.schemaError = null;
  }

  async read(): Promise<StorageReadResult> {
    const startedAt = Date.now();
    const schemaOk = await this.ensureSchema();
    if (!schemaOk) {
      return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: this.schemaError || 'schema_unavailable' };
    }
    const result = await this.pipeline(
      [
        {
          type: 'execute',
          stmt: { sql: 'SELECT payload FROM gateway_documents WHERE id = ?', args: [text('gateway')] },
          want_rows: true,
        },
      ],
      'turso_read'
    );
    if (!result.ok) {
      return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: result.error };
    }
    const payload = extractFirstTextValue(result.raw);
    if (payload === null) {
      return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'empty_store' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { ok: false, database: null, bytes: payload.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'payload_not_json' };
    }
    if (!isGatewayDatabaseShape(parsed)) {
      return { ok: false, database: null, bytes: payload.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'invalid_shape' };
    }
    return { ok: true, database: parsed, bytes: payload.length, origin: this.describe().target, latencyMs: Date.now() - startedAt };
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    const startedAt = Date.now();
    const payload = JSON.stringify(database);
    const writtenAt = new Date().toISOString();
    const schemaOk = await this.ensureSchema();
    if (!schemaOk) {
      return {
        ok: false,
        bytes: 0,
        writtenAt,
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
        error: this.schemaError || 'schema_unavailable',
      };
    }

    // 1) Canonical document + bookkeeping, in a single atomic pipeline.
    const documentResult = await this.pipeline(
      [
        {
          type: 'execute',
          stmt: {
            sql: `INSERT INTO gateway_documents (id, payload, bytes, matches_count, news_count, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    payload = excluded.payload,
                    bytes = excluded.bytes,
                    matches_count = excluded.matches_count,
                    news_count = excluded.news_count,
                    updated_at = excluded.updated_at`,
            args: [
              text('gateway'),
              text(payload),
              integer(Buffer.byteLength(payload)),
              integer(database.matches?.length ?? 0),
              integer(database.news?.length ?? 0),
              text(writtenAt),
            ],
          },
        },
        {
          type: 'execute',
          stmt: {
            sql: `INSERT INTO gateway_meta (key, value, updated_at) VALUES (?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            args: [text('last_write_at'), text(writtenAt), text(writtenAt)],
          },
        },
      ],
      'turso_write_document'
    );

    if (!documentResult.ok) {
      return {
        ok: false,
        bytes: 0,
        writtenAt,
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
        error: documentResult.error,
      };
    }

    // 2) Structured mirror (best effort, chunked). Already-durable data is never at risk here.
    const mirror = await this.refreshMirror(database, writtenAt);
    return {
      ok: true,
      bytes: Buffer.byteLength(payload),
      writtenAt,
      mirror,
      latencyMs: Date.now() - startedAt,
      error: mirror.matches + mirror.news + mirror.standings === 0 && database.matches.length > 0 ? 'mirror_refresh_failed' : undefined,
    };
  }

  private async refreshMirror(
    database: GatewayDatabase,
    writtenAt: string
  ): Promise<{ matches: number; news: number; standings: number }> {
    const counts = { matches: 0, news: 0, standings: 0 };
    // Upserts only — never a bulk DELETE. If a later chunk fails, the worst case is a stale row
    // that the sweep below (or the next successful sync) removes. Data is never wiped by a
    // half-finished mirror refresh.
    const upserts: PipelineRequest[] = [];
    for (const match of database.matches || []) {
      upserts.push(matchStatement(match, writtenAt));
      counts.matches += 1;
    }
    for (const item of database.news || []) {
      upserts.push(newsStatement(item, writtenAt));
      counts.news += 1;
    }
    const standings = Object.values(database.standings || {});
    for (const table of standings) {
      upserts.push({
        type: 'execute',
        stmt: {
          sql: `INSERT INTO gateway_standings (competition_code, competition_name_ar, season_label, source_id, rows_count, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(competition_code) DO UPDATE SET
                  competition_name_ar = excluded.competition_name_ar,
                  season_label = excluded.season_label,
                  source_id = excluded.source_id,
                  rows_count = excluded.rows_count,
                  updated_at = excluded.updated_at,
                  payload = excluded.payload`,
          args: [
            text(table.competitionCode),
            text(table.competitionNameAr),
            text(table.seasonLabel),
            text(table.sourceId),
            integer(table.rows?.length ?? 0),
            text(writtenAt),
            text(JSON.stringify(table)),
          ],
        },
      });
      counts.standings += 1;
    }

    for (const chunk of chunkRequests(upserts, this.statementsPerPipeline)) {
      const result = await this.pipeline(chunk, 'turso_mirror');
      if (!result.ok) {
        counts.matches = 0;
        counts.news = 0;
        counts.standings = 0;
        return counts;
      }
    }

    // Sweep rows that this write did not touch, so removed matches/news disappear from the index.
    const sweep = await this.pipeline(
      [
        { type: 'execute', stmt: { sql: 'DELETE FROM gateway_matches WHERE updated_at <> ?', args: [text(writtenAt)] } },
        { type: 'execute', stmt: { sql: 'DELETE FROM gateway_news WHERE updated_at <> ?', args: [text(writtenAt)] } },
        { type: 'execute', stmt: { sql: 'DELETE FROM gateway_standings WHERE updated_at <> ?', args: [text(writtenAt)] } },
      ],
      'turso_mirror_sweep'
    );
    if (!sweep.ok) {
      counts.matches = 0;
      counts.news = 0;
      counts.standings = 0;
    }
    return counts;
  }

  async ping(): Promise<StoragePingResult> {
    const startedAt = Date.now();
    const result = await this.pipeline(
      [
        {
          type: 'execute',
          stmt: { sql: 'SELECT COUNT(*) AS n FROM gateway_documents' },
          want_rows: true,
        },
      ],
      'turso_ping'
    );
    if (!result.ok) {
      return { ok: false, latencyMs: Date.now() - startedAt, detail: result.error || 'pipeline_failed' };
    }
    const value = extractFirstScalar(result.raw);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      detail: 'libsql_pipeline_ok',
      observed: { documents: value ?? 0, durable: true },
    };
  }
}

function matchStatement(match: MatchRecord, writtenAt: string): PipelineRequest {
  return {
    type: 'execute',
    stmt: {
      sql: `INSERT INTO gateway_matches (
              id, cairo_date, cairo_time, competition_code, competition_name_ar, status,
              home_team_ar, away_team_ar, score, is_egyptian_interest,
              thesportsdb_event_id, api_football_fixture_id, football_data_match_id,
              sportscore_tracker_id, nemo_link_url, updated_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              cairo_date = excluded.cairo_date,
              status = excluded.status,
              score = excluded.score,
              updated_at = excluded.updated_at,
              payload = excluded.payload`,
      args: [
        text(match.id),
        text(match.cairoDate),
        text(match.cairoTime),
        text(match.competitionCode),
        text(match.competitionNameAr),
        text(match.status),
        text(match.homeTeam?.nameAr),
        text(match.awayTeam?.nameAr),
        text(
          match.score && (match.score.home !== null || match.score.away !== null)
            ? `${match.score.home ?? '-'}-${match.score.away ?? '-'}`
            : null
        ),
        integer(match.isEgyptianInterest ? 1 : 0),
        text(match.externalIds?.thesportsdbEventId ?? null),
        text(match.externalIds?.apiFootballFixtureId ?? null),
        text(match.externalIds?.footballDataMatchId ?? null),
        text(match.externalIds?.sportscoreTrackerId ?? null),
        text(match.nemoLink?.url ?? null),
        text(writtenAt),
        text(JSON.stringify(match)),
      ],
    },
  };
}

function newsStatement(item: NewsItemRecord, writtenAt: string): PipelineRequest {
  return {
    type: 'execute',
    stmt: {
      sql: `INSERT INTO gateway_news (
              id, slug, title, publisher_name, publish_status, published_at,
              original_url, related_match_ids, updated_at, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              publish_status = excluded.publish_status,
              published_at = excluded.published_at,
              updated_at = excluded.updated_at,
              payload = excluded.payload`,
      args: [
        text(item.id),
        text(item.slug),
        text(item.title),
        text(item.publisherName),
        text(item.publishStatus),
        text(item.publishedAt),
        text(item.originalUrl || item.link),
        text((item.relatedMatchIds || []).join(',')),
        text(writtenAt),
        text(JSON.stringify(item)),
      ],
    },
  };
}

function chunkRequests(requests: PipelineRequest[], size: number): PipelineRequest[][] {
  const chunks: PipelineRequest[][] = [];
  for (let i = 0; i < requests.length; i += size) chunks.push(requests.slice(i, i + size));
  return chunks.length > 0 ? chunks : [];
}

/**
 * libSQL returns rows as arrays of typed value objects. Older deployments return plain scalars.
 * Both shapes are handled so a driver upgrade cannot silently break the read path.
 */
function extractFirstTextValue(raw: unknown): string | null {
  const scalar = extractFirstScalar(raw);
  return typeof scalar === 'string' ? scalar : scalar === null ? null : String(scalar);
}

function extractFirstScalar(raw: unknown): string | number | boolean | null {
  const results = (raw as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return null;
  for (const result of results) {
    const rows = (result as { rows?: unknown[] })?.rows;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const row = rows[0];
    const cells = Array.isArray(row) ? row : [row];
    const cell = cells[0] as { type?: string; value?: unknown } | unknown;
    if (cell && typeof cell === 'object' && 'value' in (cell as object)) {
      const value = (cell as { value: unknown }).value;
      if (value === null || value === undefined) return null;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      return JSON.stringify(value);
    }
    if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return cell;
  }
  return null;
}
