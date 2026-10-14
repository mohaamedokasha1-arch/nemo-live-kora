'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from './ui';

/**
 * نموذج الدخول: حساب وكلمة مرور (الطريق الأساسي)، وفيه مسار توافقي واحد للرمز
 * المشترك القديم حتى لا يتعطّل من كان يدخل به. لا كلمة مرور ولا سر يُخزَّن في
 * الواجهة: كل شيء يُرسل إلى `/api/admin/session` الذي يعيد كوكي **جلسة موقَّعة**.
 */
export default function AdminLoginForm({
  passwordLoginConfigured,
  sharedSecretConfigured,
  storageNoteAr,
}: {
  passwordLoginConfigured: boolean;
  sharedSecretConfigured: boolean;
  storageNoteAr: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'token'>(passwordLoginConfigured ? 'password' : 'token');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageAr, setMessageAr] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessageAr('');
    const result = await adminApi<{ messageAr?: string; identity?: unknown }>('/api/admin/session', {
      method: 'POST',
      json: mode === 'password' ? { username, password } : { token },
    });
    setOk(result.ok);
    setMessageAr(result.messageAr || (result.ok ? 'تم الدخول.' : 'تعذّر الدخول.'));
    setBusy(false);
    if (result.ok) {
      setPassword('');
      setToken('');
      router.refresh();
    }
  };

  return (
    <form className="kl-admin-card kl-admin-login" onSubmit={submit}>
      <h1>دخول لوحة الإدارة</h1>
      <p className="kl-admin-note">{storageNoteAr}</p>

      {passwordLoginConfigured ? (
        <div className="kl-admin-actions">
          <button
            type="button"
            className={`kl-admin-btn${mode === 'password' ? ' kl-admin-btn-primary' : ''}`}
            onClick={() => setMode('password')}
          >
            حساب وكلمة مرور
          </button>
          {sharedSecretConfigured ? (
            <button
              type="button"
              className={`kl-admin-btn${mode === 'token' ? ' kl-admin-btn-primary' : ''}`}
              onClick={() => setMode('token')}
            >
              الرمز المشترك (توافقي)
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'password' ? (
        <>
          <div className="kl-admin-field">
            <label htmlFor="admin-username">اسم المستخدم</label>
            <input
              id="admin-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="kl-admin-field">
            <label htmlFor="admin-password">كلمة المرور</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <small>تُقارَن على الخادم مع hash مُخزَّن في متغيّر بيئة — لا تُخزَّن هنا ولا تُرسل لأي طرف آخر.</small>
          </div>
        </>
      ) : (
        <div className="kl-admin-field">
          <label htmlFor="admin-token">الرمز المشترك</label>
          <input
            id="admin-token"
            name="token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
          <small>CRON_SECRET أو NEMO_INGEST_TOKEN المضبوط على الخادم.</small>
        </div>
      )}

      <button type="submit" className="kl-admin-btn kl-admin-btn-primary" disabled={busy}>
        {busy ? 'جارٍ التحقق…' : 'دخول'}
      </button>

      {messageAr ? (
        <div className={`kl-admin-note ${ok ? 'kl-admin-note-ok' : 'kl-admin-note-danger'}`} role="status">
          {messageAr}
        </div>
      ) : null}
    </form>
  );
}
