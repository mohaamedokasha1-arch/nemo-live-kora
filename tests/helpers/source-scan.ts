import fs from 'node:fs';
import path from 'node:path';

/**
 * أدوات فحص الكود المصدري للاختبارات.
 *
 * ⚠️ لماذا `stripComments` ضروري؟
 * ملفات هذا المشروع موثّقة بكثافة: التعليقات تشرح **سبب** إلغاء سلوك قديم وتذكر أسماء
 * الملفات والأنماط القديمة صراحةً (مثل `nemo-logo.png` أو `#selected-match-broadcast`
 * أو `objectFit`). فحص النص الخام كان يعتبر هذه التعليقات «مخالفة» ويُنتج إنذارات
 * كاذبة متكررة. المخالفة الحقيقية هي وجود النمط في **الكود الفعلي**، لذلك تُزال
 * التعليقات قبل المطابقة — فيصبح الفحص أدق وأقوى معًا.
 */

/** يزيل تعليقات JS/TS/CSS/JSX مع احترام النصوص الحرفية حتى لا يُفسد عناوين مثل `https://`. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        const isClosing = source[i] === quote;
        i += 1;
        if (isClosing) break;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** يجمع كل ملفات الكود تحت المجلدات المعطاة (مسارات نسبية لجذر المستودع). */
export function collectSourceFiles(repoRoot: string, dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (rel: string) => {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(childRel);
      else if (/\.(ts|tsx|css|mjs|js)$/.test(entry.name)) files.push(childRel);
    }
  };
  dirs.forEach(walk);
  return files;
}

export interface SourceScanViolation {
  file: string;
  reason: string;
}

/**
 * يفحص ملفات المصدر بحثًا عن أنماط ممنوعة، بعد إزالة التعليقات.
 * @param patterns قائمة من `{ regex, reason }` — تُطبَّق على كل ملف.
 */
export function scanForbiddenPatterns(
  repoRoot: string,
  dirs: string[],
  patterns: Array<{ regex: RegExp; reason: string }>
): SourceScanViolation[] {
  const violations: SourceScanViolation[] = [];
  for (const rel of collectSourceFiles(repoRoot, dirs)) {
    const code = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'));
    for (const { regex, reason } of patterns) {
      if (regex.test(code)) violations.push({ file: rel, reason });
    }
  }
  return violations;
}
