import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  ROLE_LABEL_AR,
  adminSessionCookieOptions,
  hasPasswordAdmin,
  isAdminLoginAvailable,
  isLoginBlocked,
  readAdminIdentity,
  registerLoginAttempt,
  verifyAdminPassword,
  findAdminUser,
  createAdminSession,
} from '@/lib/auth/admin-session';
import { hasConfiguredAdminSecret, isValidAdminSecret } from '@/lib/auth/cron-auth';
import { getManualStatus, loadManualDocument } from '@/lib/admin/manual-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * جلسة لوحة الإدارة: قراءة الهوية الحالية، الدخول، والخروج.
 *
 * كل الفحوص على الخادم: كلمة المرور تُقارَن بـ hash مُخزَّن في متغيّر بيئة، والكوكي
 * الذي يُعاد هو **جلسة موقَّعة** لا كلمة المرور ولا السر نفسه.
 */

function sessionPayload(request: NextRequest) {
  const identity = readAdminIdentity(request);
  return {
    ok: Boolean(identity),
    identity,
    roleLabelAr: identity ? ROLE_LABEL_AR[identity.role] : null,
    loginAvailable: isAdminLoginAvailable(),
    passwordLoginConfigured: hasPasswordAdmin(),
    sharedSecretConfigured: hasConfiguredAdminSecret(),
  };
}

export async function GET(request: NextRequest) {
  const status = getManualStatus();
  return NextResponse.json(
    {
      ...sessionPayload(request),
      storage: status,
      permissionsHintAr:
        'كل عملية تُفحص على الخادم حسب الدور: المالك (كل شيء) · المحرّر (المحتوى والمصادر والنسخ) · المُشاهد (قراءة فقط).',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  if (!isAdminLoginAvailable()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'AdminNotConfigured',
        messageAr:
          'لوحة الإدارة غير مهيّأة بعد. اضبط NEMO_ADMIN_PASSWORD_HASH (وناتج npm run admin:password) أو CRON_SECRET في متغيّرات بيئة الاستضافة ثم أعد النشر.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const forwarded = request.headers.get('x-forwarded-for') || '';
  const clientKey = (forwarded.split(',')[0] || request.headers.get('x-real-ip') || 'local').trim();
  if (isLoginBlocked(clientKey)) {
    return NextResponse.json(
      { ok: false, error: 'TooManyAttempts', messageAr: 'محاولات كثيرة فاشلة من هذا العنوان. انتظر 15 دقيقة ثم أعد المحاولة.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let username = '';
  let password = '';
  let sharedToken = '';
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { username?: string; password?: string; token?: string };
      username = (body.username || '').trim();
      password = body.password || '';
      sharedToken = (body.token || '').trim();
    } else {
      const form = await request.formData();
      username = String(form.get('username') || '').trim();
      password = String(form.get('password') || '');
      sharedToken = String(form.get('token') || '').trim();
    }
  } catch {
    // مدخلات غير مقروءة ⇒ نُكمل كطلب فاشل طبيعي.
  }
  if (!username && sharedToken) username = 'shared-secret';

  // مسار الدخول بالرمز المشترك القديم (CRON_SECRET / NEMO_INGEST_TOKEN):
  // يبقى يعمل كما كان بالحرف — نفس الكوكي ونفس القيمة — حتى لا يتعطّل من اعتاد عليه.
  if (sharedToken) {
    if (!isValidAdminSecret(sharedToken)) {
      registerLoginAttempt(clientKey, false);
      return NextResponse.json(
        { ok: false, error: 'Unauthorized', messageAr: 'الرمز المشترك غير صحيح.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    registerLoginAttempt(clientKey, true);
    const response = NextResponse.json(
      {
        ok: true,
        identity: { username: 'shared-secret', role: 'owner', displayNameAr: 'دخول بالرمز المشترك', via: 'shared_secret' },
        messageAr: 'تم الدخول بالرمز المشترك بدور المالك.',
        redirectTo: '/admin',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    response.cookies.set(ADMIN_SESSION_COOKIE, sharedToken, adminSessionCookieOptions());
    return response;
  }

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: 'BadRequest', messageAr: 'أدخل اسم المستخدم وكلمة المرور.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const user = findAdminUser(username);
  const valid = user ? verifyAdminPassword(password, user.passwordHash) : false;
  if (!valid || !user) {
    const attempt = registerLoginAttempt(clientKey, false);
    return NextResponse.json(
      {
        ok: false,
        error: 'Unauthorized',
        messageAr: attempt.blocked
          ? 'محاولات كثيرة فاشلة — أُوقف الدخول 15 دقيقة من هذا العنوان.'
          : `بيانات الدخول غير صحيحة. المحاولات المتبقية قبل الإيقاف المؤقت: ${attempt.remaining}.`,
      },
      { status: attempt.blocked ? 429 : 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const session = createAdminSession({
    username: user.username,
    role: user.role,
    displayNameAr: user.displayNameAr || user.username,
    via: 'password',
  });
  if (!session.ok || !session.cookie) {
    return NextResponse.json({ ok: false, messageAr: session.messageAr }, { status: 500 });
  }

  await loadManualDocument();
  registerLoginAttempt(clientKey, true);
  const response = NextResponse.json(
    {
      ok: true,
      identity: {
        username: user.username,
        role: user.role,
        displayNameAr: user.displayNameAr,
        expiresAt: session.expiresAt,
      },
      messageAr: `مرحبًا ${user.displayNameAr}. الدخول صالح حتى ${session.expiresAt}.`,
      redirectTo: '/admin',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  response.cookies.set(ADMIN_SESSION_COOKIE, session.cookie, adminSessionCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true, messageAr: 'تم الخروج من لوحة الإدارة.' });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { ...adminSessionCookieOptions(), maxAge: 0 });
  return response;
}
