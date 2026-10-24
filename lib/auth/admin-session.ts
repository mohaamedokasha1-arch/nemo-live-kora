import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, hasConfiguredAdminSecret, isValidAdminSecret } from './cron-auth';
import {
  SessionPayload,
  base64url,
  fromBase64url,
  readSignedSessionCookie,
  sessionSigningKey,
  signSessionPayload,
} from './admin-session-cookie';
import type { AdminRole } from '../admin/manual-document';
import { runtimeEnvironment } from '../config/runtime-env';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  مصادقة لوحة الإدارة — كلمات مرور مُجزَّأة + جلسة موقَّعة + صلاحيات
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  لماذا لا نستخدم رمزًا ثابتًا في ترويسة أو كوكي كما كان؟
 *  لأن اللوحة الجديدة تكتب في الموقع: مباريات وأخبار وإعدادات واستعادة نسخ. الرمز
 *  الثابت (CRON_SECRET) صالح للكرون لكن تخزينه كما هو في الكوكي يعني أن أي تسريب
 *  للكوكي = تسريب السر نفسه. هنا:
 *   • كلمة المرور تُخزَّن كـ **hash** بـ scrypt (salt عشوائي لكل مستخدم) في متغيّر
 *     بيئة، ولا تُكتب في الكود ولا في المستودع ولا في أي ملف أمامي.
 *   • ما يُخزَّن في كوكي المتصفح هو **جلسة موقَّعة** (HMAC-SHA256) تحمل المستخدم
 *     والدور ووقت الانتهاء — لا كلمة المرور ولا السر.
 *   • كل المسارات الإدارية تتحقق على الخادم (`requireAdminSession`) وترفض بلا استثناء.
 *
 *  توافقية محفوظة: من كان يدخل بالرمز القديم (CRON_SECRET) يظل قادرًا على الدخول،
 *  لكن جلسة الرمز تُوقَّع أيضًا وتُمنح دور `owner`، وتبقى صالحة للكرون كما هي.
 */

/** مدة الجلسة بالثواني (12 ساعة — يوم عمل واحد). */
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

export const ADMIN_SESSION_COOKIE = ADMIN_COOKIE;

export interface AdminUser {
  username: string;
  role: AdminRole;
  /** hash بصيغة scrypt$N$r$p$salt$hash (base64url لكل جزء). */
  passwordHash: string;
  displayNameAr: string;
}

export interface AdminIdentity {
  username: string;
  role: AdminRole;
  displayNameAr: string;
  /** كيف دخل: بكلمة مرور، أو بالرمز المشترك القديم، أو رمز كرون/أداة. */
  via: 'password' | 'shared_secret' | 'bearer';
  expiresAt: string;
}

// ── تجزئة كلمات المرور ────────────────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/** ينتج `scrypt$N$r$p$salt$hash` — الصيغة الموثّقة في `.env.example` و`npm run admin:password`. */
export function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${base64url(salt)}$${base64url(derived)}`;
}

/** مقارنة ثابتة الزمن بين كلمة المرور والـ hash المخزَّن. */
export function verifyAdminPassword(password: string, stored: string): boolean {
  const parts = stored.trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  try {
    const salt = fromBase64url(saltRaw);
    const expected = fromBase64url(hashRaw);
    const derived = crypto.scryptSync(password, salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ── المستخدمون ───────────────────────────────────────────────────────────────

/** القيم الوهمية تُعامل كغير مضبوطة (نفس قاعدة `lib/config/env.ts`). */
function looksPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return ['changeme', 'change_me', 'your_password', 'password', 'secret', 'xxx', 'yyyy', 'test', 'admin123'].some(
    (placeholder) => v === placeholder || v.startsWith(`${placeholder}-`)
  );
}

/**
 * يقرأ المستخدمين من البيئة. الطريقتان مدعومتان:
 *   1) `NEMO_ADMIN_USERS` = JSON: [{ "username", "role", "passwordHash", "displayNameAr" }]
 *   2) `NEMO_ADMIN_USER` + `NEMO_ADMIN_PASSWORD_HASH` (+ `NEMO_ADMIN_ROLE` اختياري)
 * ولا توجد بيانات دخول مكتوبة في المستودع إطلاقًا — تعذُّر التهيئة يعني أن اللوحة
 * تُعلن ذلك وترفض الدخول بدل إنشاء حساب افتراضي ضعيف.
 */
export function listAdminUsers(env: NodeJS.ProcessEnv = runtimeEnvironment()): AdminUser[] {
  const users: AdminUser[] = [];

  const json = (env.NEMO_ADMIN_USERS || '').trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Array<Partial<AdminUser> & { role?: string }>;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const username = (entry.username || '').trim();
          const passwordHash = (entry.passwordHash || '').trim();
          const role = (entry.role || 'editor').trim() as AdminRole;
          if (!username || !passwordHash.startsWith('scrypt$')) continue;
          if (!['owner', 'editor', 'viewer'].includes(role)) continue;
          users.push({
            username,
            role,
            passwordHash,
            displayNameAr: (entry.displayNameAr || username).trim(),
          });
        }
      }
    } catch {
      // JSON غير صالح ⇒ نتجاهله ونُكمل بالطريقة الثانية إن وُجدت.
    }
  }

  const singleUser = (env.NEMO_ADMIN_USER || env.NEMO_ADMIN_USERNAME || 'admin').trim() || 'admin';
  const singleHash = (env.NEMO_ADMIN_PASSWORD_HASH || '').trim();
  const role = ((env.NEMO_ADMIN_ROLE || 'owner').trim() as AdminRole) || 'owner';
  const validRole = ['owner', 'editor', 'viewer'].includes(role) ? role : 'owner';
  if (singleHash.startsWith('scrypt$') && !looksPlaceholder(singleHash)) {
    if (!users.some((user) => user.username === singleUser)) {
      users.push({
        username: singleUser,
        role: validRole,
        passwordHash: singleHash,
        displayNameAr: (env.NEMO_ADMIN_DISPLAY_NAME || 'مدير الموقع').trim(),
      });
    }
  }

  return users;
}

export function hasPasswordAdmin(env: NodeJS.ProcessEnv = runtimeEnvironment()): boolean {
  return listAdminUsers(env).length > 0;
}

/** هل يمكن الدخول بأي طريقة؟ (كلمة مرور مُجزَّأة، أو الرمز المشترك القديم). */
export function isAdminLoginAvailable(env: NodeJS.ProcessEnv = runtimeEnvironment()): boolean {
  return hasPasswordAdmin(env) || hasConfiguredAdminSecret();
}

export function findAdminUser(username: string, env: NodeJS.ProcessEnv = runtimeEnvironment()): AdminUser | null {
  const normalized = username.trim().toLowerCase();
  return listAdminUsers(env).find((user) => user.username.toLowerCase() === normalized) ?? null;
}

// ── الجلسة ───────────────────────────────────────────────────────────────────

// مفتاح التوقيع والتوقيع نفسه انتقلا إلى `admin-session-cookie` (وحدة بلا اعتماد دائري)
// حتى تستطيع مسارات لوحة الأخبار القديمة قبول الجلسة الجديدة أيضًا.

export function createAdminSession(
  identity: Omit<AdminIdentity, 'expiresAt'>,
  env: NodeJS.ProcessEnv = runtimeEnvironment()
): { ok: boolean; cookie: string | null; expiresAt: string | null; messageAr: string } {
  const key = sessionSigningKey(env);
  if (!key) {
    return {
      ok: false,
      cookie: null,
      expiresAt: null,
      messageAr:
        'لا يوجد سر لتوقيع الجلسة: اضبط NEMO_ADMIN_SESSION_SECRET (أو CRON_SECRET) في متغيّرات البيئة.',
    };
  }
  const expiresAtMs = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const payload: SessionPayload = {
    u: identity.username,
    r: identity.role,
    d: identity.displayNameAr,
    via: identity.via,
    exp: expiresAtMs,
  };
  return {
    ok: true,
    cookie: signSessionPayload(payload, key),
    expiresAt: new Date(expiresAtMs).toISOString(),
    messageAr: 'تم إنشاء الجلسة.',
  };
}

/** يتحقق من كوكي الجلسة ويعيد الهوية أو null (التوقيع + الانتهاء + الدور). */
export function readAdminSession(
  cookieValue: string | undefined | null,
  env: NodeJS.ProcessEnv = runtimeEnvironment()
): AdminIdentity | null {
  const raw = (cookieValue || '').trim();
  if (!raw) return null;

  // توافقية: الرمز المشترك القديم كان يُخزَّن كما هو في الكوكي.
  if (isValidAdminSecret(raw)) {
    return {
      username: 'shared-secret',
      role: 'owner',
      displayNameAr: 'دخول بالرمز المشترك',
      via: 'shared_secret',
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString(),
    };
  }

  const payload = readSignedSessionCookie(raw, env);
  if (!payload) return null;
  return {
    username: payload.u,
    role: payload.r,
    displayNameAr: payload.d || payload.u,
    via: payload.via || 'password',
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

// ── الصلاحيات ────────────────────────────────────────────────────────────────

/**
 * الصلاحيات المعرّفة. كل مسار إداري يطلب واحدة منها صراحةً، والفحص يحدث على
 * الخادم في كل طلب (لا اعتماد على إخفاء زر في الواجهة).
 */
export type AdminPermission =
  | 'dashboard:read'
  | 'matches:read'
  | 'matches:write'
  | 'news:read'
  | 'news:write'
  | 'catalog:read'
  | 'catalog:write'
  | 'sources:read'
  | 'sources:write'
  | 'sync:run'
  | 'settings:read'
  | 'settings:write'
  | 'logs:read'
  | 'backups:read'
  | 'backups:write'
  | 'backups:restore';

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[] | '*'> = {
  owner: '*',
  editor: [
    'dashboard:read',
    'matches:read',
    'matches:write',
    'news:read',
    'news:write',
    'catalog:read',
    'catalog:write',
    'sources:read',
    'sync:run',
    'settings:read',
    'logs:read',
    'backups:read',
    'backups:write',
  ],
  viewer: [
    'dashboard:read',
    'matches:read',
    'news:read',
    'catalog:read',
    'sources:read',
    'settings:read',
    'logs:read',
    'backups:read',
  ],
};

export const ROLE_LABEL_AR: Record<AdminRole, string> = {
  owner: 'مالك (كل الصلاحيات، بما فيها الاستعادة والإعدادات)',
  editor: 'محرّر (المباريات والأخبار والمصادر والنسخ، بلا استعادة أو إعدادات)',
  viewer: 'مُشاهد (قراءة فقط)',
};

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed === '*' || allowed.includes(permission);
}

// ── استخراج الهوية من الطلب ───────────────────────────────────────────────────

/** يقرأ الهوية من الكوكي أو من ترويسة Bearer (للكرون والأدوات). */
export function readAdminIdentity(request: NextRequest): AdminIdentity | null {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const fromCookie = readAdminSession(cookie);
  if (fromCookie) return fromCookie;

  const header = (request.headers.get('authorization') || '').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || '';
  if (bearer && isValidAdminSecret(bearer)) {
    return {
      username: 'system',
      role: 'owner',
      displayNameAr: 'أداة/كرون (رمز الخادم)',
      via: 'bearer',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  return null;
}

export interface AdminDenied {
  response: NextResponse;
}

export function denyJson(messageAr: string, status = 401, error = 'Unauthorized'): AdminDenied {
  return {
    response: NextResponse.json(
      { ok: false, success: false, error, messageAr },
      { status, headers: status === 401 ? { 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' } }
    ),
  };
}

/** يحمي مسار API إداريًا: جلسة صالحة + الصلاحية المطلوبة. */
export function requireAdminPermission(
  request: NextRequest,
  permission: AdminPermission
): AdminDenied | { identity: AdminIdentity } {
  if (!isAdminLoginAvailable()) {
    return denyJson(
      'لوحة الإدارة غير مهيّأة: اضبط NEMO_ADMIN_PASSWORD_HASH (وNEMO_ADMIN_USER) أو CRON_SECRET في متغيّرات البيئة ثم أعد النشر.',
      503,
      'AdminNotConfigured'
    );
  }
  const identity = readAdminIdentity(request);
  if (!identity) return denyJson('غير مصرح — سجّل الدخول إلى لوحة الإدارة.');
  if (!roleHasPermission(identity.role, permission)) {
    return denyJson(
      `صلاحيتك الحالية (${ROLE_LABEL_AR[identity.role]}) لا تسمح بهذه العملية (${permission}).`,
      403,
      'Forbidden'
    );
  }
  return { identity };
}

export function isDenied(value: AdminDenied | { identity: AdminIdentity }): value is AdminDenied {
  return 'response' in value;
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

// ── منع تخمين كلمة المرور ────────────────────────────────────────────────────

interface AttemptWindow {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, AttemptWindow>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

/**
 * حدّ لمحاولات الدخول الفاشلة — لكل نسخة على حدة (لا مخزن مشترك في هذا المشروع،
 * والحدّ مذكور هنا بصراحة حتى لا يُفهم أنه حماية موزّعة).
 */
export function registerLoginAttempt(key: string, ok: boolean): { blocked: boolean; remaining: number } {
  const now = Date.now();
  const current = attempts.get(key);
  if (ok) {
    attempts.delete(key);
    return { blocked: false, remaining: MAX_ATTEMPTS };
  }
  if (!current || now - current.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return { blocked: false, remaining: MAX_ATTEMPTS - 1 };
  }
  current.count += 1;
  if (current.count >= MAX_ATTEMPTS) {
    current.blockedUntil = now + BLOCK_MS;
    return { blocked: true, remaining: 0 };
  }
  return { blocked: false, remaining: MAX_ATTEMPTS - current.count };
}

export function isLoginBlocked(key: string): boolean {
  const current = attempts.get(key);
  return Boolean(current && current.blockedUntil > Date.now());
}

export function resetLoginAttemptsForTests(): void {
  attempts.clear();
}
