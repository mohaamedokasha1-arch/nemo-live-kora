import {
  AUDIT_LOG_LIMIT,
  AdminRole,
  AuditEntry,
  MANUAL_DOCUMENT_SCHEMA,
  ManualDocument,
  ManualMatchRecord,
  ManualNewsRecord,
  ManualOverride,
  ManualSiteSettings,
  SourceControl,
  createId,
  emptyManualDocument,
  normalizeManualDocument,
} from './manual-document';
import {
  ManualDriver,
  ManualDriverChoice,
  ManualReadResult,
  ManualWriteResult,
  selectManualDriver,
} from './manual-drivers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  مخزن مستند الإدارة — قراءة/كتابة متسلسلة مع كشف التعارض وسجل تدقيق
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  كل عملية كتابة تمرّ من هنا (لا كتابة مباشرة من أي مسار API)، ولذلك:
 *   • تُطبَّق التعديلات على نسخة واحدة داخل العملية (serialized) فلا يضيع تعديلان متزامنان.
 *   • تُكتب بالكامل أو لا تُكتب: أي خطأ يُبقي المستند السابق كما هو.
 *   • كل تغيير يترك سطرًا في سجل التدقيق باسم الفاعل ووقته.
 *   • `revision` يزداد مع كل كتابة، ويُقارَن قبل الكتابة على المستودع لكشف التعارض.
 */

export interface ManualStateStatus {
  configured: boolean;
  durable: boolean;
  writable: boolean;
  driver: string;
  labelAr: string;
  target: string;
  noteAr: string;
  reasonAr: string;
  requiredEnv: string[];
  /** آخر تحميل ناجح من التخزين. */
  loadedAt: string | null;
  lastError: string | null;
  revision: number;
  visibility: 'immediate' | 'after_redeploy';
  /** مصدر المستند الحالي: التخزين، أو نسخة افتراضية في الذاكرة. */
  origin: 'durable' | 'default';
}

interface ManualRuntime {
  document: ManualDocument;
  ref: string | null;
  loadedAt: string | null;
  lastError: string | null;
  origin: 'durable' | 'default';
  /** وعد الكتابة الجارية — يمنع تداخل عمليتين. */
  queue: Promise<unknown>;
  override: ManualDriverChoice | null;
}

let runtime: ManualRuntime = {
  document: emptyManualDocument(),
  ref: null,
  loadedAt: null,
  lastError: null,
  origin: 'default',
  queue: Promise.resolve(),
  override: null,
};

/** آخر لحظة فحصنا فيها مرجع التخزين (لتقليل `statSync` في الحلقات المتكررة). */
let syncCheckAt = 0;
/** أقل مدة بين فحصين متتاليين لمرجع التخزين في المسار المتزامن. */
const SYNC_RECHECK_MS = 150;

/** اختيار الدرايفر الفعلي (قابل للتجاوز في الاختبارات). */
export function getManualDriverChoice(): ManualDriverChoice {
  if (runtime.override) return runtime.override;
  return selectManualDriver();
}

export function getManualDriver(): ManualDriver {
  return getManualDriverChoice().driver;
}

/** أقل مدة بين قراءتين غير متزامنتين من تخزين بعيد (GitHub) — لتقليل النداءات. */
const REMOTE_RECHECK_MS = 4000;
/** آخر لحظة قرأنا فيها من تخزين بعيد. */
let remoteReadAt = 0;

/** تبديل الدرايفر — للاختبارات وللأدوات المحلية فقط. */
export function setManualDriverForTesting(choice: ManualDriverChoice | null): void {
  runtime.override = choice;
  runtime.loadedAt = null;
  runtime.origin = 'default';
  runtime.ref = null;
  runtime.document = emptyManualDocument();
}

/**
 * يقرأ المستند من التخزين. يُنادى في `hydrateStore()` وفي كل صفحة إدارة، وهو
 * سريع لأن النتيجة تُخزَّن في الذاكرة بعد أول تحميل. `force` يعيد القراءة.
 */
export async function loadManualDocument(force = false): Promise<ManualDocument> {
  const driver = getManualDriver();
  /**
   * سياسة إعادة القراءة:
   *  • درايفر القرص: يُقرأ في كل نداء — التكلفة `statSync`+`readFileSync` لملف صغير،
   *    والمقابل أن تعديل المدير يظهر على الموقع في الطلب التالي بلا إعادة نشر.
   *    (كانت القراءة مرة واحدة لكل عملية، وهي علّة حقيقية ظهرت: خبر يُنشر من اللوحة
   *    لا يظهر على الموقع حتى إعادة التشغيل.)
   *  • درايفر بعيد (GitHub): يُقرأ بفاصل قصير، وتكفي المرآة المحلية بين القراءتين.
   */
  if (runtime.loadedAt && !force) {
    if (!driver.isCheapRead && Date.now() - remoteReadAt < REMOTE_RECHECK_MS) return runtime.document;
  }
  remoteReadAt = Date.now();
  const result = await driver.read();
  if (!result.ok) {
    runtime.lastError = result.messageAr;
    // لا نُفرغ المستند الحالي عند فشل القراءة: البيانات السابقة أفضل من لا شيء.
    if (!runtime.loadedAt) {
      runtime.document = emptyManualDocument();
      runtime.origin = 'default';
    }
    return runtime.document;
  }
  if (result.raw) {
    try {
      runtime.document = normalizeManualDocument(JSON.parse(result.raw));
      runtime.origin = 'durable';
    } catch {
      runtime.lastError = 'مستند الإدارة في التخزين غير صالح (JSON غير مقروء) — لم يُستخدم، والنسخة السابقة محفوظة.';
      if (!runtime.loadedAt) {
        runtime.document = emptyManualDocument();
        runtime.origin = 'default';
      }
      return runtime.document;
    }
  } else {
    runtime.document = emptyManualDocument();
    runtime.origin = 'default';
  }
  runtime.ref = result.ref;
  runtime.loadedAt = new Date().toISOString();
  runtime.lastError = null;
  return runtime.document;
}

/**
 * تحميل متزامن من المرآة المحلية عند أول قراءة.
 *
 * السبب: دوال عرض الموقع العامة (`resolveMatchView`, خريطة الموقع، الصور المُولَّدة)
 * متزامنة، ولا يمكن انتظار نداء شبكة داخلها. فإن لم يكن المستند محمّلًا بعد نقرأ
 * المرآة المحلية فورًا، ويبقى `loadManualDocument()` هو المسار الكامل الذي يُحدّثها من
 * التخزين الدائم. وإن لم توجد مرآة (أول تشغيل على نسخة جديدة) نُكمل بالمستند الفارغ
 * بدل تعطيل الصفحة، وتُحمَّل البيانات فورًا في أول مسار غير متزامن.
 */
function ensureLoadedSync(): void {
  const driver = getManualDriver();
  let result: ManualReadResult | null = null;
  const neverLoaded = !runtime.loadedAt;
  /**
   * القراءة المتزامنة تعمل دائمًا — لا مرة واحدة فقط.
   * السبب تجربة حقيقية: الصفحات العامة كانت تُبنى بمستند فارغ محفوظ في ذاكرة الوحدة
   * (Webpack يعطي كل صفحة/مسار نسخة مستقلة من الوحدة)، فخبر يُنشر من اللوحة لا يظهر على
   * الموقع حتى إعادة النشر. الآن نقارن مرجع التخزين (mtime للملف أو sha الإيداع) ونُعيد
   * التحميل عند أي تغيّر. هذا يكلّف `statSync` واحدًا لكل قراءة، وهو أرخص بكثير من خطأ
   * «النشر لا يعمل» على المدير.
   */
  if (!neverLoaded && Date.now() - syncCheckAt < SYNC_RECHECK_MS && runtime.ref) return;
  syncCheckAt = Date.now();
  try {
    result = driver.readSync ? driver.readSync() : null;
  } catch {
    result = null;
  }
  if (!result || !result.ok || !result.raw) return;
  const nextRef = result.ref ?? null;
  if (!neverLoaded && nextRef !== null && nextRef === runtime.ref) return;
  try {
    const parsed = normalizeManualDocument(JSON.parse(result.raw));
    runtime.document = parsed;
    runtime.ref = nextRef ?? runtime.ref;
    runtime.origin = 'durable';
    runtime.loadedAt = new Date().toISOString();
  } catch {
    // مرآة تالفة: لا نعتمدها ولا نمسح المستند الحالي.
  }
}

/** المستند الحالي (نسخة للقراءة — لا تُعدَّل خارج هذا الملف). */
export function getManualDocument(): ManualDocument {
  ensureLoadedSync();
  return runtime.document;
}

/**
 * إعادة قراءة متزامنة عند تغيّر مرجع التخزين (mtime الملف / sha الإيداع).
 * تُستخدم في مسارات القراءة المتزامنة (كتالوج الموقع، خريطة الموقع، الصور) التي لا
 * تستطيع الانتظار.
 */
export function refreshManualDocumentSync(): boolean {
  const before = runtime.ref;
  ensureLoadedSync();
  return runtime.ref !== before;
}

export function getManualStatus(): ManualStateStatus {
  const choice = getManualDriverChoice();
  const driver = choice.driver;
  const description = driver.describe();
  return {
    configured: driver.kind !== 'none',
    durable: driver.isDurable(),
    writable: driver.isWritable(),
    driver: driver.kind,
    labelAr: driver.labelAr,
    target: description.target,
    noteAr: description.noteAr,
    reasonAr: choice.reasonAr,
    requiredEnv: description.requiredEnv,
    loadedAt: runtime.loadedAt,
    lastError: runtime.lastError,
    revision: runtime.document.revision,
    visibility: driver.kind === 'github' ? 'after_redeploy' : 'immediate',
    origin: runtime.origin,
  };
}

export interface ManualMutationContext {
  actor: string;
  role: AdminRole;
  action: string;
  target: string;
  summaryAr: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface ManualMutationResult<T> {
  ok: boolean;
  messageAr: string;
  data: T | null;
  write: ManualWriteResult | null;
}

/**
 * ينفّذ تعديلًا على المستند ثم يحفظه. `mutate` تُعدّل مسودة منسوخة، فإن نجح الحفظ
 * اعتُمدت النتيجة، وإن فشل بقي المستند السابق كما هو (بلا حالة جزئية).
 */
export async function mutateManualDocument<T>(
  context: ManualMutationContext,
  mutate: (draft: ManualDocument) => { data: T; changed: boolean; messageAr: string }
): Promise<ManualMutationResult<T>> {
  const run = async (): Promise<ManualMutationResult<T>> => {
    const driver = getManualDriver();
    if (!driver.isWritable()) {
      return {
        ok: false,
        messageAr:
          'لا يوجد تخزين دائم لتعديلات الإدارة على هذه البيئة. اضبط GITHUB_TOKEN وGITHUB_REPO (أو NEMO_DATA_DIR على خادم بقرص دائم) ثم أعد المحاولة. لم يُحفظ أي شيء.',
        data: null,
        write: null,
      };
    }

    await loadManualDocument();
    const draft: ManualDocument = structuredClone(runtime.document);
    const outcome = mutate(draft);
    if (!outcome.changed) {
      return { ok: true, messageAr: outcome.messageAr, data: outcome.data, write: null };
    }

    draft.schemaVersion = MANUAL_DOCUMENT_SCHEMA;
    draft.revision = runtime.document.revision + 1;
    draft.updatedAt = new Date().toISOString();
    draft.updatedBy = context.actor;
    draft.audit = appendAudit(draft.audit, context, true, draft.updatedAt);

    const raw = JSON.stringify(draft, null, 2);
    const write = await driver.write(raw, {
      message: `admin(${context.role}): ${context.action} — ${context.summaryAr}`.slice(0, 180),
      expectedRef: runtime.ref,
    });

    if (!write.ok) {
      return {
        ok: false,
        messageAr: write.messageAr,
        data: null,
        write,
      };
    }

    runtime.document = draft;
    runtime.ref = write.ref ?? runtime.ref;
    runtime.loadedAt = write.at;
    runtime.origin = 'durable';
    runtime.lastError = null;
    return { ok: true, messageAr: `${outcome.messageAr} — ${write.messageAr}`, data: outcome.data, write };
  };

  // تسلسل العمليات: كل تعديل ينتظر الذي قبله، فلا يكتب تعديل فوق آخر بلا علمه.
  const chained = runtime.queue.then(run, run);
  runtime.queue = chained.catch(() => undefined);
  return chained;
}

/** يسجّل عملية إدارية فاشلة أو قراءةً حساسة (بلا تغيير في المستند). */
export function noteAudit(
  context: ManualMutationContext,
  ok: boolean,
  extra?: Partial<AuditEntry>
): AuditEntry {
  return {
    id: createId('audit'),
    at: new Date().toISOString(),
    actor: context.actor,
    role: context.role,
    action: context.action,
    target: context.target,
    summaryAr: context.summaryAr,
    ok,
    details: { ...(context.details || {}), ...(extra?.details || {}) },
  };
}

function appendAudit(
  log: AuditEntry[],
  context: ManualMutationContext,
  ok: boolean,
  at: string
): AuditEntry[] {
  const entry: AuditEntry = {
    id: createId('audit'),
    at,
    actor: context.actor,
    role: context.role,
    action: context.action,
    target: context.target,
    summaryAr: context.summaryAr,
    ok,
    details: context.details,
  };
  const next = [entry, ...log];
  return next.length > AUDIT_LOG_LIMIT ? next.slice(0, AUDIT_LOG_LIMIT) : next;
}

/**
 * يعيد كتابة مستند كامل (يُستخدم في الاستعادة من نسخة احتياطية).
 * دالة منفصلة لتوضيح أن الاستعادة عملية كاملة لا تعديل حقل.
 */
export async function replaceManualDocument(
  context: ManualMutationContext,
  next: ManualDocument
): Promise<ManualMutationResult<ManualDocument>> {
  const driver = getManualDriver();
  if (!driver.isWritable()) {
    return {
      ok: false,
      messageAr:
        'لا يوجد تخزين دائم لتعديلات الإدارة على هذه البيئة، فلا يمكن الاستعادة. اضبط GITHUB_TOKEN وGITHUB_REPO أولًا.',
      data: null,
      write: null,
    };
  }
  await loadManualDocument();
  const draft = normalizeManualDocument(next);
  draft.revision = runtime.document.revision + 1;
  draft.updatedAt = new Date().toISOString();
  draft.updatedBy = context.actor;
  draft.audit = appendAudit(draft.audit, context, true, draft.updatedAt);
  const raw = JSON.stringify(draft, null, 2);
  const write = await driver.write(raw, {
    message: `admin(restore): ${context.summaryAr}`.slice(0, 180),
    expectedRef: runtime.ref,
  });
  if (!write.ok) return { ok: false, messageAr: write.messageAr, data: null, write };
  runtime.document = draft;
  runtime.ref = write.ref ?? runtime.ref;
  runtime.loadedAt = write.at;
  runtime.origin = 'durable';
  return { ok: true, messageAr: write.messageAr, data: draft, write };
}

/** يُصفّر الذاكرة — للاختبارات. */
export function resetManualRuntimeForTests(): void {
  runtime = {
    document: emptyManualDocument(),
    ref: null,
    loadedAt: null,
    lastError: null,
    origin: 'default',
    queue: Promise.resolve(),
    override: null,
  };
}

/** يعيد المستند كاملًا بصيغة قابلة للتنزيل/النسخ الاحتياطي. */
export function serializeManualDocument(document: ManualDocument = runtime.document): string {
  return JSON.stringify(document, null, 2);
}

// ── أدوات قراءة سريعة تُستخدم في مسارات الموقع العامة (متزامنة دومًا) ─────────

/** المباريات اليدوية المنشورة. */
export function listManualMatches(): ManualMatchRecord[] {
  ensureLoadedSync();
  return runtime.document.matches;
}

/** مباراة يدوية بمعرّفها. */
export function findManualMatch(id: string | null | undefined): ManualMatchRecord | null {
  ensureLoadedSync();
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  return runtime.document.matches.find((item) => item.id.toLowerCase() === normalized) ?? null;
}

/** التجاوزات المفهرسة بمعرّف المباراة. */
export function getManualOverrides(): ManualOverride[] {
  ensureLoadedSync();
  return runtime.document.overrides;
}

export function findManualOverride(matchId: string | null | undefined): ManualOverride | null {
  ensureLoadedSync();
  if (!matchId) return null;
  return runtime.document.overrides.find((item) => item.matchId === matchId) ?? null;
}

/** الأخبار التي كتبها المدير وتُعرض كأي خبر آخر. */
export function listManualNews(): ManualNewsRecord[] {
  ensureLoadedSync();
  return runtime.document.news;
}

/** إعدادات الموقع الفعلية (مع قيم افتراضية آمنة إن لم يُحمَّل المستند). */
export function getSiteSettings(): ManualSiteSettings {
  ensureLoadedSync();
  return runtime.document.settings;
}

/** تحكّم مصدر واحد، أو الافتراضي (مفعّل) إن لم يُضبط. */
export function getSourceControl(sourceId: string): SourceControl {
  ensureLoadedSync();
  const found = runtime.document.sourceControls[sourceId as keyof typeof runtime.document.sourceControls];
  return (
    found ?? {
      enabled: true,
      priority: 0,
      noteAr: null,
      updatedAt: runtime.document.updatedAt,
      updatedBy: 'system',
    }
  );
}

/** كل تحكّمات المصادر مفهرسة بالمعرّف. */
export function getAllSourceControls(): Record<string, SourceControl> {
  ensureLoadedSync();
  const result: Record<string, SourceControl> = {};
  for (const [id, control] of Object.entries(runtime.document.sourceControls)) {
    if (control) result[id] = control;
  }
  return result;
}

/** هل المصدر مفعّل؟ (الافتراضي نعم — فلا يتغيّر سلوك الموقع بلا قرار إداري). */
export function isSourceEnabled(sourceId: string): boolean {
  ensureLoadedSync();
  return getSourceControl(sourceId).enabled !== false;
}

/** هل انتهت صلاحية بيانات هذا المصدر بحسب إعداد «التقادم»؟ */
export function isSourceStale(
  sourceId: string,
  lastSuccessfulDataAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  const hours = getSiteSettings().staleSourceWarningHours;
  if (!lastSuccessfulDataAt) return true;
  const at = Date.parse(lastSuccessfulDataAt);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > hours * 60 * 60 * 1000;
}
