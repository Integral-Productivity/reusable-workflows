// Pattern pack for the public-bundle privacy check (check.mjs). Layers follow
// the private-plugins plan: L1 secrets, L2 personal data, L3 Client names by
// hashed denylist, L4 internal locators, L5 confidential markers.
//
// Every pattern reports a fixed `detail` string. A finding never carries the
// matched text, so a report or a CI log cannot republish what it caught.

import { createHmac } from 'node:crypto';

export const SECRET_PATTERNS = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['anthropic-api-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['stripe-live-key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['1password-service-account-token', /\bops_[A-Za-z0-9]{40,}/],
];

// L2. Addresses that are safe to publish: documentation domains, GitHub's
// no-reply form, and role mailboxes. A personal address at the company domain
// still fails.
const SAFE_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$|\.(invalid|test|example|localhost)$/;
const ROLE_MAILBOXES = {
  'integralproductivity.com': ['opensource', 'devtools', 'support', 'hello', 'info', 'noreply', 'no-reply', 'security'],
  'anthropic.com': ['noreply'],
};
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const NOT_A_TLD = /\.(png|jpe?g|gif|svg|webp|ico)$/i;

export function personalEmailIn(line) {
  for (const m of line.matchAll(EMAIL)) {
    const [whole, domain] = m;
    const local = whole.slice(0, whole.indexOf('@')).toLowerCase();
    const d = domain.toLowerCase();
    if (NOT_A_TLD.test(d) || local === 'git') continue;
    if (SAFE_EMAIL_DOMAINS.test(d)) continue;
    if (ROLE_MAILBOXES[d]?.includes(local)) continue;
    return true;
  }
  return false;
}

const PHONE_PATTERNS = [
  /(?:^|[^\d\w.-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d\w])/,
  /(?:^|[^\d\w])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?![\d\w])/,
];

export function phoneIn(line) {
  return PHONE_PATTERNS.some((re) => {
    const m = line.match(re);
    return m && m[0].replace(/\D/g, '').length >= 10;
  });
}

// L4. Each locator names one account, folder, project or person.
const PLACEHOLDER_USERS = new Set(['runner', 'user', 'username', 'ubuntu', 'node', 'you', 'me', 'shared', 'name', 'your-name']);
const VERCEL_PUBLIC = new Set(['docs', 'blog', 'templates', 'guides', 'changelog', 'new', 'pricing', 'marketplace', 'integrations', 'kb', 'legal', 'login', 'signup', 'home', 'account', 'dashboard', 'contact', 'enterprise', 'customers', 'solutions', 'products', 'resources', 'security', 'help']);

export const LOCATOR_PATTERNS = [
  ['claude.ai connector ID in a tool name', () => /mcp__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i],
  ['Google Docs link', () => /\bdocs\.google\.com\/(?:document|spreadsheets|presentation|forms|drawings)\/d\//],
  ['Google Drive link', () => /\bdrive\.google\.com\/./],
  ['HubSpot portal or record link', () => /\bapp(?:-[a-z0-9]+)?\.hubspot\.com\/[\w-]+\/\d{5,}/],
  ['Supabase project URL', () => /\b[a-z0-9]{20}\.supabase\.co\b/],
];

function vercelProject(line) {
  for (const m of line.matchAll(/vercel\.com\/([\w-]+)\/[\w-]+/g)) if (!VERCEL_PUBLIC.has(m[1].toLowerCase())) return true;
  return false;
}

function homePath(line) {
  for (const m of line.matchAll(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z][\w.-]*)/g)) {
    if (!PLACEHOLDER_USERS.has(m[1].toLowerCase())) return true;
  }
  return false;
}

export function locatorsIn(line) {
  const found = LOCATOR_PATTERNS.filter(([, re]) => re().test(line)).map(([name]) => name);
  if (vercelProject(line)) found.push('Vercel project URL');
  if (homePath(line)) found.push('absolute path with a user name');
  return found;
}

export const CONFIDENTIAL_MARKERS = [
  /\bCONFIDENTIAL\b/,
  /\binternal[ -]only\b/i,
  /\bdo not (?:distribute|share externally|forward)\b/i,
  /\bnot for (?:distribution|external use)\b/i,
  /\bproprietary and confidential\b/i,
];

// L3. Names are compared as keyed hashes so the list never exists in clear
// text anywhere the check runs. Text is split into word tokens (camelCase and
// separators both split, accents folded), and every window of 1-3 tokens is
// hashed twice: words joined by one space, and words joined with nothing.
export function tokens(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

export const MAX_WORDS = 3;

export function hmac(key, s) {
  return createHmac('sha256', key).update(s).digest('hex');
}

export function windowHashes(text, key) {
  const t = tokens(text);
  const out = new Set();
  for (let i = 0; i < t.length; i++) {
    for (let n = 1; n <= MAX_WORDS && i + n <= t.length; n++) {
      const w = t.slice(i, i + n);
      out.add(hmac(key, w.join(' ')));
      out.add(hmac(key, w.join('')));
    }
  }
  return out;
}
