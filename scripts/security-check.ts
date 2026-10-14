/**
 * Offline security gate.
 *
 * Complements `npm audit` (which needs registry access) with checks that must hold regardless of
 * the network: no package with a published advisory reachable from production code, no committed
 * secrets, and no unsafe runtime constructs.
 *
 *   node --import tsx scripts/security-check.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

interface Finding {
  rule: string;
  detail: string;
  file?: string;
}

const ROOT = process.cwd();
const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', '.cache', 'coverage', 'dist', 'docs']);

/** Packages with a published advisory, and the version range that is vulnerable. */
const KNOWN_VULNERABLE: Array<{ name: string; vulnerable: string; patched: string | null; advisory: string }> = [
  {
    name: 'braces',
    vulnerable: '<=3.0.3',
    patched: null, // no patched release exists as of 2026-10-14
    advisory: 'GHSA-vfj7-8cjw-p6xm — stack exhaustion via deeply nested patterns',
  },
  {
    name: 'micromatch',
    vulnerable: '<4.0.8',
    patched: '4.0.8',
    advisory: 'GHSA-952p-6rrq-rcjv — ReDoS in brace expansion',
  },
];

/** Serialisers whose output is safe to place inside a `<script>` tag. */
const SAFE_HTML_SERIALISERS = new Set(['serializeJsonLd']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isBelowBound(version: string, bound: string): boolean {
  const toTriple = (value: string) =>
    value.replace(/^[^0-9]*/, '').split(/[+.-]/).slice(0, 3).map((part) => parseInt(part, 10) || 0);
  const a = toTriple(version);
  const b = toTriple(bound);
  const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return bound.startsWith('<=') ? cmp <= 0 : cmp < 0;
}

function gitIgnores(candidate: string): boolean {
  try {
    return execSync(`git check-ignore ${candidate}`, { cwd: ROOT, encoding: 'utf-8' }).trim().length > 0;
  } catch {
    return false;
  }
}

function main() {
  const findings: Finding[] = [];
  const warnings: Finding[] = [];

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };

  // 1. No package with a known advisory may be a direct production dependency.
  const productionDeps = Object.keys(pkg.dependencies ?? {});
  for (const dep of productionDeps) {
    const hit = KNOWN_VULNERABLE.find((vuln) => vuln.name === dep);
    if (hit) findings.push({ rule: 'vulnerable_production_dependency', detail: `${dep} — ${hit.advisory}` });
  }

  // 2. No package with a known advisory may be reachable from the production tree at all.
  let prodTree: { dependencies?: Record<string, unknown> } = {};
  try {
    prodTree = JSON.parse(execSync('npm ls --omit=dev --all --json 2>/dev/null || true', { cwd: ROOT, encoding: 'utf-8' }));
  } catch {
    prodTree = {};
  }
  const prodPackages = JSON.stringify(prodTree.dependencies ?? {});
  for (const vuln of KNOWN_VULNERABLE) {
    if (new RegExp(`"${vuln.name}"\\s*:`).test(prodPackages)) {
      findings.push({
        rule: 'vulnerable_package_in_production_tree',
        detail: `${vuln.name} (${vuln.vulnerable}) is reachable from production dependencies — ${vuln.advisory}`,
      });
    }
  }

  // 3. The dev-only tooling chain must stay pinned, and a pin must not be older than a known fix.
  const overrides = pkg.overrides ?? {};
  for (const vuln of KNOWN_VULNERABLE) {
    const pinned = overrides[vuln.name];
    if (!pinned) {
      warnings.push({ rule: 'unpinned_vulnerable_dev_dependency', detail: `${vuln.name} has no override pin` });
      continue;
    }
    if (vuln.patched && isBelowBound(pinned, vuln.patched)) {
      findings.push({
        rule: 'override_still_vulnerable',
        detail: `${vuln.name}@${pinned} is still below the patched ${vuln.patched} — ${vuln.advisory}`,
      });
    }
    if (!vuln.patched) {
      warnings.push({
        rule: 'no_upstream_fix_available',
        detail: `${vuln.name}@${pinned} has no patched release (${vuln.advisory}); it is dev-only and pinned`,
      });
    }
  }

  // 4. Committed files must not contain secrets or unsafe constructs.
  const secretPatterns: Array<[string, RegExp]> = [
    ['aws_access_key_id', /\bAKIA[0-9A-Z]{16}\b/],
    ['github_token', /\bghp_[A-Za-z0-9]{30,}\b/],
    ['vercel_blob_token', /\bvercel_blob_rw_[A-Za-z0-9_-]{20,}\b/],
    ['private_key_block', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
    ['api_key_assignment', /\b(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/i],
  ];
  // Capture the injected expression instead of using a negative lookahead: the regex engine
  // backtracks around a lookahead placed after `\s*`, which makes it useless.
  const rawHtmlPattern = /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*([A-Za-z_$][\w$.]*)/g;
  const evalPattern = /(^|[^.\w])eval\s*\(/;
  const selfPath = path.join(ROOT, 'scripts/security-check.ts');

  for (const file of walk(ROOT)) {
    if (file === selfPath || file.endsWith('package-lock.json')) continue;
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf-8');

    for (const [rule, pattern] of secretPatterns) {
      if (pattern.test(text)) findings.push({ rule: `committed_secret:${rule}`, detail: rel, file: rel });
    }
    for (const match of text.matchAll(rawHtmlPattern)) {
      if (!SAFE_HTML_SERIALISERS.has(match[1])) {
        findings.push({
          rule: 'unsafe_construct:unescaped_html_injection',
          detail: `${rel} injects ${match[1]}() into raw HTML`,
          file: rel,
        });
      }
    }
    if (evalPattern.test(text)) {
      findings.push({ rule: 'unsafe_construct:eval_usage', detail: rel, file: rel });
    }
  }

  // 5. A local environment file must never be committed.
  if (fs.existsSync(path.join(ROOT, '.env.local')) && !gitIgnores('.env.local')) {
    findings.push({ rule: 'env_file_not_ignored', detail: '.env.local exists and is not ignored' });
  }

  const report = {
    checkedAt: new Date().toISOString(),
    ok: findings.length === 0,
    findings,
    warnings,
    checked: {
      productionDependencies: productionDeps,
      overrides,
      knownAdvisories: KNOWN_VULNERABLE.map((vuln) => ({
        name: vuln.name,
        range: vuln.vulnerable,
        patched: vuln.patched,
        advisory: vuln.advisory,
      })),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (findings.length > 0) process.exit(1);
}

main();
