'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from './ui';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="kl-admin-btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await adminApi('/api/admin/session', { method: 'DELETE' });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? 'جارٍ الخروج…' : 'خروج'}
    </button>
  );
}
