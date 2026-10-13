/**
 * أدوات مشتركة لإخراج JSON-LD داخل وسم <script> بشكل آمن.
 */

/**
 * JSON-LD يُحقن داخل وسم <script>، لذلك يجب تهريب الأحرف ذات الدلالة في HTML
 * لمنع كسر الوسم أو حقن سكربت.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
