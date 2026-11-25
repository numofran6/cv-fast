import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { EvidenceChunk, RoleAnalysis } from './schemas.ts';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.pdf', '.docx']);

async function walk(root: string, path = root): Promise<string[]> {
  const names = await readdir(path, { withFileTypes: true });
  const out: string[] = [];
  for (const n of names) {
    if (n.name.startsWith('.')) continue;
    const full = join(path, n.name);
    if (n.isDirectory()) out.push(...await walk(root, full));
    else if (n.isFile() && EXTENSIONS.has(extname(full).toLowerCase())) out.push(full);
  }
  return out;
}

async function extract(file: string): Promise<string> {
  const buf = await readFile(file);
  if (buf.length > MAX_FILE_BYTES) throw new Error(`Evidence file too large (15MB max): ${file}`);
  const ext = extname(file).toLowerCase();
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: buf })).value;
  if (ext === '.pdf') {
    const pdf = new PDFParse({ data: new Uint8Array(buf) });
    try { return (await pdf.getText()).text; }
    finally { await pdf.destroy(); }
  }
  return buf.toString('utf8');
}

/** Convert source documents into independently identifiable text segments. */
export async function loadEvidence(directory: string): Promise<EvidenceChunk[]> {
  const files = (await walk(directory)).sort();
  const out: EvidenceChunk[] = [];
  for (const file of files) {
    const text = (await extract(file)).replace(/\r\n/g, '\n');
    const path = relative(directory, file).replaceAll('\\', '/');
    // Chunk on paragraph/line boundaries where possible, with overlap to preserve context.
    const blocks = text.split(/\n\s*\n|(?<=\n)(?=.{0,20}"(?:title|description)"\s*:)/);
    let buffer = '';
    const pieces: string[] = [];
    for (const block of blocks) {
      if ((buffer + block).length > 2200 && buffer) { pieces.push(buffer); buffer = ''; }
      if (block.length > 2400) {
        if (buffer) { pieces.push(buffer); buffer = ''; }
        for (let start = 0; start < block.length; start += 1900) pieces.push(block.slice(start, start + 2200));
      } else buffer += `${block}\n\n`;
    }
    if (buffer.trim()) pieces.push(buffer);
    for (const piece of pieces) {
      if (piece.trim().length < 30) continue;
      out.push({ id: `E${String(out.length + 1).padStart(5, '0')}`, path, text: piece.slice(0, 2200).trim() });
    }
  }
  return out;
}

const words = (value: string) => new Set((value.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [])
  .filter((x) => !new Set(['and', 'the', 'with', 'this', 'that', 'from', 'your', 'have', 'will', 'work', 'role', 'team', 'experience']).has(x)));

export function selectEvidence(all: EvidenceChunk[], role: RoleAnalysis, maxChars = 60000): EvidenceChunk[] {
  const needs = words([role.title, role.hiringNarrative, ...role.requirements.map(r => r.text)].join(' '));
  const scored = all.map((chunk) => {
    const tokens = words(chunk.text);
    const matches = [...needs].reduce((total, term) => total + Number(tokens.has(term)), 0);
    const official = /master.?cv|career.?history|justgo|approved|employment/i.test(chunk.path);
    return { chunk, score: matches + (official ? 250 : 0) };
  }).sort((a, b) => b.score - a.score);
  let used = 0;
  const selected: EvidenceChunk[] = [];
  for (const { chunk } of scored) {
    if (used + chunk.text.length > maxChars) continue;
    selected.push(chunk);
    used += chunk.text.length;
  }
  // Preserve stable source IDs from complete index even after selecting a subset.
  return selected;
}

export function formatEvidence(chunks: EvidenceChunk[]): string {
  return chunks.map((c) => `SOURCE ${c.id} | ${c.path}\n${c.text}`).join('\n\n---\n\n');
}
