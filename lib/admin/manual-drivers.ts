import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeFileAtomic } from '../db/atomic-file';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  تخزين مستند الإدارة — طبقة «صريحة» تعرف بالضبط ما يبقى وما يضيع
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  لماذا طبقة تانية غير `lib/db/durable-store.ts`؟
 *  مخزن الموقع (`gateway-store.json`) يحفظ **نتيجة الجلب** من المصادر، وهو ملف
 *  محلي: على Vercel يسكن في `/tmp` الخاص بكل نسخة، فيضيع عند البرود ويختلف بين
 *  النسخ. وهذا مقبول للبيانات التي تُعاد جلبها تلقائيًا — لكنه **غير مقبول إطلاقًا**
 *  لتعديلات المدير: لو كتبنا فيها هناك، ستظهر للمستخدم دقائق ثم تختفي، وتُظهر
 *  اللوحة نجاحًا كاذبًا.
 *
 *  لذلك مستند الإدارة له درايفرات مستقلة، وكل درايفر يُعرّف عن نفسه بصدق:
 *    • `file`   — ملف `data/manual-content.json`. دائم على خادم عادي (VPS/دوكر)،
 *                 وغير دائم على Vercel (يُصنَّف غير دائم ويُعرض كذلك في اللوحة).
 *    • `github` — يُحفظ كإيداع (commit) في مستودع المشروع عبر GitHub Contents API.
 *                 هذا هو الخيار الدائم والمشترك على Vercel: لا ملفات مؤقتة، والبيانات
 *                 تعيش مع الكود، ويعود النشر التلقائي ليُثبّتها في الموقع كله.
 *    • `none`   — لا شيء مضبوط: القراءة تُرجع مستندًا فارغًا والكتابة **تُرفض برسالة
 *                 واضحة** ولا تُعلَن كنجاح.
 *
 *  لا يفشل أي درايفر بصمت: كل نتيجة تحمل `ok` و`messageAr`، واللوحة تعرضها كما هي.
 */

export type ManualDriverKind = 'file' | 'github' | 'none';

export interface ManualWriteResult {
  ok: boolean;
  /** رسالة عربية جاهزة للعرض في اللوحة. */
  messageAr: string;
  /** بصمة الإيداع/الملف عند النجاح (أو null). */
  ref: string | null;
  /** عدد البايتات المكتوبة. */
  bytes: number;
  at: string;
  /** متى تصبح البيانات ظاهرة لكل الزوار (فورًا / بعد إعادة النشر). */
  visibility: 'immediate' | 'after_redeploy';
}

export interface ManualReadResult {
  ok: boolean;
  raw: string | null;
  ref: string | null;
  messageAr: string;
  bytes: number;
}

export interface ManualDriver {
  readonly kind: ManualDriverKind;
  readonly labelAr: string;
  /**
   * هل قراءة هذا الدرايفر رخيصة (قرص محلي) أم مكلفة (نداء شبكة)؟
   * تُستخدم لتحديد سياسة إعادة القراءة: الرخيص يُقرأ في كل طلب ليظهر تعديل المدير فورًا،
   * والمكلف يُقرأ بفاصل زمني قصير معتمدًا على «مرآة» محلية عند وجودها.
   */
  readonly isCheapRead: boolean;
  /** يعيش بعد إعادة التشغيل ويُرى من كل النسخ. */
  isDurable(): boolean;
  /** يمكن الكتابة عليه فعلًا (مفتاح مضبوط / قرص قابل للكتابة). */
  isWritable(): boolean;
  describe(): {
    kind: ManualDriverKind;
    target: string;
    durable: boolean;
    writable: boolean;
    noteAr: string;
    requiredEnv: string[];
  };
  read(): Promise<ManualReadResult>;
  write(raw: string, options: { message: string; expectedRef: string | null }): Promise<ManualWriteResult>;
  /**
   * قراءة متزامنة من **المرآة المحلية** للمستند — تُستخدم في مسارات العرض العامة
   * (صفحة المباراة/خريطة الموقع) التي تُبنى دوالّها متزامنة. ليست بديلًا عن القراءة
   * الأصلية: هي فقط تضمن ألّا تظهر الصفحة بلا بيانات الإدارة بينما القراءة الشبكية
   * الدائمة تتم في الخلفية. ولا تُخفي أي خطأ: الفشل هنا يعني «لا مرآة بعد» فقط.
   */
  readSync?(): ManualReadResult | null;
}

/** المسار الافتراضي للملف المحلي. */
export function resolveManualFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const overrideDir = (env.NEMO_DATA_DIR || '').trim();
  if (overrideDir) return path.join(overrideDir, 'manual-content.json');
  // نفس قاعدة المخزن الأساسي: على بيئات بلا قرص دائم نستخدم مجلدًا مؤقتًا ونُعلن ذلك.
  const serverless = Boolean(
    env.VERCEL || env.VERCEL_ENV || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY || env.CF_PAGES
  );
  if (serverless) return path.join(os.tmpdir(), 'nemo-gateway', 'manual-content.json');
  return path.join(process.cwd(), 'data', 'manual-content.json');
}

function isServerless(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.VERCEL || env.VERCEL_ENV || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY || env.CF_PAGES || env.FUNCTIONS_WORKER_RUNTIME
  );
}

/** درايفر الملف المحلي. */
class FileManualDriver implements ManualDriver {
  readonly kind = 'file' as const;
  readonly isCheapRead = true;
  readonly labelAr = 'ملف محلي (data/manual-content.json)';
  private readonly file: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env, file?: string) {
    this.env = env;
    this.file = file || resolveManualFilePath(env);
  }

  isDurable(): boolean {
    if ((this.env.NEMO_MANUAL_FILE_DURABLE || '').trim().toLowerCase() === 'true') return true;
    return !isServerless(this.env);
  }

  isWritable(): boolean {
    return (this.env.NEMO_MANUAL_WRITE || '').trim().toLowerCase() !== 'off';
  }

  describe() {
    return {
      kind: this.kind,
      target: this.file,
      durable: this.isDurable(),
      writable: this.isWritable(),
      noteAr: this.isDurable()
        ? 'ملف JSON على قرص هذا الخادم — يبقى بعد إعادة التشغيل وهو المصدر الذي يقرأه الموقع.'
        : 'مجلد مؤقت على بيئة بلا قرص دائم: التعديل يعمل الآن لكنه لا يصل لكل النسخ ولا يبقى بعد البرود. اضبط GITHUB_TOKEN ليُحفظ المستند في المستودع بدلًا من ذلك.',
      requiredEnv: this.isDurable() ? [] : ['GITHUB_TOKEN', 'GITHUB_REPO'],
    };
  }

  readSync(): ManualReadResult | null {
    try {
      if (!fs.existsSync(this.file)) return null;
      const raw = fs.readFileSync(this.file, 'utf-8');
      return {
        ok: true,
        raw,
        ref: String(fs.statSync(this.file).mtimeMs),
        messageAr: 'قُرئ مستند الإدارة من القرص (متزامن).',
        bytes: Buffer.byteLength(raw, 'utf-8'),
      };
    } catch {
      return null;
    }
  }

  async read(): Promise<ManualReadResult> {
    try {
      if (!fs.existsSync(this.file)) {
        return { ok: true, raw: null, ref: null, messageAr: 'لا يوجد مستند إدارة بعد — سيُنشأ عند أول حفظ.', bytes: 0 };
      }
      const raw = fs.readFileSync(this.file, 'utf-8');
      return {
        ok: true,
        raw,
        ref: String(fs.statSync(this.file).mtimeMs),
        messageAr: 'قُرئ مستند الإدارة من القرص.',
        bytes: Buffer.byteLength(raw, 'utf-8'),
      };
    } catch (error) {
      return {
        ok: false,
        raw: null,
        ref: null,
        messageAr: `تعذّرت قراءة ملف الإدارة: ${error instanceof Error ? error.message.slice(0, 120) : 'خطأ غير معروف'}`,
        bytes: 0,
      };
    }
  }

  async write(raw: string): Promise<ManualWriteResult> {
    const at = new Date().toISOString();
    if (!this.isWritable()) {
      return {
        ok: false,
        messageAr: 'الكتابة معطّلة عبر NEMO_MANUAL_WRITE=off.',
        ref: null,
        bytes: 0,
        at,
        visibility: 'immediate',
      };
    }
    try {
      writeFileAtomic(this.file, raw);
      return {
        ok: true,
        messageAr: 'حُفظ المستند في ملف الإدارة على هذا الخادم.',
        ref: String(fs.statSync(this.file).mtimeMs),
        bytes: Buffer.byteLength(raw, 'utf-8'),
        at,
        visibility: 'immediate',
      };
    } catch (error) {
      return {
        ok: false,
        messageAr: `تعذّر حفظ مستند الإدارة: ${error instanceof Error ? error.message.slice(0, 160) : 'خطأ غير معروف'}`,
        ref: null,
        bytes: 0,
        at,
        visibility: 'immediate',
      };
    }
  }
}

export interface GithubDriverConfig {
  token: string;
  repo: string;
  branch: string;
  filePath: string;
  apiBaseUrl: string;
}

/** يقرأ إعداد درايفر GitHub من البيئة، أو null عند نقص أي مفتاح إلزامي. */
export function resolveGithubConfig(env: NodeJS.ProcessEnv = process.env): GithubDriverConfig | null {
  const token = (env.GITHUB_TOKEN || env.NEMO_GITHUB_TOKEN || '').trim();
  const repo = (env.GITHUB_REPO || '').trim();
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return {
    token,
    repo,
    branch: (env.GITHUB_BRANCH || 'main').trim() || 'main',
    filePath: (env.NEMO_MANUAL_FILE_PATH || 'data/manual-content.json').trim(),
    apiBaseUrl: (env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/$/, ''),
  };
}

/**
 * درايفر GitHub — التخزين الدائم على بيئة الاستضافة.
 *
 * الكتابة = إيداع ملف `data/manual-content.json` في الفرع الذي يُنشر منه الموقع.
 * لهذا:
 *   • التعديل يبقى ويراه كل نسخة من الموقع (لا /tmp مؤقت).
 *   • كل نسخة احتياطية = تاريخ الإيداعات مجانًا وبلا أي خدمة إضافية.
 *   • بعد النشر التلقائي يصبح المستند جزءًا من البناء لا قراءة شبكة.
 * ونقرأ عبر Contents API بنفس المسار، فيعمل كل شيء بلا إعداد إضافي.
 */
class GithubManualDriver implements ManualDriver {
  readonly isCheapRead = false;
  readonly kind = 'github' as const;
  readonly labelAr = 'مستودع GitHub (إيداع دائم + سجل نسخ)';
  private readonly config: GithubDriverConfig;

  constructor(config: GithubDriverConfig) {
    this.config = config;
  }

  /**
   * نسخة محلية من آخر مستند مقروء/مكتوب. الغرض منها أداء الصفحات العامة: العرض يستخدم
   * آخر مستند معروف بدل انتظار نداء شبكة، والقراءة الدائمة تتم في الخلفية.
   */
  private mirrorFile(): string {
    return resolveManualFilePath();
  }

  private writeMirror(raw: string): void {
    try {
      writeFileAtomic(this.mirrorFile(), raw);
    } catch {
      // فشل المرآة لا يفشل الحفظ في المستودع — وهي المصدر الحقيقي.
    }
  }

  readSync(): ManualReadResult | null {
    try {
      const file = this.mirrorFile();
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, 'utf-8');
      return {
        ok: true,
        raw,
        ref: null,
        messageAr: 'قُرئ مستند الإدارة من المرآة المحلية (القراءة الدائمة من المستودع تتم في الخلفية).',
        bytes: Buffer.byteLength(raw, 'utf-8'),
      };
    } catch {
      return null;
    }
  }

  isDurable(): boolean {
    return true;
  }

  isWritable(): boolean {
    return true;
  }

  describe() {
    return {
      kind: this.kind,
      target: `${this.config.repo}@${this.config.branch}:${this.config.filePath}`,
      durable: true,
      writable: true,
      noteAr: 'كل تعديل يُودَع في المستودع، فيبقى ويراه كل الزوار بعد إعادة النشر التلقائي، ويعود تاريخ الإيداعات بمثابة نسخ احتياطية.',
      requiredEnv: ['GITHUB_TOKEN', 'GITHUB_REPO'],
    };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nemo-live-kora-admin',
    };
  }

  private contentsUrl(): string {
    const { apiBaseUrl, repo, filePath } = this.config;
    return `${apiBaseUrl}/repos/${repo}/contents/${encodeURI(filePath)}`;
  }

  async read(): Promise<ManualReadResult> {
    try {
      const response = await fetch(`${this.contentsUrl()}?ref=${encodeURIComponent(this.config.branch)}`, {
        headers: this.headers(),
        cache: 'no-store',
      });
      if (response.status === 404) {
        return {
          ok: true,
          raw: null,
          ref: null,
          messageAr: 'لا يوجد مستند إدارة في المستودع بعد — سيُنشأ عند أول حفظ.',
          bytes: 0,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          raw: null,
          ref: null,
          messageAr: `فشل قراءة المستند من GitHub (HTTP ${response.status}). تحقّق من صلاحية GITHUB_TOKEN ومطابقة GITHUB_REPO.`,
          bytes: 0,
        };
      }
      const payload = (await response.json()) as { content?: string; sha?: string; encoding?: string };
      const raw = payload.content
        ? Buffer.from(payload.content, (payload.encoding as BufferEncoding) || 'base64').toString('utf-8')
        : null;
      if (raw) this.writeMirror(raw);
      return {
        ok: true,
        raw,
        ref: payload.sha || null,
        messageAr: 'قُرئ مستند الإدارة من المستودع.',
        bytes: raw ? Buffer.byteLength(raw, 'utf-8') : 0,
      };
    } catch (error) {
      return {
        ok: false,
        raw: null,
        ref: null,
        messageAr: `تعذّر الوصول إلى GitHub: ${error instanceof Error ? error.message.slice(0, 140) : 'خطأ شبكة'}`,
        bytes: 0,
      };
    }
  }

  async write(raw: string, options: { message: string; expectedRef: string | null }): Promise<ManualWriteResult> {
    const at = new Date().toISOString();
    try {
      const response = await fetch(this.contentsUrl(), {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: options.message,
          content: Buffer.from(raw, 'utf-8').toString('base64'),
          branch: this.config.branch,
          // sha الحالي إلزامي للتحديث: لو تغيّر من جهة أخرى يفشل الطلب بدل محو تعديل غيرك.
          ...(options.expectedRef ? { sha: options.expectedRef } : {}),
        }),
      });
      if (!response.ok) {
        const details = await response.text().catch(() => '');
        const conflict = response.status === 409 || response.status === 422;
        return {
          ok: false,
          messageAr: conflict
            ? 'تعارض في الكتابة: عُدِّل المستند من جهة أخرى بعد قراءته. أعِد تحميل اللوحة ثم أعد المحاولة (لم يُفقد شيء).'
            : `فشل الحفظ في GitHub (HTTP ${response.status}). ${details.slice(0, 160)}`,
          ref: null,
          bytes: 0,
          at,
          visibility: 'after_redeploy',
        };
      }
      const payload = (await response.json()) as { content?: { sha?: string }; commit?: { sha?: string } };
      this.writeMirror(raw);
      return {
        ok: true,
        messageAr: 'حُفظ المستند كإيداع في المستودع، وسيُنشر للموقع كله مع إعادة النشر التلقائي.',
        ref: payload.content?.sha || payload.commit?.sha || null,
        bytes: Buffer.byteLength(raw, 'utf-8'),
        at,
        visibility: 'after_redeploy',
      };
    } catch (error) {
      return {
        ok: false,
        messageAr: `تعذّر الحفظ في GitHub: ${error instanceof Error ? error.message.slice(0, 140) : 'خطأ شبكة'}`,
        ref: null,
        bytes: 0,
        at,
        visibility: 'after_redeploy',
      };
    }
  }
}

/** لا شيء مضبوط: نُعلنها بوضوح بدل إعلان نجاح وهمي. */
class NoopManualDriver implements ManualDriver {
  readonly isCheapRead = true;
  readonly kind = 'none' as const;
  readonly labelAr = 'لا يوجد تخزين إدارة مضبوط';
  isDurable(): boolean {
    return false;
  }
  isWritable(): boolean {
    return false;
  }
  describe() {
    return {
      kind: this.kind,
      target: '—',
      durable: false,
      writable: false,
      noteAr:
        'لا يوجد تخزين دائم لتعديلات الإدارة. على Vercel اضبط GITHUB_TOKEN وGITHUB_REPO ليُحفظ كل تعديل كإيداع في المستودع. حتى ذلك الحين يرفض الخادم عمليات الحفظ بدل إيهامك بأنها نجحت.',
      requiredEnv: ['GITHUB_TOKEN', 'GITHUB_REPO'],
    };
  }
  async read(): Promise<ManualReadResult> {
    return { ok: true, raw: null, ref: null, messageAr: 'لا يوجد تخزين إدارة مضبوط.', bytes: 0 };
  }
  async write(): Promise<ManualWriteResult> {
    return {
      ok: false,
      messageAr:
        'لا يوجد تخزين دائم لتعديلات الإدارة: اضبط GITHUB_TOKEN وGITHUB_REPO على الاستضافة ثم أعد المحاولة.',
      ref: null,
      bytes: 0,
      at: new Date().toISOString(),
      visibility: 'after_redeploy',
    };
  }
}

export interface ManualDriverChoice {
  driver: ManualDriver;
  /** سبب الاختيار كما يُعرض للمشغّل. */
  reasonAr: string;
}

/**
 * اختيار الدرايفر: GitHub إن كان مضبوطًا (لأنه الدائم المشترك)، وإلا الملف المحلي.
 * لا يختار GitHub أبدًا بلا مفتاح صالح، ولا يدّعي ديمومة في بيئة بلا قرص.
 */
export function selectManualDriver(env: NodeJS.ProcessEnv = process.env): ManualDriverChoice {
  const github = resolveGithubConfig(env);
  const preferLocal = (env.NEMO_MANUAL_DRIVER || '').trim().toLowerCase() === 'file';
  if (github && !preferLocal) {
    return {
      driver: new GithubManualDriver(github),
      reasonAr: `التخزين الدائم المفعّل: إيداعات المستودع ${github.repo}@${github.branch} (${github.filePath}).`,
    };
  }
  const file = new FileManualDriver(env);
  if (file.isDurable() || !github) {
    return {
      driver: file,
      reasonAr: file.isDurable()
        ? `تخزين ملف محلي دائم على هذا الخادم (${file.describe().target}).`
        : 'لا تخزين دائم مضبوط: القرص في هذه البيئة مؤقت، والكتابة تعمل للعرض الفوري فقط ولا تبقى. اضبط GITHUB_TOKEN وGITHUB_REPO.',
    };
  }
  return { driver: new NoopManualDriver(), reasonAr: new NoopManualDriver().describe().noteAr };
}

/** يُستخدم في الاختبارات: درايفر في الذاكرة بلا ملفات ولا شبكة. */
export class MemoryManualDriver implements ManualDriver {
  readonly isCheapRead = true;
  readonly kind = 'file' as const;
  readonly labelAr = 'ذاكرة (اختبار)';
  private raw: string | null = null;
  private ref = 0;
  isDurable(): boolean {
    return true;
  }
  isWritable(): boolean {
    return true;
  }
  describe() {
    return {
      kind: this.kind,
      target: 'memory://manual',
      durable: true,
      writable: true,
      noteAr: 'درايفر اختبار.',
      requiredEnv: [],
    };
  }
  async read(): Promise<ManualReadResult> {
    return {
      ok: true,
      raw: this.raw,
      ref: this.raw ? String(this.ref) : null,
      messageAr: 'قُرئ من الذاكرة.',
      bytes: this.raw ? Buffer.byteLength(this.raw, 'utf-8') : 0,
    };
  }
  async write(raw: string): Promise<ManualWriteResult> {
    this.raw = raw;
    this.ref += 1;
    return {
      ok: true,
      messageAr: 'حُفظ في الذاكرة.',
      ref: String(this.ref),
      bytes: Buffer.byteLength(raw, 'utf-8'),
      at: new Date().toISOString(),
      visibility: 'immediate',
    };
  }
}
