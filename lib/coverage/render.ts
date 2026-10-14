import type { CoverageReport } from './compare';

/** تقرير Markdown قابل للقراءة من تقرير التغطية (للمراجعة اليدوية، لا يُعرض على الموقع). */
export function renderCoverageMarkdown(report: CoverageReport, reference: Record<string, unknown>): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# تقرير تغطية المباريات (${report.window.from} → ${report.window.to})`);
  lines.push('');
  lines.push(`- وقت التوليد: ${report.generatedAt}`);
  lines.push(`- المرجع: ${report.referenceSources.join('، ') || 'لا شيء'}`);
  if (report.referenceFeedsSite) {
    lines.push('- **تنبيه:** المرجع نفسه يغذّي الموقع، لذلك التغطية هنا تقيس الاتساق لا الاكتمال المستقل.');
  }
  lines.push(`- بيانات المرجع: \`${JSON.stringify(reference)}\``);
  lines.push('');
  lines.push('## الملخص');
  lines.push('');
  lines.push(`| المقياس | القيمة |`);
  lines.push(`|---|---:|`);
  lines.push(`| مباريات المرجع في النافذة | ${s.referenceTotal} |`);
  lines.push(`| مباريات المرجع خارج النافذة (مستبعدة) | ${s.referenceOutOfWindow} |`);
  lines.push(`| مباريات الموقع في النافذة | ${s.siteTotalInWindow} |`);
  lines.push(`| مطابقة | ${s.matched} (تطابق تام ${s.matchedExact}) |`);
  lines.push(`| ناقصة في الموقع | ${s.missing} |`);
  lines.push(`| موجودة في الموقع فقط | ${s.siteOnly} |`);
  lines.push(`| نسبة التغطية | ${s.coveragePct === null ? 'غير محسوبة (لا توجد مباريات في المرجع)' : `${s.coveragePct}%`} |`);
  lines.push(`| بطولات المرجع | ${s.competitionsInReference} (غائبة: ${s.competitionsMissing}) |`);
  lines.push('');
  lines.push('## التغطية لكل تاريخ');
  lines.push('');
  lines.push('| التاريخ | المرجع | مطابقة | ناقصة | موقع فقط | النسبة |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of report.perDate) {
    lines.push(`| ${row.cairoDate} | ${row.reference} | ${row.matched} | ${row.missing} | ${row.siteOnly} | ${row.coveragePct === null ? '—' : `${row.coveragePct}%`} |`);
  }
  lines.push('');
  lines.push('## المشكلات');
  lines.push('');
  if (report.issues.length === 0) {
    lines.push('لا توجد مشكلات ضمن هذه النافذة.');
  } else {
    lines.push('| النوع | التاريخ | البطولة | المضيف | الضيف | التفاصيل |');
    lines.push('|---|---|---|---|---|---|');
    for (const issue of report.issues) {
      const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(
        `| ${issue.kind} | ${issue.cairoDate} | ${cell(issue.competition)} | ${cell(issue.home)} | ${cell(issue.away)} | ${cell(issue.detail)} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
