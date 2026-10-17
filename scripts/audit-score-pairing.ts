#!/usr/bin/env -S npx tsx
/**
 * تدقيق اقتران النتائج (للقراءة فقط — لا يُصلّح ولا يغيّر أي بيانات):
 *
 *   npm run audit:score-pairing            # يفحص مخزن التشغيل/الملف المرفوع ويكتب تقريرًا
 *   npm run audit:score-pairing -- --strict  # يرجع بكود خروج غير صفري عند أي انحراف
 *
 * يفحص طبقتين:
 *  1) اقتران بنية المخزن: هل `score.home` يسافر مع `homeTeam` عبر كل سجل يدوي/تثبيت؟
 *     (في سجلات الملف لا توجد أزواج اسم معكوسة داخليًا بطبيعتها، لكن السجلات اليدوية
 *     القديمة التي أُدخلت أثناء bug الواجهة قد تكون خُزّنت معكوسة — تُكتشف هنا عبر
 *     مطابقة المرجع.)
 *  2) مطابقة المرجع الموثوق: مباريات مخزّنة لها `thesportsdbEventId` مقابل لقطات
 *     tests/fixtures/thesportsdb/*.json (strHomeTeam/intHomeScore…). لكل تقاطع:
 *      - تطابق كامل ⇒ OK
 *      - تبديل الفريقين يجعل النتيجة تطابق ⇒ REVERSED (انحراف خطير!)
 *      - تطابق الفريقان واختلف الرقمان ⇒ SCORE-MISMATCH
 */
import fs from 'node:fs';
import path from 'node:path';
import { nameSimilarity, normalizeName } from '../lib/coverage/compare';

const ROOT = process.cwd();
const strict = process.argv.includes('--strict');

type Row = {
  id: string;
  date: string;
  homeAr: string;
  awayAr: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  origin: 'manual' | 'override' | 'source';
  tsdbId?: string;
};

function readJsonIfExists(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function collectStoreRows(): Row[] {
  const dirs = [
    process.env.NEMO_DATA_DIR ? path.join(process.env.NEMO_DATA_DIR) : null,
    path.join(ROOT, 'data'),
  ].filter((d): d is string => Boolean(d));
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    // 1) المخزن المرفوع (gateway store)
    const store = readJsonIfExists(path.join(dir, 'gateway-store.json')) as
      | { snapshot?: { matches?: unknown[] }; matches?: unknown[] }
      | null;
    const matches = (store?.snapshot?.matches ?? store?.matches ?? []) as Array<{
      id: string;
      cairoDate: string;
      status: string;
      score?: { home?: number | null; away?: number | null } | null;
      homeTeam?: { nameAr?: string };
      awayTeam?: { nameAr?: string };
      externalIds?: Record<string, string | undefined>;
      overriddenFields?: string[];
    }>;
    for (const m of matches) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      rows.push({
        id: m.id,
        date: m.cairoDate,
        homeAr: m.homeTeam?.nameAr ?? '?',
        awayAr: m.awayTeam?.nameAr ?? '?',
        homeScore: m.score?.home ?? null,
        awayScore: m.score?.away ?? null,
        status: m.status,
        origin: m.id.startsWith('manual-')
          ? 'manual'
          : (m.overriddenFields || []).includes('score')
            ? 'override'
            : 'source',
        tsdbId: m.externalIds?.thesportsdbEventId,
      });
    }

    // 2) السجلات اليدوية المباشرة من وثيقة الإدارة (تطغى على نسخة المخزن عند وجودها)
    const manualDoc = readJsonIfExists(path.join(dir, 'manual-content.json')) as
      | { matches?: Array<Row & Record<string, unknown>> }
      | null;
    for (const r of manualDoc?.matches ?? []) {
      const id = String(r.id);
      const row: Row = {
        id: `manual-${id}`,
        date: String((r as { cairoDate?: string }).cairoDate ?? String((r as { kickoffUtc?: string }).kickoffUtc ?? '').slice(0, 10)),
        homeAr: String((r as { homeTeam?: { nameAr?: string } }).homeTeam?.nameAr ?? '?'),
        awayAr: String((r as { awayTeam?: { nameAr?: string } }).awayTeam?.nameAr ?? '?'),
        homeScore: (r as { score?: { home?: number | null } }).score?.home ?? null,
        awayScore: (r as { score?: { away?: number | null } }).score?.away ?? null,
        status: String((r as { status?: string }).status ?? ''),
        origin: 'manual',
        tsdbId: undefined,
      };
      const existing = rows.findIndex((x) => x.id.startsWith('match-') && x.date === row.date && normalizeName(x.homeAr) === normalizeName(row.homeAr) && normalizeName(x.awayAr) === normalizeName(row.awayAr));
      if (existing !== -1) rows.splice(existing, 1);
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
  }
  return rows;
}

type RefRow = { eventId: string; date: string; home: string; away: string; homeScore: number | null; awayScore: number | null };

function collectReferences(): RefRow[] {
  const dir = path.join(ROOT, 'tests', 'fixtures', 'thesportsdb');
  const out: RefRow[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const payload = readJsonIfExists(path.join(dir, file)) as { events?: unknown; response?: unknown } | null;
    const raw = (payload as { events?: unknown[] })?.events ?? (payload as { response?: unknown[] })?.response ?? [];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const e of list as Array<Record<string, string | undefined>>) {
      if (!e?.strHomeTeam || !e?.dateEvent) continue;
      out.push({
        eventId: String(e.idEvent ?? ''),
        date: String(e.dateEvent).slice(0, 10),
        home: String(e.strHomeTeam),
        away: String(e.strAwayTeam ?? ''),
        homeScore: e.intHomeScore === undefined || e.intHomeScore === '' ? null : Number(e.intHomeScore),
        awayScore: e.intAwayScore === undefined || e.intAwayScore === '' ? null : Number(e.intAwayScore),
      });
    }
  }
  return out;
}

function similarArabic(english: string, arabic: string): number {
  // لا ترجمة هنا — المطابقة تكون عبر معرف الحدث حين يوجد، وعبر التاريخ+التقارب الشكلي وإلا.
  return nameSimilarity(normalizeName(english), normalizeName(arabic));
}

const rows = collectStoreRows();
const refs = collectReferences();
const byEventId = new Map(refs.filter((r) => r.eventId).map((r) => [r.eventId, r]));

let ok = 0;
let reversedCount = 0;
let mismatches = 0;
const lines: string[] = [];
const scored = rows.filter((r) => r.homeScore !== null || r.awayScore !== null);

for (const row of scored) {
  let ref: RefRow | undefined = row.tsdbId ? byEventId.get(row.tsdbId) : undefined;
  if (!ref) {
    ref = refs.find(
      (c) =>
        c.date === row.date &&
        similarArabic(c.home, row.homeAr) + similarArabic(c.away, row.awayAr) > 1.1 &&
        similarArabic(c.home, row.awayAr) + similarArabic(c.away, row.homeAr) < 1.1
    );
  }
  const flippedRef = !row.tsdbId
    ? refs.find(
        (c) =>
          c.date === row.date &&
          similarArabic(c.away, row.homeAr) + similarArabic(c.home, row.awayAr) > 1.1 &&
          similarArabic(c.home, row.homeAr) + similarArabic(c.away, row.awayAr) < 1.1
      )
    : undefined;

  if (!ref && !flippedRef) {
    lines.push(`  · ${row.id} [${row.origin}] ${row.homeAr} ${row.homeScore}-${row.awayScore} ${row.awayAr} — لا مرجع مطابق (يُثبِت الاختبارات البنية لا القيمة)`);
    continue;
  }
  const used = ref ?? flippedRef!;
  const sameOrientation = ref !== undefined;
  const scoreMatchesOrientation =
    used.homeScore === row.homeScore && used.awayScore === row.awayScore;
  const scoreMatchesFlipped =
    used.awayScore === row.homeScore && used.homeScore === row.awayScore;

  if (sameOrientation && scoreMatchesOrientation) {
    ok += 1;
    lines.push(`  ✓ ${row.id} [${row.origin}] ${row.homeAr} ${row.homeScore}-${row.awayScore} ${row.awayAr} = المرجع (${used.home} ${used.homeScore}-${used.awayScore} ${used.away})`);
  } else if (!sameOrientation && scoreMatchesFlipped) {
    reversedCount += 1;
    lines.push(`  ‼ REVERSED ${row.id} [${row.origin}]: الموقع يخزّن «${row.homeAr} ${row.homeScore}-${row.awayScore} ${row.awayAr}» والمرجع يقول «${used.home} ${used.homeScore}-${used.awayScore} ${used.away}» — الأرقام محفوظة معكوسة بين المفاتيح!`);
  } else if (sameOrientation && !scoreMatchesOrientation && scoreMatchesFlipped) {
    mismatches += 1;
    lines.push(`  ‼ FLIPPED-SCORES ${row.id} [${row.origin}]: ${row.homeAr} ${row.homeScore}-${row.awayScore} — الأرقام مخزّنة معكوسة بين المفاتيح (تطابق المرجع فقط لو بدلنا الرقمين) — تصحيح يدوي عبر PATCH ضرورة`);
  } else if (sameOrientation) {
    mismatches += 1;
    lines.push(`  ⚠ SCORE-MISMATCH ${row.id} [${row.origin}]: ${row.homeAr} ${row.homeScore}-${row.awayScore} مقابل مرجع ${used.home} ${used.homeScore}-${used.awayScore} ${used.away}`);
  } else {
    mismatches += 1;
    lines.push(`  ⚠ ORIENTATION+SCORE ${row.id} [${row.origin}]: ${row.homeAr} ${row.homeScore}-${row.awayScore} ${row.awayAr} مقابل مرجع معكوس التطابق ${used.home} ${used.homeScore}-${used.awayScore} ${used.away}`);
  }
}

console.log(`تدقيق اقتران النتائج — ${scored.length} سجلًا بنتيجة مخزّنة مقابل ${refs.length} مرجعًا موثوقًا`);
console.log(lines.join('\n'));
console.log(`الخلاصة: متطابق=${ok} · معكوس التخزين=${reversedCount} · انحراف نتيجة=${mismatches} · بلا مرجع=${scored.length - ok - reversedCount - mismatches}`);
console.log('ملاحظة: هذا التقرير لا يعدّل شيئًا — التصحيح يدوي عبر مسار الإدارة (PATCH/override) إن لزم.');
if (strict && (reversedCount || mismatches)) process.exitCode = 1;
