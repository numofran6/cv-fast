import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadVacancy } from './vacancy.ts';
import { loadEvidence, selectEvidence } from './evidence.ts';
import { createEngines } from './agents.ts';
import { executeWorkflow } from './workflow.ts';
import type { LockedFacts } from './schemas.ts';

function getArg(key: string): string | undefined {
  const i = process.argv.indexOf(key);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'vacancy';
}
async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm start -- --url https://jobs.example/job [--file vacancy.txt]');
    console.log('   or: npm start -- --file vacancy.txt');
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing. Copy .env.example to .env and fill it in.');
  const root = resolve(process.cwd());
  const job = await loadVacancy(getArg('--url'), getArg('--file'));
  const factsPath = join(root, 'config', 'locked-facts.json');
  let facts: LockedFacts;
  try { facts = JSON.parse(await readFile(factsPath, 'utf8')) as LockedFacts; }
  catch { throw new Error('Missing config/locked-facts.json. Copy and complete config/locked-facts.example.json first.'); }
  if (!Array.isArray(facts.mustIncludeExact) || !Array.isArray(facts.neverInclude) || facts.mustIncludeExact.length === 0) {
    throw new Error('locked-facts.json must define approved mustIncludeExact wording and neverInclude list.');
  }
  const all = await loadEvidence(join(root, 'evidence'));
  if (all.length === 0) throw new Error('No evidence files found. Put approved CV/evidence files in evidence/.');
  // Use first analysis pass to identify role requirements, then retrieve the most relevant evidence.
  const initialEngines = await createEngines(join(root, 'instructions'), [], facts);
  console.log(`Loaded ${all.length} evidence chunks. Analysing vacancy...`);
  const role = await initialEngines.analyse(job);
  const selected = selectEvidence(all, role);
  const agents = await createEngines(join(root, 'instructions'), selected, facts);
  const runPath = join(root, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug(role.company)}-${slug(role.title)}`);
  await mkdir(runPath, { recursive: true });
  await writeFile(join(runPath, 'vacancy.txt'), job.text);
  await writeFile(join(runPath, 'source-manifest.json'), JSON.stringify(selected.map(({ id, path }) => ({ id, path })), null, 2));
  console.log(`Selected ${selected.length} relevant evidence chunks. Writing run to: ${runPath}`);

  // Reuse the first role analysis; prevents duplicate API work.
  const result = await executeWorkflow({
    job, evidence: selected, facts,
    engines: { ...agents, analyse: async () => role },
    maxRevisions: 2,
    progress: async (stage, value) => {
      const extension = typeof value === 'object' ? 'json' : 'txt';
      const body = extension === 'json' ? JSON.stringify(value, null, 2) : String(value);
      await writeFile(join(runPath, `${stage}.${extension}`), body);
      console.log(`✔ ${stage}`);
    }
  });
  await writeFile(join(runPath, 'candidate-cv.md'), result.cv.cvMarkdown);
  await writeFile(join(runPath, 'report.json'), JSON.stringify({
    status: result.status, source: job.source, role: result.role,
    reviews: result.reviews, notes: result.notes, claimEvidence: result.cv.claims,
    selectedEvidence: selected.map(({ id, path }) => ({ id, path }))
  }, null, 2));
  console.log(`\n${result.status}\nCV: ${join(runPath, 'candidate-cv.md')}\nQA: ${join(runPath, 'report.json')}`);
  console.log('Draft is for your review only. No automatic application submission or DOCX/PDF export.');
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
