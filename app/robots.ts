import { MetadataRoute } from 'next';

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://nemo-live-kora.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/matches/', '/sources', '/news'],
        disallow: ['/api/', '/admin'],
      },
    ],
    sitemap: `${GATEWAY_URL}/sitemap.xml`,
  };
}
