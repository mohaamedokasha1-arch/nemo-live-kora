import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  hasConfiguredAdminSecret,
  isValidAdminSecret,
  unauthorizedJson,
} from '@/lib/auth/cron-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!hasConfiguredAdminSecret()) {
    return unauthorizedJson(
      'لوحة الأخبار محمية. اضبط CRON_SECRET أو NEMO_INGEST_TOKEN في بيئة الاستضافة.',
      500
    );
  }

  let token = '';
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: string };
      token = (body?.token || '').trim();
    } else {
      const form = await request.formData();
      token = String(form.get('token') || '').trim();
    }
  } catch {
    token = '';
  }

  if (!isValidAdminSecret(token)) {
    return unauthorizedJson('رمز الدخول غير صحيح.');
  }

  const redirectTo = new URL('/admin/news', request.url);
  const response = NextResponse.redirect(redirectTo, 303);
  response.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, '', { ...adminCookieOptions(), maxAge: 0 });
  return response;
}
