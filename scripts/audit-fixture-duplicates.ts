/**
 * فحص التكرار عبر المصادر — أداة تشغيلية تُقرأ نتيجتها بلا تخمين.
 *
 *   npm run audit:duplicates            → على لقطة المخزن المحلية (data/gateway-store.json)
 *   npx tsx scripts/audit-fixture-duplicates.ts --file=/path/snapshot.json
 *
 * تُطبع: عدد السجلات، مجموعات التكرار المثبتة (الفريقان + اليوم + هوية البطولة/النافذة الزمنية)،
 * ثم تقرير سلامة الروابط. تنتهي بحالة خروج 1 إذا وُجد تكرار **غير مُعالَج** (سجلان لنفس المباراة
 * بلا `duplicateOfId`)، وحالة 0 إذا لم يبقَ تكرار مفتوح. لا تحذف ولا تعدّل أي شيء.
 */
import fs from 'node:fs';
import path from 'node:path';
import { auditMatchLinkIntegrity, blockingLinkIssues, findDuplicateFixtureGroups } from '../lib/match-identity';
import type { GatewayDatabase, MatchRecord } from '../lib/types';


function resolveInputFile(): string {
  const arg = process.argv.find((value) => value.startsWith('--file='));
  if (arg) return path.resolve(arg.slice('--file='.length));
  return path.resolve(process.cwd(), 'data/gateway-store.json');
}

const file = resolveInputFile();
if (!fs.existsSync(file)) {
  console.error(`لم يُعثر على ملف المخزن: ${file}`);
  process.exit(2);
}

const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<GatewayDatabase> & {
  records?: MatchRecord[];
};
/** يقبل: لقطة المخزن كاملة (`matches`) أو مصفوفة سجلات أو ملف التقاط (`records`). */
const matches: MatchRecord[] = Array.isArray(parsed)
  ? (parsed as unknown as MatchRecord[])
  : parsed.matches ?? parsed.records ?? [];
const active = matches.filter((match) => !match.duplicateOfId);
const marked = matches.filter((match) => match.duplicateOfId);

console.log(`الملف: ${file}`);
console.log(`السجلات: ${matches.length} (معروض ${active.length} — مُعلَّم كتكرار ${marked.length})`);

const groups = findDuplicateFixtureGroups(active);
console.log(`مجموعات تكرار غير مُعالَجة: ${groups.length}`);
for (const group of groups) {
  console.log(
    `  • ${group.ids.join('  ↔  ')}\n` +
      `    السبب: ${group.verdict.reason} | الثقة: ${group.verdict.confidence} | ` +
      `المطابقة: ${group.verdict.matchedOn.join(' + ') || '—'} | فرق الانطلاق: ${group.verdict.kickoffDeltaMinutes ?? '—'} دقيقة`
  );
}

const report = auditMatchLinkIntegrity(matches);
const blocking = blockingLinkIssues(report);
console.log(
  `فحص الروابط: مفحوص ${report.checked} | مرتبط ${report.linked} | بلا رابط ${report.unlinked} | ` +
    `تكرار مُعالَج ${report.mergedDuplicates} | أخطاء مانعة ${blocking.length}`
);
for (const issue of blocking.slice(0, 20)) {
  console.log(`  ! [${issue.code}] ${issue.matchId ?? ''} ${issue.messageAr ?? ''}`);
}

if (groups.length > 0 || blocking.length > 0) {
  console.log('\nالنتيجة: توجد حالات تحتاج معالجة (انظر أعلاه).');
  process.exit(1);
}
console.log('\nالنتيجة: لا تكرار مفتوح ولا خطأ مانع.');
