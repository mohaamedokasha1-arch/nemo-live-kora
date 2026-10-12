'use client';

import React, { useState } from 'react';

export default function AdminNewsClient() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const runSync = async () => {
    setBusy(true);
    setMessage('جاري تشغيل المزامنة الاختبارية...');
    try {
      const res = await fetch('/api/admin/news/sync', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.messageAr || 'فشل تشغيل المزامنة');
      } else {
        setMessage(body.sync?.messageAr || 'اكتملت المزامنة');
        window.location.reload();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تشغيل المزامنة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kl-admin-actions">
      <button type="button" className="kl-nav-cta" onClick={runSync} disabled={busy}>
        {busy ? 'جاري المزامنة...' : 'تشغيل مزامنة اختبارية للأخبار'}
      </button>
      {message ? <p className="kl-news-updated">{message}</p> : null}
    </div>
  );
}
