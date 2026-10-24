import { runtimeEnvironment } from '../config/runtime-env';
import crypto from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  توقيع جلسة الإدارة — وحدة مستقلة بلا أي اعتماد داخلي
 * ═══════════════════════════════════════════════════════════════════════════════
 *  لماذا وحدة منفصلة؟ لأنّ **لوحة الأخبار القديمة** (`/admin/news`) وواجهاتها كانت
 *  تتحقق من الكوكي بمقارنة الرمز المشترك (`CRON_SECRET`) مباشرة. وبعد إضافة الجلسات
 *  الموقَّعة صار لِزامًا أن تقبل تلك المسارات الجلسة الجديدة أيضًا، مع تجنّب استيراد
 *  دائري بين `cron-auth` و`admin-session`. فوضعنا هنا منطق التوقيع/التحقق وحده،
 *  ويستورده الاثنان.
 *
 *  محتوى الكوكي: `v1.<base64url(payload)>.<base64url(HMAC-SHA256)>` — لا كلمة مرور
 *  ولا سر مشترك، فقط اسم المستخدم والدور ووقت الانتهاء وطريقة الدخول.
 */

export interface SessionPayload {
  u: string;
  r: 'owner' | 'editor' | 'viewer';
  d: string;
  via: 'password' | 'shared_secret' | 'bearer';
  exp: number;
}

export function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/**
 * مفتاح توقيع الجلسة. إن لم يُضبط `NEMO_ADMIN_SESSION_SECRET` نشتقّه من الرمز
 * المشترك حتى لا يعمل النظام بسر افتراضي مكتوب في الكود:
 * بلا أي سر مضبوط لا تُنشأ جلسات أصلًا.
 */
export function sessionSigningKey(env: NodeJS.ProcessEnv = runtimeEnvironment()): Buffer | null {
  const explicit = (env.NEMO_ADMIN_SESSION_SECRET || '').trim();
  if (explicit.length >= 16) return crypto.createHash('sha256').update(`nemo-session::${explicit}`).digest();
  const shared = [(env.CRON_SECRET || '').trim(), (env.NEMO_INGEST_TOKEN || '').trim()].filter(Boolean);
  if (shared.length > 0) return crypto.createHash('sha256').update(`nemo-session::${shared.join('|')}`).digest();
  return null;
}

export function signSessionPayload(payload: SessionPayload, key: Buffer): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const signature = base64url(crypto.createHmac('sha256', key).update(body).digest());
  return `v1.${body}.${signature}`;
}

export function base64urlHmac(key: Buffer, body: string): string {
  return base64url(crypto.createHmac('sha256', key).update(body).digest());
}

/** مقارنة ثابتة الزمن بين نصّين (تُستخدم للتحقق من التوقيع). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * يتحقق من كوكي جلسة موقَّعة ويعيد محتواها أو null.
 * يتحقق من: الشكل (`v1.x.y`) + التوقيع + صلاحية الدور + عدم انتهاء المدة.
 */
export function readSignedSessionCookie(
  raw: string | undefined | null,
  env: NodeJS.ProcessEnv = runtimeEnvironment()
): SessionPayload | null {
  const value = (raw || '').trim();
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const key = sessionSigningKey(env);
  if (!key) return null;
  const [, body, signature] = parts;
  if (!timingSafeStringEqual(signature, base64urlHmac(key, body))) return null;
  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf-8')) as SessionPayload;
    if (!payload.u || !['owner', 'editor', 'viewer'].includes(payload.r)) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
