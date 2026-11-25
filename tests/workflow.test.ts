import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow, type Engines } from '../src/workflow.ts';
import { preflightDraft, decide } from '../src/decisions.ts';
import type { CvDraft, EvidenceChunk, LockedFacts, QualityReview, RoleAnalysis, Vacancy } from '../src/schemas.ts';

const vacancy: Vacancy = { source: 'test', text: 'Senior Engineer builds dependable TypeScript APIs with evidence and tests.' };
const chunks: EvidenceChunk[] = [{ id: 'E00001', path: 'master-cv.md', text: 'Created and verified production TypeScript APIs with integration tests.' }];
const facts: LockedFacts = { mustIncludeExact: ['Example Ltd'], neverInclude: ['invented certification'] };
const role: RoleAnalysis = { company: 'A', title: 'Engineer', hiringNarrative: 'APIs', requirements: [{ text: 'TypeScript', importance: 'CORE' }] };
const cv: CvDraft = { cvMarkdown: '# Candidate\n\nExample Ltd\n\nBuilt TypeScript APIs with tests.', claims: [{ claim: 'Built TypeScript APIs with tests.', evidenceIds: ['E00001'], support: 'DIRECT' }], questions: [] };
function review(status: QualityReview['status']): QualityReview {
  return { status, summary: status, issues: status === 'REVISE' ? [{ severity: 'MINOR', finding: 'Wording', fix: 'Clarify' }] : [], claimChecks: [{ claim: 'Built TypeScript APIs with tests.', support: 'PROVEN', sourceIds: ['E00001'] }] };
}
function services(qaSequence: QualityReview[]): { engines: Engines; counters: { optimisations: number; reviews: number } } {
  const counters = { optimisations: 0, reviews: 0 };
  return { engines: {
    analyse: async () => role,
    draft: async () => cv,
    optimise: async () => { counters.optimisations++; return cv; },
    review: async () => { const idx = counters.reviews++; return qaSequence[idx] ?? qaSequence.at(-1)!; }
  }, counters };
}

test('PASS stops after first review without another revision', async () => {
  const { engines, counters } = services([review('PASS')]);
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(counters.optimisations, 1);
  assert.equal(counters.reviews, 1);
});
test('REVISE returns to optimiser and quality gate', async () => {
  const { engines, counters } = services([review('REVISE'), review('PASS')]);
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(counters.optimisations, 2);
  assert.equal(counters.reviews, 2);
});
test('Repeated REVISE halts after 2 revisions (3 quality checks)', async () => {
  const { engines, counters } = services([review('REVISE')]);
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'NEEDS_MANUAL_REVIEW');
  assert.equal(counters.optimisations, 3);
  assert.equal(counters.reviews, 3);
});
test('BLOCKED never loops to optimizer', async () => {
  const { engines, counters } = services([review('BLOCKED')]);
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'NEEDS_HUMAN_EVIDENCE');
  assert.equal(counters.optimisations, 1);
});
test('Unverified claim blocks before a model QA pass', async () => {
  const draft: CvDraft = { ...cv, claims: [{ claim: 'Unverified claim', evidenceIds: ['E00001'], support: 'NEEDS_EVIDENCE' }] };
  assert.ok(preflightDraft(draft, chunks, facts).length > 0);
});
test('Passing QA without independently checked claims does not PASS', () => {
  assert.equal(decide({ ...review('PASS'), claimChecks: [] }, 0, 2), 'REVISE');
});

test('Deterministic evidence failures attempt automated repair before stopping', async () => {
  const broken: CvDraft = { ...cv, claims: [{ claim: 'Invalid claim', evidenceIds: [], support: 'NEEDS_EVIDENCE' }] };
  let attempts = 0;
  let reviewed = 0;
  const engines: Engines = {
    analyse: async () => role,
    draft: async () => broken,
    optimise: async () => { attempts++; return attempts === 1 ? broken : cv; },
    review: async () => { reviewed++; return review('PASS'); }
  };
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(attempts, 2);
  assert.equal(reviewed, 1);
});

test('QA PASS without checking all mapped claims must be revised', async () => {
  const incomplete: QualityReview = { ...review('PASS'), claimChecks: [{ claim: 'Other claim', support: 'PROVEN', sourceIds: ['E00001'] }] };
  const { engines, counters } = services([incomplete, review('PASS')]);
  const result = await executeWorkflow({ job: vacancy, evidence: chunks, facts, engines });
  assert.equal(result.status, 'READY_FOR_HUMAN_REVIEW');
  assert.equal(counters.reviews, 2);
});
