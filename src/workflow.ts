import { decide, preflightDraft } from './decisions.ts';
import type { CvDraft, EvidenceChunk, LockedFacts, QualityReview, RoleAnalysis, Vacancy, WorkflowStatus } from './schemas.ts';

export type Engines = {
  analyse: (job: Vacancy) => Promise<RoleAnalysis>;
  draft: (job: Vacancy, role: RoleAnalysis, evidence: EvidenceChunk[]) => Promise<CvDraft>;
  optimise: (job: Vacancy, role: RoleAnalysis, evidence: EvidenceChunk[], cv: CvDraft, feedback: QualityReview | null) => Promise<CvDraft>;
  review: (job: Vacancy, evidence: EvidenceChunk[], cv: CvDraft) => Promise<QualityReview>;
};
export type Progress = (stage: string, value: unknown) => Promise<void>;

export async function executeWorkflow(args: {
  job: Vacancy; evidence: EvidenceChunk[]; facts: LockedFacts; engines: Engines;
  maxRevisions?: number; progress?: Progress;
}): Promise<{ status: WorkflowStatus; cv: CvDraft; reviews: QualityReview[]; role: RoleAnalysis; notes: string[] }> {
  const { job, evidence, facts, engines, progress = async () => {} } = args;
  const maxRevisions = args.maxRevisions ?? 2;
  if (evidence.length === 0) throw new Error('No candidate evidence loaded. Add files to evidence/.');
  const role = await engines.analyse(job);
  await progress('01-role-analysis', role);
  const original = await engines.draft(job, role, evidence);
  await progress('02-application-engine', original);
  let cv = await engines.optimise(job, role, evidence, original, null);
  await progress('03-interview-optimiser', cv);
  const reviews: QualityReview[] = [];

  for (let revision = 0; revision <= maxRevisions; revision++) {
    const violations = preflightDraft(cv, evidence, facts);
    if (violations.length) {
      // Fixable rule violations go back to the Optimiser before requiring the candidate.
      // Do not falsely count a draft as passed merely because a model would have approved it.
      const policyFeedback: QualityReview = {
        status: 'REVISE',
        summary: 'Deterministic claim/locked-wording checks failed.',
        issues: violations.map((finding) => ({ severity: 'MAJOR', finding,
          fix: 'Use the provided approved source wording, correct the provenance, or remove the claim entirely. Never invent missing evidence.' })),
        claimChecks: []
      };
      reviews.push(policyFeedback);
      await progress(`04-policy-gate-${revision + 1}`, policyFeedback);
      if (revision >= maxRevisions) {
        return { status: 'NEEDS_HUMAN_EVIDENCE', cv, role, reviews, notes: violations };
      }
      cv = await engines.optimise(job, role, evidence, cv, policyFeedback);
      await progress(`05-optimiser-revision-${revision + 1}`, cv);
      continue;
    }
    const review = await engines.review(job, evidence, cv);
    // A PASS must cover every claim in the submitted claim map, with existing evidence IDs.
    // This makes it harder for a shallow/incomplete model review to certify itself.
    const knownIds = new Set(evidence.map((item) => item.id));
    const checks = new Map(review.claimChecks.map((c) => [c.claim.trim().toLowerCase(), c]));
    const auditGaps = cv.claims.flatMap((claim) => {
      const check = checks.get(claim.claim.trim().toLowerCase());
      return !check ? [`Quality Gate did not individually check: ${claim.claim}`] :
        check.sourceIds.some((id) => !knownIds.has(id)) ? [`QA cited unknown evidence for: ${claim.claim}`] : [];
    });
    if (auditGaps.length) {
      review.status = 'REVISE';
      review.issues.push(...auditGaps.map((finding) => ({
        severity: 'MAJOR' as const, finding,
        fix: 'Rebuild the claim map or check the claim against a real evidence ID.'
      })));
    }
    reviews.push(review);
    await progress(`04-quality-gate-${revision + 1}`, review);
    const decision = decide(review, revision, maxRevisions);
    if (decision === 'PASS') {
      return { status: 'READY_FOR_HUMAN_REVIEW', cv, role, reviews, notes: [] };
    }
    if (decision === 'BLOCKED') {
      return { status: 'NEEDS_HUMAN_EVIDENCE', cv, role, reviews, notes: [review.summary] };
    }
    if (decision === 'STOP') {
      return { status: 'NEEDS_MANUAL_REVIEW', cv, role, reviews, notes: ['Maximum revision rounds exhausted.'] };
    }
    cv = await engines.optimise(job, role, evidence, cv, review);
    await progress(`05-optimiser-revision-${revision + 1}`, cv);
  }
  throw new Error('Unreachable workflow state.');
}
