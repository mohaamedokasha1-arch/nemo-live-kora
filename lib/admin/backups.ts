import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AdminRole,
  ManualDocument,
  normalizeManualDocument,
} from './manual-document';
import {
  getManualDocument,
  getManualDriver,
  getManualStatus,
  loadManualDocument,
  mutateManualDocument,
  serializeManualDocument,
} from './manual-store';
import { resetManualLayerStateForTests } from './merge';
import { getGatewayDatabase, hydrateStore, persistGatewayDatabase, resetStoreForTesting } from '../db/store';
import { describeSourceConfiguration } from '../config/env';
import { isServerlessRuntime } from '../db/durable-store';
import type { GatewayDatabase } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  النسخ الاحتياطي والاستعادة — على التخزين الدائم لا على قرص مؤقت
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ما الذي تحتويه النسخة فعلًا؟
 *   1. `manual`   — كل ما كتبه المدير: المباريات اليدوية، التثبيتات، الأخبار،
 *                   الفرق، تجاوزات البطولات، التحكّم بالمصادر، الإعدادات، وسجل التدقيق.
 *   2. `database` — لقطة المخزن الكامل (مباريات المصادر، الترتيب، الأخبار، حالة
 *                   المصادر، سجلات المزامنة) كما هي لحظة النسخ.
 *   3. `config`   — وصف **بلا أسرار**: أسماء متغيّرات البيئة المضبوطة ومصادرها،
 *                   والمنطقة الزمنية، ورابط الموقع. لا مفاتيح ولا كلمات مرور.
 *
 *  أين تُحفظ؟ على نفس تخزين الإدارة الدائم:
 *   • درايفر GitHub ⇒ كل نسخة تُودَع في المستودع، فتبقى ويراها كل من له وصول للكود،
 *     ويعود تاريخ الإيداعات نجسًا تاريخيًّا كاملًا.
 *   • درايفر الملف  ⇒ ملفات في `data/backups/` على خادم له قرص دائم.
 *   وعلى Vercel بلا GITHUB_TOKEN يُقال للمشغّل بصراحة إن النسخ لن تبقى.
 *
 *  سياسة التنظيف: نحتفظ بأحدث `NEMO_BACKUP_RETENTION` نسخة (الافتراضي 7)، مع
 *  عدم حذف نسخة الاستعادة الوقائية أبدًا قبل نجاح العملية، وعدم حذف أحدث نسخة.
 */

export type BackupKind = 'manual' | 'auto' | 'pre-restore';

export interface BackupRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  kind: BackupKind;
  labelAr: string;
  /** sha256 لكل محتوى النسخة — يُستخدم للتحقق من السلامة. */
  checksum: string;
  bytes: number;
  counts: {
    manualMatches: number;
    overrides: number;
    manualNews: number;
    teams: number;
    audit: number;
    storeMatches: number;
    storeNews: number;
    standings: number;
  };
  content: {
    manual: ManualDocument;
    database: {
      meta: GatewayDatabase['meta'];
      matches: GatewayDatabase['matches'];
      news: GatewayDatabase['news'];
      standings: GatewayDatabase['standings'];
      sources: GatewayDatabase['sources'];
      syncLogs: GatewayDatabase['syncLogs'];
      sourceErrors: GatewayDatabase['sourceErrors'];
    } | null;
    config: BackupConfigSummary;
  };
}

export interface BackupConfigSummary {
  siteUrl: string | null;
  timezone: string;
  /** أسماء المتغيّرات المضبوطة فقط — لا قيم. */
  envVarsPresent: string[];
  storageDriver: string;
  storageDurable: boolean;
  serverless: boolean;
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  createdBy: string;
  kind: BackupKind;
  labelAr: string;
  bytes: number;
  checksumShort: string;
  counts: BackupRecord['counts'];
}

export interface BackupCreateOutcome {
  ok: boolean;
  messageAr: string;
  summary: BackupSummary | null;
  warningsAr: string[];
}

/** مجلد النسخ على القرص (يُستخدم مع درايفر الملف فقط). */
export function resolveBackupDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.NEMO_DATA_DIR || '').trim();
  if (override) return path.join(override, 'backups');
  if (isServerlessRuntime(env)) return path.join(process.cwd(), 'data', 'backups');
  return path.join(process.cwd(), 'data', 'backups');
}

/** مسار ملف النسخة داخل المستودع عند استخدام درايفر GitHub. */
export function backupRepoPath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEMO_BACKUP_DIR || 'data/backups').trim().replace(/\/$/, '');
  return `${base}/${id}.json`;
}

export function backupRetention(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.NEMO_BACKUP_RETENTION || '7').trim());
  if (!Number.isFinite(raw)) return 7;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

/** مساحة مستخدمة في الذاكرة لأحدث قائمة نسخ (تُقرأ من التخزين عند الطلب). */
let cachedIndex: { at: number; items: BackupSummary[] } | null = null;

function checksumOf(content: BackupRecord['content']): string {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function summarize(record: BackupRecord): BackupSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    kind: record.kind,
    labelAr: record.labelAr,
    bytes: record.bytes,
    checksumShort: record.checksum.slice(0, 12),
    counts: record.counts,
  };
}

/**
 * يبني نسخة كاملة من الحالة الحالية. `database` تُقرأ من المخزن المباشر (وهو
 * الذي يحتوي بيانات المصادر بعد آخر مزامنة).
 */
export async function buildBackup(options: {
  kind: BackupKind;
  createdBy: string;
  labelAr?: string;
}): Promise<BackupRecord> {
  await loadManualDocument();
  const manual = getManualDocument();
  const db = getGatewayDatabase();
  const status = getManualStatus();
  const keyConfig = describeSourceConfiguration();

  const database: BackupRecord['content']['database'] = {
    meta: db.meta,
    matches: db.matches,
    news: db.news,
    standings: db.standings,
    sources: db.sources,
    syncLogs: db.syncLogs,
    sourceErrors: db.sourceErrors,
  };
  const content: BackupRecord['content'] = {
    manual,
    database,
    config: {
      // ملخّص بلا أسرار: عنوان الموقع والمنطقة الزمنية وأسماء المتغيّرات المضبوطة فقط.
      siteUrl: (process.env.GATEWAY_SITE_URL || '').trim() || null,
      timezone: (process.env.DEFAULT_TIMEZONE || 'Africa/Cairo').trim() || 'Africa/Cairo',
      envVarsPresent: keyConfig
        .filter((entry) => entry.state === 'configured')
        .map((entry) => entry.envVar),
      storageDriver: status.driver,
      storageDurable: status.durable,
      serverless: isServerlessRuntime(),
    },
  };
  const serialized = JSON.stringify(content, null, 2);
  const id = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${options.kind}`;
  return {
    id,
    createdAt: new Date().toISOString(),
    createdBy: options.createdBy,
    kind: options.kind,
    labelAr: options.labelAr || (options.kind === 'auto' ? 'نسخة تلقائية' : options.kind === 'pre-restore' ? 'نسخة وقائية قبل الاستعادة' : 'نسخة يدوية'),
    checksum: checksumOf(content),
    bytes: Buffer.byteLength(serialized, 'utf-8'),
    counts: {
      manualMatches: manual.matches.length,
      overrides: manual.overrides.length,
      manualNews: manual.news.length,
      teams: manual.teams.length,
      audit: manual.audit.length,
      storeMatches: db.matches.length,
      storeNews: db.news.length,
      standings: Object.keys(db.standings || {}).length,
    },
    content,
  };
}

/** يكتب النسخة على التخزين الدائم المتاح. لا يدّعي النجاح إن لم يوجد تخزين دائم. */
export async function persistBackup(record: BackupRecord): Promise<BackupCreateOutcome> {
  const status = getManualStatus();
  const warnings: string[] = [];
  const serialized = JSON.stringify(record, null, 2);

  if (!status.durable) {
    return {
      ok: false,
      messageAr:
        'لا يوجد تخزين دائم لحفظ النسخ الاحتياطية على هذه البيئة: القرص هنا مؤقت، والنسخة ستضيع مع أول إعادة تشغيل. اضبط GITHUB_TOKEN وGITHUB_REPO ليُودَع كل نسخة في المستودع (وهو تخزين دائم ومشترك)، ثم أعد المحاولة.',
      summary: null,
      warningsAr: ['لم تُنشأ نسخة احتياطية حقيقية — لم يُنفَّذ أي حفظ وهمي.'],
    };
  }

  if (status.driver === 'github') {
    const result = await writeBackupToGithub(record.id, serialized);
    if (!result.ok) {
      return { ok: false, messageAr: result.messageAr, summary: null, warningsAr: warnings };
    }
    warnings.push(...result.warningsAr);
  } else {
    const dir = resolveBackupDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${record.id}.json`), serialized, 'utf-8');
    } catch (error) {
      return {
        ok: false,
        messageAr: `تعذّر كتابة ملف النسخة: ${error instanceof Error ? error.message.slice(0, 140) : 'خطأ غير معروف'}`,
        summary: null,
        warningsAr: warnings,
      };
    }
  }

  cachedIndex = null;
  await pruneBackups({ keepId: record.id });
  return {
    ok: true,
    messageAr: `أُنشئت نسخة احتياطية كاملة (${(record.bytes / 1024).toFixed(1)} ك.ب) واحتُفظ بها في ${
      status.driver === 'github' ? 'المستودع' : 'قرص الخادم'
    }.`,
    summary: summarize(record),
    warningsAr: warnings,
  };
}

async function writeBackupToGithub(
  id: string,
  serialized: string
): Promise<{ ok: boolean; messageAr: string; warningsAr: string[] }> {
  const { resolveGithubConfig } = await import('./manual-drivers');
  const config = resolveGithubConfig();
  if (!config) {
    return { ok: false, messageAr: 'إعداد GitHub غير مكتمل: GITHUB_TOKEN وGITHUB_REPO مطلوبان.', warningsAr: [] };
  }
  const filePath = backupRepoPath(id);
  try {
    const response = await fetch(
      `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(filePath)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'nemo-live-kora-admin',
        },
        body: JSON.stringify({
          message: `backup: ${id}`,
          content: Buffer.from(serialized, 'utf-8').toString('base64'),
          branch: config.branch,
        }),
      }
    );
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      return {
        ok: false,
        messageAr: `فشل إيداع النسخة في المستودع (HTTP ${response.status}). ${details.slice(0, 160)}`,
        warningsAr: [],
      };
    }
    return { ok: true, messageAr: 'أُودعت النسخة في المستودع.', warningsAr: [] };
  } catch (error) {
    return {
      ok: false,
      messageAr: `تعذّر الوصول إلى GitHub لحفظ النسخة: ${error instanceof Error ? error.message.slice(0, 140) : 'خطأ شبكة'}`,
      warningsAr: [],
    };
  }
}

/** قائمة النسخ الموجودة على التخزين الدائم (الأحدث أولًا). */
export async function listBackups(force = false): Promise<BackupSummary[]> {
  if (!force && cachedIndex && Date.now() - cachedIndex.at < 15_000) return cachedIndex.items;
  await loadManualDocument();
  const status = getManualStatus();
  let items: BackupSummary[] = [];

  if (status.driver === 'github') {
    const { resolveGithubConfig } = await import('./manual-drivers');
    const config = resolveGithubConfig();
    if (config) {
      const base = (process.env.NEMO_BACKUP_DIR || 'data/backups').trim().replace(/\/$/, '');
      try {
        const response = await fetch(
          `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(base)}?ref=${encodeURIComponent(config.branch)}`,
          {
            headers: {
              Authorization: `Bearer ${config.token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'nemo-live-kora-admin',
            },
            cache: 'no-store',
          }
        );
        if (response.ok) {
          const payload = (await response.json()) as Array<{ name: string; size: number }>;
          items = await Promise.all(
            payload
              .filter((entry) => entry.name.endsWith('.json'))
              .map(async (entry) => {
                const id = entry.name.replace(/\.json$/, '');
                const record = await readBackupFromGithub(id);
                if (record) return summarize(record);
                return {
                  id,
                  createdAt: '',
                  createdBy: '—',
                  kind: 'manual' as BackupKind,
                  labelAr: 'تعذّرت قراءة بيانات النسخة',
                  bytes: entry.size,
                  checksumShort: '—',
                  counts: {
                    manualMatches: 0, overrides: 0, manualNews: 0, teams: 0, audit: 0,
                    storeMatches: 0, storeNews: 0, standings: 0,
                  },
                } satisfies BackupSummary;
              })
          );
        }
      } catch {
        // لا نسخ أو تعذّر الوصول — تُعرض القائمة فارغة مع رسالة في الواجهة.
      }
    }
  } else if (status.durable) {
    const dir = resolveBackupDir();
    try {
      if (fs.existsSync(dir)) {
        items = fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.json'))
          .map((name) => {
            try {
              const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
              const record = JSON.parse(raw) as BackupRecord;
              return summarize(record);
            } catch {
              return null;
            }
          })
          .filter((item): item is BackupSummary => item !== null);
      }
    } catch {
      items = [];
    }
  }

  items.sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'));
  cachedIndex = { at: Date.now(), items };
  return items;
}

async function readBackupRecord(id: string): Promise<BackupRecord | null> {
  await loadManualDocument();
  const status = getManualStatus();
  if (status.driver === 'github') return readBackupFromGithub(id);
  if (!status.durable) return null;
  const file = path.join(resolveBackupDir(), `${id}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as BackupRecord;
  } catch {
    return null;
  }
}

async function readBackupFromGithub(id: string): Promise<BackupRecord | null> {
  const { resolveGithubConfig } = await import('./manual-drivers');
  const config = resolveGithubConfig();
  if (!config) return null;
  try {
    const response = await fetch(
      `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(backupRepoPath(id))}?ref=${encodeURIComponent(config.branch)}`,
      {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'nemo-live-kora-admin',
        },
        cache: 'no-store',
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { content?: string };
    if (!payload.content) return null;
    return JSON.parse(Buffer.from(payload.content, 'base64').toString('utf-8')) as BackupRecord;
  } catch {
    return null;
  }
}

/** تنزيل نسخة (للتقارير أو الحفظ خارج الاستضافة). */
export async function getBackupForDownload(id: string): Promise<{ ok: boolean; raw: string | null; messageAr: string }> {
  const record = await readBackupRecord(id);
  if (!record) return { ok: false, raw: null, messageAr: 'النسخة غير موجودة أو تعذّرت قراءتها.' };
  const verification = verifyBackupRecord(record);
  if (!verification.ok) {
    return { ok: false, raw: null, messageAr: `النسخة تالفة أو معدّلة: ${verification.messageAr}` };
  }
  return { ok: true, raw: JSON.stringify(record, null, 2), messageAr: 'النسخة سليمة.' };
}

export interface BackupVerification {
  ok: boolean;
  messageAr: string;
  checks: {
    checksumMatches: boolean;
    manualShapeValid: boolean;
    countsMatch: boolean;
    hasDatabase: boolean;
  };
}

/**
 * فحص سلامة النسخة: بصمة المحتوى + صحة بنية المستند اليدوي + تطابق الأعداد.
 * هذا فحص فعلي يعيد حساب البصمة من المحتوى — لا مجرّد قراءة حقل.
 */
export function verifyBackupRecord(record: BackupRecord): BackupVerification {
  const checksumMatches = checksumOf(record.content) === record.checksum;
  const normalized = normalizeManualDocument(record.content.manual);
  const manualShapeValid =
    normalized.matches.length === (record.content.manual?.matches?.length ?? -1) &&
    normalized.settings !== undefined;
  const manual = record.content.manual;
  const countsMatch =
    manual.matches.length === record.counts.manualMatches &&
    manual.overrides.length === record.counts.overrides &&
    manual.news.length === record.counts.manualNews;
  const hasDatabase = Boolean(record.content.database && Array.isArray(record.content.database.matches));
  const ok = checksumMatches && manualShapeValid && countsMatch && hasDatabase;
  return {
    ok,
    messageAr: ok
      ? 'النسخة سليمة: البصمة مطابقة، والبنية صالحة، والأعداد متوافقة، وبيانات المخزن موجودة.'
      : [
          !checksumMatches ? 'بصمة المحتوى لا تطابق القيمة المخزّنة (تعديل أو تلف).' : null,
          !manualShapeValid ? 'بنية المستند اليدوي غير صالحة.' : null,
          !countsMatch ? 'أعداد السجلات لا تطابق ما ورد في النسخة.' : null,
          !hasDatabase ? 'لا تحتوي النسخة على بيانات المخزن (لقطة غير مكتملة).' : null,
        ]
          .filter(Boolean)
          .join(' '),
    checks: { checksumMatches, manualShapeValid, countsMatch, hasDatabase },
  };
}

export interface RestoreOutcome {
  ok: boolean;
  status: number;
  messageAr: string;
  preRestoreBackupId: string | null;
  warningsAr: string[];
}

/**
 * استعادة نسخة. تتطلب:
 *   • دور `owner` (مفروض في المسار).
 *   • تأكيدًا نصيًا بمعرّف النسخة (مفروض هنا).
 *   • نسخة وقائية من الحالة الحالية قبل الكتابة (تُنشأ تلقائيًا).
 * ثم تُكتب الحالة السابقة في المخزن اليدوي والمخزن الأساسي معًا.
 */
export async function restoreBackup(options: {
  id: string;
  confirmation: string;
  actor: { username: string; role: AdminRole };
  /** لأغراض الاختبار: تعطيل النسخة الوقائية. */
  skipPreRestoreBackup?: boolean;
}): Promise<RestoreOutcome> {
  await loadManualDocument();
  const record = await readBackupRecord(options.id);
  if (!record) {
    return { ok: false, status: 404, messageAr: 'النسخة المطلوبة غير موجودة في التخزين الدائم.', preRestoreBackupId: null, warningsAr: [] };
  }
  const verification = verifyBackupRecord(record);
  if (!verification.ok) {
    return {
      ok: false,
      status: 422,
      messageAr: `لم تُنفَّذ الاستعادة: ${verification.messageAr}`,
      preRestoreBackupId: null,
      warningsAr: [],
    };
  }
  if (options.confirmation.trim() !== record.id) {
    return {
      ok: false,
      status: 400,
      messageAr: `تأكيد الاستعادة مطلوب: اكتب معرّف النسخة «${record.id}» حرفًا بحرف. لم يُغيَّر أي شيء.`,
      preRestoreBackupId: null,
      warningsAr: [],
    };
  }

  let preRestoreBackupId: string | null = null;
  const warnings: string[] = [];
  if (!options.skipPreRestoreBackup) {
    const preBackup = await buildBackup({
      kind: 'pre-restore',
      createdBy: options.actor.username,
      labelAr: `نسخة وقائية تلقائية قبل استعادة ${record.id}`,
    });
    const persisted = await persistBackup(preBackup);
    if (!persisted.ok) {
      return {
        ok: false,
        status: 502,
        messageAr: `أُوقفت الاستعادة: تعذّر إنشاء النسخة الوقائية قبلها (${persisted.messageAr}). لا نُغيّر البيانات بلا طريق للرجوع.`,
        preRestoreBackupId: null,
        warningsAr: persisted.warningsAr,
      };
    }
    preRestoreBackupId = persisted.summary?.id ?? null;
  }

  // 1) المستند اليدوي: استبدال كامل + سطر تدقيق.
  const documentResult = await mutateManualDocument(
    {
      actor: options.actor.username,
      role: options.actor.role,
      action: 'backup.restore',
      target: record.id,
      summaryAr: `استعادة نسخة احتياطية ${record.id} (${record.createdAt})`,
      details: { preRestoreBackupId, checksum: record.checksum.slice(0, 16) },
    },
    (draft) => {
      const restored = normalizeManualDocument(record.content.manual);
      draft.matches = restored.matches;
      draft.overrides = restored.overrides;
      draft.news = restored.news;
      draft.teams = restored.teams;
      draft.competitionOverrides = restored.competitionOverrides;
      draft.sourceControls = restored.sourceControls;
      draft.settings = restored.settings;
      return { data: record.id, changed: true, messageAr: 'استُعيدت حالة الإدارة من النسخة.' };
    }
  );
  if (!documentResult.ok) {
    return {
      ok: false,
      status: 502,
      messageAr: `فشلت الاستعادة في المستند الإداري: ${documentResult.messageAr}`,
      preRestoreBackupId,
      warningsAr: warnings,
    };
  }

  // 2) مخزن الموقع: نستعيد اللقطة كما كانت (بيانات المصادر والترتيب والأخبار).
  if (record.content.database) {
    try {
      const db = getGatewayDatabase();
      const snapshot = record.content.database;
      db.meta = snapshot.meta;
      db.matches = snapshot.matches;
      db.news = snapshot.news;
      db.standings = snapshot.standings;
      db.sources = snapshot.sources;
      db.syncLogs = snapshot.syncLogs;
      db.sourceErrors = snapshot.sourceErrors;
      persistGatewayDatabase(db);
      warnings.push('أُعيد مخزن الموقع (المباريات والأخبار والترتيب وحالة كل مصدر) إلى لحظة النسخة.');
    } catch (error) {
      warnings.push(
        `تعذّرت استعادة مخزن الموقع: ${error instanceof Error ? error.message.slice(0, 120) : 'خطأ غير معروف'}. حالة الإدارة استُعيدت بنجاح.`
      );
    }
  }

  applyRestoredManualLayer();
  return {
    ok: true,
    status: 200,
    messageAr: `تمت الاستعادة من النسخة ${record.id}. أنشأنا نسخة وقائية من الحالة السابقة قبل الاستعادة${
      preRestoreBackupId ? ` (${preRestoreBackupId})` : ''
    } فيمكنك الرجوع في أي وقت.`,
    preRestoreBackupId,
    warningsAr: warnings,
  };
}

/** يعيد دمج المستند المستعاد في المخزن — مفصولة لتُستخدم أيضًا في الاختبارات. */
function applyRestoredManualLayer(): void {
  resetManualLayerStateForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { applyManualLayerToStore } = require('./service') as typeof import('./service');
  applyManualLayerToStore();
}

/** يحذف نسخة. لا نحذف أحدث نسخة ولا النسخة الوقائية الأخيرة تلقائيًا. */
export async function deleteBackup(
  id: string,
  actor: { username: string; role: AdminRole }
): Promise<{ ok: boolean; status: number; messageAr: string }> {
  await loadManualDocument();
  const items = await listBackups(true);
  if (items.length <= 1) {
    return { ok: false, status: 409, messageAr: 'لا يمكن حذف آخر نسخة احتياطية متاحة — احتفظ بنسخة واحدة على الأقل.' };
  }
  const target = items.find((item) => item.id === id);
  if (!target) return { ok: false, status: 404, messageAr: 'النسخة غير موجودة.' };
  if (target.id === items[0].id) {
    return { ok: false, status: 409, messageAr: 'لا يمكن حذف أحدث نسخة احتياطية — أنشئ نسخة أحدث أولًا ثم احذفها.' };
  }

  const status = getManualStatus();
  let removed = false;
  if (status.driver === 'github') {
    const { resolveGithubConfig } = await import('./manual-drivers');
    const config = resolveGithubConfig();
    if (config) {
      try {
        const meta = await fetch(
          `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(backupRepoPath(id))}?ref=${encodeURIComponent(config.branch)}`,
          {
            headers: {
              Authorization: `Bearer ${config.token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'nemo-live-kora-admin',
            },
          }
        );
        const payload = meta.ok ? ((await meta.json()) as { sha?: string }) : null;
        if (payload?.sha) {
          const response = await fetch(
            `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(backupRepoPath(id))}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'nemo-live-kora-admin',
              },
              body: JSON.stringify({ message: `backup: حذف نسخة ${id}`, sha: payload.sha, branch: config.branch }),
            }
          );
          removed = response.ok;
        }
      } catch {
        removed = false;
      }
    }
  } else {
    try {
      const file = path.join(resolveBackupDir(), `${id}.json`);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed = true;
      }
    } catch {
      removed = false;
    }
  }

  if (!removed) return { ok: false, status: 502, messageAr: 'تعذّر حذف النسخة من التخزين.' };
  cachedIndex = null;
  await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'backup.delete',
      target: id,
      summaryAr: `حذف نسخة احتياطية ${id}`,
    },
    () => ({ data: id, changed: false, messageAr: 'حُذفت النسخة.' })
  );
  return { ok: true, status: 200, messageAr: `حُذفت النسخة ${id}.` };
}

/** سياسة التنظيف: نحتفظ بأحدث N نسخة، ونحذف الأقدم فقط. */
export async function pruneBackups(options: { keepId?: string } = {}): Promise<{ removed: string[]; kept: number }> {
  const retention = backupRetention();
  const items = await listBackups(true);
  const keep = new Set(items.slice(0, retention).map((item) => item.id));
  if (options.keepId) keep.add(options.keepId);
  const removable = items.slice(retention).filter((item) => !keep.has(item.id));
  const removed: string[] = [];
  for (const item of removable) {
    const result = await deleteBackupSilently(item.id);
    if (result) removed.push(item.id);
  }
  if (removed.length > 0) cachedIndex = null;
  return { removed, kept: items.length - removed.length };
}

async function deleteBackupSilently(id: string): Promise<boolean> {
  const status = getManualStatus();
  if (status.driver === 'github') {
    const { resolveGithubConfig } = await import('./manual-drivers');
    const config = resolveGithubConfig();
    if (!config) return false;
    try {
      const meta = await fetch(
        `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(backupRepoPath(id))}?ref=${encodeURIComponent(config.branch)}`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'nemo-live-kora-admin',
          },
        }
      );
      const payload = meta.ok ? ((await meta.json()) as { sha?: string }) : null;
      if (!payload?.sha) return false;
      const response = await fetch(
        `${config.apiBaseUrl}/repos/${config.repo}/contents/${encodeURI(backupRepoPath(id))}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'nemo-live-kora-admin',
          },
          body: JSON.stringify({ message: `backup: تنظيف آلي للنسخة ${id}`, sha: payload.sha, branch: config.branch }),
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
  try {
    const file = path.join(resolveBackupDir(), `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * النسخة التلقائية المجدولة: تُنفَّذ من مسار الكرون اليومي (05:00 UTC) لأن خطة
 * Vercel المجانية تسمح بمهمتين مجدولتين فقط وكلتاهما مستخدمة بالفعل للمزامنة.
 * الشرط: لا ننشئ نسخة إن كانت أحدث نسخة أحدث من `minHours` ساعة.
 */
export async function maybeCreateScheduledBackup(options: {
  minHours?: number;
  actor?: { username: string; role: AdminRole };
} = {}): Promise<{ created: boolean; summary: BackupSummary | null; messageAr: string; warningsAr: string[] }> {
  const minHours = options.minHours ?? 20;
  await loadManualDocument();
  const status = getManualStatus();
  if (!status.durable) {
    return {
      created: false,
      summary: null,
      messageAr: 'لا تخزين دائم للنسخ على هذه البيئة — لم تُنشأ نسخة تلقائية (ولم ندّعِ ذلك).',
      warningsAr: ['اضبط GITHUB_TOKEN وGITHUB_REPO لتشغيل النسخ المجدولة فعلًا.'],
    };
  }
  const items = await listBackups(true);
  const newest = items[0];
  if (newest?.createdAt && Date.now() - Date.parse(newest.createdAt) < minHours * 3_600_000) {
    return {
      created: false,
      summary: newest,
      messageAr: `لم تُنشأ نسخة جديدة: أحدث نسخة عمرها أقل من ${minHours} ساعة.`,
      warningsAr: [],
    };
  }
  const record = await buildBackup({
    kind: 'auto',
    createdBy: options.actor?.username || 'cron',
    labelAr: 'نسخة تلقائية مجدولة (بعد مزامنة الصباح)',
  });
  const outcome = await persistBackup(record);
  return {
    created: outcome.ok,
    summary: outcome.summary,
    messageAr: outcome.messageAr,
    warningsAr: outcome.warningsAr,
  };
}

/** يُستخدم في الاختبارات: تفريغ الحالة قبل كل سيناريو. */
export async function resetBackupStateForTests(): Promise<void> {
  cachedIndex = null;
  resetStoreForTesting();
  resetManualLayerStateForTests();
  await hydrateStore();
}

export { serializeManualDocument, getManualDriver };
