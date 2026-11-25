import type { CvDraft, EvidenceChunk, LockedFacts, QualityReview } from './schemas.ts';

/** Deterministic guards run before accepting any LLM-issued PASS. */
export function preflightDraft(draft: CvDraft, sources: EvidenceChunk[], facts: LockedFacts): string[] {
  const problems: string[] = [];
  const knownIds = new Set(sources.map((s) => s.id));
  if (!draft.cvMarkdown.trim()) problems.push('CV content is empty.');
  if (!draft.claims.length) problems.push('No claim-to-evidence mapping supplied.');
  for (const text of facts.mustIncludeExact) {
    if (text && !draft.cvMarkdown.includes(text)) problems.push(`Required approved wording is missing: ${text}`);
  }
  for (const text of facts.neverInclude) {
    if (text && draft.cvMarkdown.toLowerCase().includes(text.toLowerCase())) {
      problems.push(`Forbidden wording appears: ${text}`);
    }
  }
  for (const question of draft.questions) {
    if (question.trim()) problems.push(`Unresolved factual question: ${question}`);
  }
  for (const item of draft.claims) {
    if (item.support === 'NEEDS_EVIDENCE') problems.push(`Unverified claim: ${item.claim}`);
    if (item.evidenceIds.length === 0) problems.push(`Claim lacks provenance: ${item.claim}`);
    for (const id of item.evidenceIds) {
      if (!knownIds.has(id)) problems.push(`Unknown evidence ID ${id} for claim: ${item.claim}`);
    }
  }
  return [...new Set(problems)];
}

export function decide(review: QualityReview, revision: number, maxRevisions: number):
  'PASS' | 'REVISE' | 'BLOCKED' | 'STOP' {
  if (review.status === 'BLOCKED' || review.issues.some((i) => i.severity === 'BLOCKER')) return 'BLOCKED';
  if (review.status === 'PASS' && !review.issues.some((i) => i.severity === 'MAJOR') && review.claimChecks.length > 0 && review.claimChecks.every((c) => c.support === 'PROVEN')) return 'PASS';
  return revision >= maxRevisions ? 'STOP' : 'REVISE';
}
