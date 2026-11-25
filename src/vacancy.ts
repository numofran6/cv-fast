import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as cheerio from 'cheerio';
import type { Vacancy } from './schemas.ts';

function isPublicAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
    return !(lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') ||
      lower.startsWith('2001:db8:'));
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
}

async function assertAllowed(url: URL): Promise<void> {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('Vacancy URL must be standard HTTPS.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) throw new Error('Local/private job URL blocked.');
  if (isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) throw new Error('Private network URL blocked.');
  } else {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error('URL resolves to a private network.');
  }
}

export async function loadVacancy(url?: string, file?: string): Promise<Vacancy> {
  if (!url && !file) throw new Error('Provide --url or --file.');
  if (url) {
    try {
      let current = new URL(url);
      for (let redirect = 0; redirect < 4; redirect++) {
        await assertAllowed(current);
        const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'CVWorkflowAgent/0.1 (candidate CV preparation)' } });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const dest = res.headers.get('location');
          if (!dest) throw new Error('Redirect without location.');
          current = new URL(dest, current);
          continue;
        }
        if (!res.ok) throw new Error(`Job page returned HTTP ${res.status}.`);
        const mime = res.headers.get('content-type') || '';
        if (!mime.includes('text/html') && !mime.includes('text/plain')) throw new Error('Job page is not readable HTML/text.');
        const size = Number(res.headers.get('content-length') || 0);
        if (size > 1_500_000) throw new Error('Job page too large.');
        const html = (await res.text()).slice(0, 1_500_000);
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, aside, noscript').remove();
        const candidates = [
          $('[class*="job-description"]').text(),
          $('[id*="job-description"]').text(),
          $('main').text(),
          $('article').text(),
          $('body').text()
        ].map((s) => s.replace(/\s+/g, ' ').trim());
        const text = candidates.find((s) => s.length > 500) ?? candidates.sort((a, b) => b.length - a.length)[0] ?? '';
        if (text.length < 350) throw new Error('Not enough vacancy content (JS-rendered or blocked site).');
        return { source: current.toString(), text: text.slice(0, 35000) };
      }
      throw new Error('Too many redirects.');
    } catch (error) {
      if (!file) throw new Error(`Cannot extract vacancy from URL. Save its description as a text file and use --file. Cause: ${String(error)}`);
      console.warn(`URL extraction failed (${String(error)}). Using --file fallback.`);
    }
  }
  const text = await readFile(file!, 'utf8');
  if (text.trim().length < 100) throw new Error('Vacancy file is too short.');
  return { source: file!, text: text.slice(0, 35000) };
}
