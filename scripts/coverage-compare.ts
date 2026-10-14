/**
 * مقارنة تغطية الموقع بمرجع مصرّح به، لنطاق تواريخ محدد.
 *
 * الاستخدام:
 *   node --import tsx scripts/coverage-compare.ts --reference=football-data [--from=YYYY-MM-DD --to=YYYY-MM-DD]
 *   node --import tsx scripts/coverage-compare.ts --reference=file:./exports/reference.json
 *   اختياري: --site=<مسار gateway-store.json> --out=<مسار JSON> --md=<مسار Markdown>
 *
 * بلا --from/--to تُستخدم نافذة المزامنة نفسها (NEMO_SYNC_DAYS_BACK / NEMO_SYNC_DAYS_AHEAD).
 * الأمر للقراءة فقط: لا يكتب في مخزن الموقع ولا يغيّر أي سجل.
 *
 * رموز الخروج: 0 تم، 2 مرجع مرفوض أو غير مصرّح، 3 المرجع غير متاح (مفتاح ناقص أو فشل شبكة)،
 * 4 خطأ في الإدخال أو الملف.
 */
import fs from 'fs';
import path from 'path';
import { getTodayCairoDate } from '../lib/cairo-time';
import { compareCoverage, CoverageReport } from '../lib/coverage/compare';
import { renderCoverageMarkdown } from '../lib/coverage/render';
import {
  fetchFootballDataReference,
  parseReferenceExport,
  refusedReferenceReason,
  toCoverageSiteMatch,
} from '../lib/coverage/reference';
import { resolveLocalStoreFile } from '../lib/db/durable-store';
import { readSyncWindowConfig, resolveWideSyncWindow } from '../lib/sync/date-window';
import type { GatewayDatabase } from '../lib/types';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function fail(code: number, message: string): never {
  console.error(JSON.stringify({ ok: false, exitCode: code, error: message }, null, 2));
  process.exit(code);
}

async function main() {
  const reference = arg('reference');
  if (!reference) fail(4, 'حدد المرجع: --reference=football-data أو --reference=file:<path>');

  const refused = refusedReferenceReason(reference);
  if (refused) fail(2, refused);

  const today = getTodayCairoDate();
  const defaultWindow = resolveWideSyncWindow(today, readSyncWindowConfig());
  const from = arg('from') || defaultWindow.from;
  const to = arg('to') || defaultWindow.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    fail(4, 'نطاق التواريخ غير صالح: استخدم YYYY-MM-DD وأن يكون from ≤ to');
  }

  const sitePath = arg('site') || resolveLocalStoreFile();
  let db: GatewayDatabase;
  try {
    db = JSON.parse(fs.readFileSync(sitePath, 'utf-8')) as GatewayDatabase;
  } catch (error) {
    fail(4, `تعذّر قراءة سجل الموقع: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  const siteMatches = (db.matches || []).map(toCoverageSiteMatch);

  let referenceMatches;
  let referenceNote: Record<string, unknown>;
  if (reference === 'football-data') {
    const res = await fetchFootballDataReference(from, to);
    if (!res.ok) {
      fail(3, JSON.stringify({ reason: res.error, httpStatus: res.httpStatus, messageAr: res.messageAr }));
    }
    referenceMatches = res.matches;
    referenceNote = { source: 'football-data.org', endpoint: '/v4/matches', httpStatus: res.httpStatus, latencyMs: res.latencyMs };
  } else if (reference.startsWith('file:')) {
    const filePath = path.resolve(reference.slice('file:'.length));
    let payload: unknown;
    try {
      payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      fail(4, `تعذّر قراءة ملف المرجع: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    const parsed = parseReferenceExport(payload, `file:${path.basename(filePath)}`);
    if (parsed.matches.length === 0 && parsed.rejected.length > 0) {
      fail(4, JSON.stringify({ error: 'no_valid_reference_rows', rejected: parsed.rejected.slice(0, 20) }));
    }
    referenceMatches = parsed.matches;
    referenceNote = {
      source: `file:${path.basename(filePath)}`,
      rowsAccepted: parsed.matches.length,
      rowsRejected: parsed.rejected.length,
      rejectedSample: parsed.rejected.slice(0, 20),
    };
  } else {
    fail(4, `مرجع غير معروف: ${reference}`);
  }

  const report: CoverageReport = compareCoverage({
    window: { from, to },
    reference: referenceMatches,
    site: siteMatches,
  });

  const output = { ok: true, reference: referenceNote, sitePath: path.basename(sitePath), report };
  const outPath = arg('out');
  if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify(output, null, 2), 'utf-8');
  const mdPath = arg('md');
  if (mdPath) fs.writeFileSync(path.resolve(mdPath), renderCoverageMarkdown(report, referenceNote), 'utf-8');

  console.log(JSON.stringify({ ok: true, window: report.window, referenceSources: report.referenceSources, referenceFeedsSite: report.referenceFeedsSite, summary: report.summary, issueCounts: countByKind(report) }, null, 2));
}

function countByKind(report: CoverageReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of report.issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;
  return counts;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
