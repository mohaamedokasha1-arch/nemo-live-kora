/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'img.thesports.com' },
      { protocol: 'https', hostname: 'r2.thesportsdb.com' },
      { protocol: 'https', hostname: 'www.thesportsdb.com' },
      { protocol: 'https', hostname: 'crests.football-data.org' },
      { protocol: 'https', hostname: 'media.api-sports.io' }
    ]
  },
  /**
   * خطوط Cairo بصيغة TTF تُقرأ من القرص لتوليد صورة المشاركة (1200×675) عبر next/og.
   * يجب تضمينها صريحًا في حزمة الدالة السحابية على Vercel، وإلا فشلت القراءة في الإنتاج
   * بينما تنجح محليًا — وهو فرق خطير يظهر بعد النشر فقط.
   */
  outputFileTracingIncludes: {
    '/matches/[id]/opengraph-image': ['./assets/fonts/**'],
    '/**': ['./assets/fonts/**']
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
        ]
      }
    ];
  }
};

export default nextConfig;
