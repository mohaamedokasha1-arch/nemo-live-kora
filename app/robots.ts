import { MetadataRoute } from 'next';
import { GATEWAY_SITE_URL } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/', '/admin'],
      },
    ],
    sitemap: `${GATEWAY_SITE_URL}/sitemap.xml`,
  };
}
