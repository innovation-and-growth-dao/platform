'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/prefs-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Report = {
  status: string;
  components: { database: string; redis: string };
};

export function HealthBadge() {
  const t = useT();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/internal/healthz`)
      .then((r) => r.json())
      .then(setReport)
      .catch(() => setError(true));
  }, []);

  if (error)
    return (
      <span className="text-red-600">
        {t('API unreachable')} ({API_URL})
      </span>
    );
  if (!report) return <span className="text-neutral-500">{t('checking API…')}</span>;

  return (
    <span>
      {t('API')} <strong>{report.status}</strong> · {t('db')} {report.components.database} ·{' '}
      {t('redis')} {report.components.redis}
    </span>
  );
}
