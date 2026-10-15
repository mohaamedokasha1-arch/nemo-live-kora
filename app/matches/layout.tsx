import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'جدول المباريات | NEMO Live Kora',
  description:
    'شاهد جدول المباريات الكامل لجميع البطولات العربية والعالمية',
  keywords:
    'مباريات، جدول المباريات، دوري أبطال أوروبا، الدوري المصري، البث المباشر',
};

export default function MatchesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
