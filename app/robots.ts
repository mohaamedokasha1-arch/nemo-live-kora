import { MetadataRoute } from 'next';
import { GATEWAY_SITE_URL } from '@/lib/site-url';

/**
 * robots.txt — يسمح لجميع محركات البحث بالزحف إلى كل الصفحات العامة:
 * الصفحة الرئيسية، جداول التواريخ، صفحات هبوط المباريات، الأخبار، والصفحات القانونية.
 * يُمنع فقط الزحف إلى مسارات الإدارة والـ API الداخلية.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/admin',
          // صفحات المشاهدة الداخلية تحمل وسم noindex لتجنّب تكرار المحتوى؛
          // نسمح بالزحف إليها حتى تقرأ محركات البحث الوسم نفسه.
        ],
      },
    ],
    sitemap: `${GATEWAY_SITE_URL}/sitemap.xml`,
    host: GATEWAY_SITE_URL,
  };
}
