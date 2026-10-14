'use client';

import React, { useCallback, useState } from 'react';
import { formatAgeAr, formatDateAr } from '../_lib/format';

export { formatAgeAr, formatDateAr };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  مكوّنات لوحة الإدارة المشتركة
 * ═══════════════════════════════════════════════════════════════════════════════
 *  قاعدة واحدة تحكم كل شيء هنا: **لا زر يبدو فعّالًا وهو غير موصول بوظيفة خلفية**.
 *  لذلك:
 *   • كل زر إجراء يُعطَّل أثناء التنفيذ (`busy`) ويُعرض نصه الحقيقي بعد الانتهاء.
 *   • كل نتيجة من الخادم تُعرض كما وصلت (`messageAr`) بلا تجميل: نجاح = نجاح،
 *     وفشل = فشل مع السبب، و«لم يُحفظ شيء» تعني فعلًا أنه لم يُحفظ شيء.
 *   • الأزرار التي تحتاج تخزينًا دائمًا تُعطَّل مع سبب مكتوب بجانبها.
 */

export interface AdminApiResult<T> {
  ok: boolean;
  messageAr?: string;
  warningsAr?: string[];
  seoImpactAr?: string[];
  error?: string;
  status: number;
  data?: T;
}

/** نداء موحّد لواجهات الإدارة: يعيد دائمًا نتيجة قابلة للعرض ولا يرمي استثناءً للواجهة. */
export async function adminApi<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<AdminApiResult<T>> {
  const { json, ...rest } = init;
  try {
    const response = await fetch(path, {
      ...rest,
      credentials: 'same-origin',
      headers: {
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers || {}),
      },
      body: json ? JSON.stringify(json) : rest.body,
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: response.ok && payload.ok !== false,
      status: response.status,
      messageAr: typeof payload.messageAr === 'string' ? payload.messageAr : undefined,
      warningsAr: Array.isArray(payload.warningsAr) ? (payload.warningsAr as string[]) : undefined,
      seoImpactAr: Array.isArray(payload.seoImpactAr) ? (payload.seoImpactAr as string[]) : undefined,
      error: typeof payload.error === 'string' ? payload.error : undefined,
      data: payload as T,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      messageAr: `تعذّر الوصول إلى الخادم: ${error instanceof Error ? error.message : 'خطأ شبكة'}`,
      error: 'NetworkError',
    };
  }
}

export interface ActionResult {
  ok: boolean;
  messageAr?: string;
  warningsAr?: string[];
  seoImpactAr?: string[];
}

export function useAdminAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = useCallback(
    async (key: string, task: () => Promise<ActionResult>): Promise<ActionResult> => {
      setBusy(key);
      setResult(null);
      try {
        const outcome = await task();
        setResult(outcome);
        return outcome;
      } catch (error) {
        const outcome: ActionResult = {
          ok: false,
          messageAr: `فشل غير متوقع: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`,
        };
        setResult(outcome);
        return outcome;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  return { busy, result, run, setResult };
}

export function ResultNote({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`kl-admin-note ${result.ok ? 'kl-admin-note-ok' : 'kl-admin-note-danger'}`} role="status">
      <strong>{result.ok ? 'تم' : 'لم يتم'}:</strong> {result.messageAr || (result.ok ? 'نجحت العملية.' : 'فشلت العملية.')}
      {result.warningsAr && result.warningsAr.length > 0 ? (
        <ul className="kl-admin-list">
          {result.warningsAr.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {result.seoImpactAr && result.seoImpactAr.length > 0 ? (
        <ul className="kl-admin-list">
          {result.seoImpactAr.map((impact) => (
            <li key={impact}>أثر على الفهرسة/المشاركة: {impact}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Card({
  title,
  children,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="kl-admin-card">
      {title || action ? (
        <div className="kl-admin-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'muted';
  children: React.ReactNode;
}) {
  return <span className={`kl-admin-badge kl-admin-badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`kl-admin-field${span ? ' kl-admin-field-span' : ''}`}>
      <label>
        {label}
        {hint ? <small> — {hint}</small> : null}
      </label>
      {children}
    </div>
  );
}

/**
 * زر إجراء موحّد: يُعطَّل أثناء التنفيذ، ويُعرض سبب تعطيله إن كان معطّلًا لأمر آخر
 * (مثل غياب تخزين دائم) — بدل أن يبقى يبدو قابلًا للنقر بلا نتيجة.
 */
export function ActionButton({
  onClick,
  busy,
  busyKey,
  disabled,
  disabledReasonAr,
  tone = 'default',
  confirmAr,
  children,
}: {
  onClick: () => unknown;
  busy?: string | null;
  busyKey: string;
  disabled?: boolean;
  disabledReasonAr?: string;
  tone?: 'default' | 'primary' | 'danger';
  confirmAr?: string;
  children: React.ReactNode;
}) {
  const isBusy = busy === busyKey;
  const [confirming, setConfirming] = useState(false);
  const className = `kl-admin-btn${tone === 'primary' ? ' kl-admin-btn-primary' : ''}${
    tone === 'danger' ? ' kl-admin-btn-danger' : ''
  }`;

  if (confirmAr && confirming) {
    return (
      <span className="kl-admin-actions">
        <span className="kl-admin-note kl-admin-note-warn">{confirmAr}</span>
        <button
          type="button"
          className={className}
          disabled={isBusy}
          onClick={() => {
            setConfirming(false);
            void onClick();
          }}
        >
          {isBusy ? 'جارٍ التنفيذ…' : 'تأكيد'}
        </button>
        <button type="button" className="kl-admin-btn" onClick={() => setConfirming(false)}>
          إلغاء
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || isBusy}
      title={disabled ? disabledReasonAr : undefined}
      onClick={() => {
        if (confirmAr) {
          setConfirming(true);
          return;
        }
        void onClick();
      }}
    >
      {isBusy ? 'جارٍ التنفيذ…' : children}
    </button>
  );
}

/** تنبيه علوي: يُعرض في كل صفحة إدارية عند غياب تخزين دائم أو وجود تحذيرات نظام. */
export function StorageBanner({
  durable,
  writable,
  driver,
  noteAr,
  requiredEnv,
}: {
  durable: boolean;
  writable: boolean;
  driver: string;
  noteAr: string;
  requiredEnv: string[];
}) {
  if (durable && writable) {
    return (
      <div className="kl-admin-note kl-admin-note-ok">
        <strong>تخزين التعديلات:</strong> {driver} — دائم. {noteAr}
      </div>
    );
  }
  return (
    <div className="kl-admin-banner kl-admin-banner-danger" role="alert">
      <div>
        <strong>تحذير: تعديلات الإدارة غير محفوظة في تخزين دائم على هذه البيئة.</strong> {noteAr}
      </div>
      {requiredEnv.length > 0 ? (
        <div className="kl-admin-mono">المتغيّرات المطلوبة: {requiredEnv.join(' , ')}</div>
      ) : null}
      <div>
        أزرار الحفظ معطّلة حتى يُضبط التخزين — لا نُظهر نجاحًا غير حقيقي. وفي هذه الحالة يبقى الموقع
        يعمل ببيانات آخر لقطة صحيحة.
      </div>
    </div>
  );
}

export function Kv({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <div className="kl-admin-kv">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
