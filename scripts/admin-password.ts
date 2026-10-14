/**
 * أداة توليد hash لكلمة مرور الإدارة (لا تُخزَّن كلمة المرور نفسها في أي مكان).
 *
 * الاستخدام:
 *   npm run admin:password -- "كلمة-مرور-قوية"
 *
 * ثم ضع الناتج في متغيّرات بيئة الاستضافة:
 *   NEMO_ADMIN_USER=admin
 *   NEMO_ADMIN_PASSWORD_HASH=scrypt$16384$8$1$...
 *   NEMO_ADMIN_ROLE=owner            (اختياري — الافتراضي owner)
 *   NEMO_ADMIN_SESSION_SECRET=<سر عشوائي ≥32 حرفًا>
 *
 * الخوارزمية: scrypt (N=16384, r=8, p=1, 64 بايت) مع salt عشوائي لكل كلمة مرور،
 * والمقارنة ثابتة الزمن. لا توجد أي بيانات دخول افتراضية في المستودع.
 */
import crypto from 'crypto';

function hash(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N, r, p });
  const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `scrypt$${N}$${r}$${p}$${b64(salt)}$${b64(derived)}`;
}

const password = process.argv[2] || '';

if (!password) {
  console.error('الاستخدام: npm run admin:password -- "كلمة المرور"');
  process.exit(1);
}
if (password.length < 12) {
  console.error('كلمة المرور قصيرة: استخدم 12 حرفًا على الأقل.');
  process.exit(1);
}

console.log('\nNEMO_ADMIN_USER=admin');
console.log(`NEMO_ADMIN_PASSWORD_HASH=${hash(password)}`);
console.log(`NEMO_ADMIN_SESSION_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
console.log('\nضع السطور الثلاثة في متغيّرات بيئة الاستضافة ثم أعد النشر. لا تُودع الناتج في Git.\n');
