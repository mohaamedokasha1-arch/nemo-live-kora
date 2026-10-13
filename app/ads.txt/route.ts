import { NextResponse } from 'next/server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  /ads.txt — مسار ديناميكي جاهز لأكواد الناشرين
 * ═══════════════════════════════════════════════════════════════════════════════
 *  يُبنى السطر تلقائيًا من متغيّر البيئة NEXT_PUBLIC_ADSENSE_CLIENT:
 *     NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-1234567890123456
 *     → google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
 *
 *  ولإضافة شبكات أخرى (Medianet, AdMob, …) استخدم ADS_TXT_LINES:
 *     ADS_TXT_LINES="example.com, 12345, DIRECT; other.com, 67890, RESELLER"
 *  كل سطر غير صالح يُكتب كتعليق مع سبب واضح بدلًا من نشر سطر مكسور.
 *
 *  المحتوى يُقدَّم كـ text/plain ويُخزَّن مؤقتًا على حافة Vercel لمدة ساعة.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADSENSE_CERT_AUTHORITY = 'f08c47fec0942fa0';

/** يستخرج معرّف الناشر (pub-XXXX) من صيغة ca-pub-XXXX أو pub-XXXX. */
function extractPublisherId(rawValue: string | undefined): string | null {
  const value = rawValue?.trim();
  if (!value) return null;
  const match = /(?:ca-)?(pub-\d{6,20})/.exec(value);
  return match ? match[1] : null;
}

/** يتحقق من السطر وفق الصيغة القياسية: domain, publisher-id, DIRECT|RESELLER, [cert-id] */
function isValidAdsTxtLine(line: string): boolean {
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4) return false;
  const [domain, publisherId, relationship] = parts;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return false;
  if (!/^[a-z0-9-]{4,40}$/i.test(publisherId)) return false;
  if (!/^(DIRECT|RESELLER)$/i.test(relationship)) return false;
  return true;
}

function buildAdsTxtBody(): string {
  const publisherId = extractPublisherId(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
  const lines: string[] = [];
  const rejected: Array<{ line: string; reason: string }> = [];

  if (publisherId) {
    lines.push(`google.com, ${publisherId}, DIRECT, ${ADSENSE_CERT_AUTHORITY}`);
  }

  const rawLines = process.env.ADS_TXT_LINES || process.env.ADS_TXT_CUSTOM_LINES || '';
  for (const raw of rawLines.split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      lines.push(line);
      continue;
    }
    if (isValidAdsTxtLine(line)) {
      lines.push(line);
    } else {
      rejected.push({
        line,
        reason: 'الصيغة المتوقعة: domain, publisher-id, DIRECT|RESELLER[, cert-authority]',
      });
    }
  }

  const header = [
    '# ads.txt — نيمو كورة لايف (nemo-live-kora)',
    '# هذا الملف يُولَّد تلقائيًا من متغيّرات البيئة:',
    '#   NEXT_PUBLIC_ADSENSE_CLIENT = معرّف ناشر AdSense (ca-pub-XXXXXXXXXXXXXXXX)',
    '#   ADS_TXT_LINES             = أسطر إضافية لشبكات أخرى، مفصولة بـ ; أو سطر جديد',
    `# آخر توليد: ${new Date().toISOString()}`,
    publisherId
      ? '# حالة AdSense: مُفعّل (السطر الأول أدناه).'
      : '# حالة AdSense: غير مُفعّل — أضف NEXT_PUBLIC_ADSENSE_CLIENT لتوليد السطر تلقائيًا.',
  ];

  const rejectedBlock = rejected.flatMap((item) => [
    `# ⚠️ سطر مرفوض ولم يُنشر: ${item.line}`,
    `#    السبب: ${item.reason}`,
  ]);

  const body = [...header, ...rejectedBlock, '', ...lines, ''].join('\n');
  return body;
}

export function GET() {
  return new NextResponse(buildAdsTxtBody(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}
