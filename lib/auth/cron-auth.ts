import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const ADMIN_COOKIE = 'nemo_admin_session';

function configuredSecrets(): string[] {
  return [process.env.CRON_SECRET, process.env.NEMO_INGEST_TOKEN]
    .map((value) => (value || '').trim())
    .filter(Boolean);
}

export function hasConfiguredAdminSecret(): boolean {
  return configuredSecrets().length > 0;
}

export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function isValidAdminSecret(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  return configuredSecrets().some((secret) => safeCompare(trimmed, secret));
}

export function readBearerToken(request: NextRequest): string {
  const authHeader = (request.headers.get('authorization') || '').trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (bearerMatch) return bearerMatch[1].trim();
  return (request.headers.get('x-nemo-ingest-token') || '').trim();
}

export function unauthorizedJson(messageAr: string, status = 401) {
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: status === 401 ? 'Unauthorized' : 'Misconfigured',
      messageAr,
    },
    {
      status,
      headers: status === 401 ? { 'WWW-Authenticate': 'Bearer realm="cron"' } : undefined,
    }
  );
}

export function requireCronAuth(request: NextRequest): NextResponse | null {
  if (!hasConfiguredAdminSecret()) {
    console.error('[auth] sync_auth_not_configured');
    return unauthorizedJson(
      'المتغير البيئي CRON_SECRET أو NEMO_INGEST_TOKEN غير مضبوط على الخادم. أضفه في بيئة الاستضافة ثم أعد النشر.',
      500
    );
  }
  const token = readBearerToken(request);
  if (!isValidAdminSecret(token)) {
    return unauthorizedJson('غير مصرح — يجب تمرير ترويسة Authorization: Bearer <CRON_SECRET>');
  }
  return null;
}

export function requireAdminRequest(request: NextRequest): NextResponse | null {
  if (!hasConfiguredAdminSecret()) {
    console.error('[auth] sync_auth_not_configured');
    return unauthorizedJson(
      'لوحة الأخبار محمية. اضبط CRON_SECRET أو NEMO_INGEST_TOKEN في بيئة الاستضافة.',
      500
    );
  }
  const bearer = readBearerToken(request);
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value || '';
  if (isValidAdminSecret(bearer) || isValidAdminSecret(cookie)) {
    return null;
  }
  return unauthorizedJson('غير مصرح — سجّل الدخول إلى لوحة الأخبار أو أرسل رمزًا صالحًا.');
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  };
}
