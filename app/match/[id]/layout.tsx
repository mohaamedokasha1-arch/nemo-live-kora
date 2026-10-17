import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { matchesData } from '@/lib/data/matches';

// Legacy hard-coded records include example.com assets and are not verified news
// or fixtures. Preserve their existing UI/URLs, but do not advertise them for indexing.
export const metadata: Metadata = {
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default async function LegacyMatchLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!matchesData.some(match => match.id === id)) notFound();
  return children;
}
