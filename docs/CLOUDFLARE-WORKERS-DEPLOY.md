# النشر على Cloudflare Workers عبر OpenNext

هذا المشروع تطبيق Next.js بخادم ديناميكي. انشره كـ **Cloudflare Worker باستخدام OpenNext**؛ لا تستخدم إعداد Cloudflare Pages التقليدي الذي يطلب مجلدًا ثابتًا مثل `out/`، لأنه لا يشغّل مسارات Next.js الديناميكية/لوحة الإدارة.

## إعداد Worker

ملفات الإعداد المضافة إلى الجذر:

- `open-next.config.ts` — إعداد محوّل OpenNext لـ Cloudflare.
- `wrangler.jsonc` — نقطة دخول Worker وأصوله وعلم `nodejs_compat`.

للنشر يدويًا من نسخة محلية موثّقة بـ Wrangler:

```sh
npm ci
npm run cf:build
npx wrangler login
npm run cf:deploy
```

أو أنشئ Worker عبر Cloudflare Workers Builds واربط المستودع. استخدم `npm ci` كأمر التثبيت و`npm run cf:build` كأمر البناء، ثم `npx wrangler deploy` للنشر. وجهة الإنتاج هي إعداد Worker في `wrangler.jsonc`، وليست إعدادات Pages.

## متغيرات الإدارة والكرون

أضف كل قيمة **سرية** من Cloudflare Dashboard → Workers & Pages → `nemo-live-kora` → Settings → Variables and Secrets، ثم أعد النشر. أو استخدم `npx wrangler secret put NAME` لكل سر. يلزم للإدارة بكلمة مرور:

- `NEMO_ADMIN_USER`
- `NEMO_ADMIN_PASSWORD_HASH` — ناتج `npm run admin:password -- "كلمة-مرور-قوية"`
- `NEMO_ADMIN_SESSION_SECRET` — سر عشوائي طويل مستقل (موصى به)

ولحماية مهام المزامنة/الدخول المشترك:

- `CRON_SECRET` (ويمكن استخدام `NEMO_INGEST_TOKEN` بديلًا)

تُقرأ هذه القيم أثناء الطلب من `getCloudflareContext().env`؛ لا تضع الأسرار في `wrangler.jsonc` أو GitHub. بعد ضبطها يلزم إعادة النشر. اختبر حالة إعداد الدخول عبر `/api/admin/session`، وتحقق من `loginAvailable` و`passwordLoginConfigured` دون كشف القيم السرية.

للتطوير المحلي مع Wrangler، أنشئ `.dev.vars` محليًا (وهو مستثنى من Git) وضع فيه القيم التجريبية، ثم استخدم `npx opennextjs-cloudflare preview` بعد `npm run cf:build`.

## تنبيه حول التخزين

نجاح تهيئة Worker لا يجعل نظام الملفات تخزينًا دائمًا. فعّل backend دائمًا موثقًا في `.env.example` (مثل KV/قاعدة بيانات/HTTP حسب دعم التطبيق) قبل الاعتماد على بيانات الإدارة والمباريات؛ ملفات Worker ليست مخزنًا دائمًا قابلًا للكتابة. كذلك ابدأ ببيئة Preview واختبر مسارات الإدارة والكرون قبل تحويل الإنتاج.
