import { z } from 'zod';

export const Requirement = z.object({
  text: z.string(),
  importance: z.enum(['CORE', 'SECONDARY', 'PERIPHERAL'])
});
export const RoleAnalysis = z.object({
  company: z.string(),
  title: z.string(),
  hiringNarrative: z.string(),
  requirements: z.array(Requirement)
});
export type RoleAnalysis = z.infer<typeof RoleAnalysis>;

export const Claim = z.object({
  claim: z.string(),
  evidenceIds: z.array(z.string()),
  support: z.enum(['DIRECT', 'TRANSFERABLE', 'NEEDS_EVIDENCE'])
});
export const CvDraft = z.object({
  cvMarkdown: z.string(),
  claims: z.array(Claim),
  questions: z.array(z.string())
});
export type CvDraft = z.infer<typeof CvDraft>;

export const QualityReview = z.object({
  status: z.enum(['PASS', 'REVISE', 'BLOCKED']),
  summary: z.string(),
  issues: z.array(z.object({
    severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR']),
    finding: z.string(),
    fix: z.string()
  })),
  claimChecks: z.array(z.object({
    claim: z.string(),
    support: z.enum(['PROVEN', 'UNCERTAIN', 'UNSUPPORTED']),
    sourceIds: z.array(z.string())
  }))
});
export type QualityReview = z.infer<typeof QualityReview>;

export type EvidenceChunk = { id: string; path: string; text: string };
export type LockedFacts = { mustIncludeExact: string[]; neverInclude: string[]; notes?: string };
export type Vacancy = { source: string; text: string };
export type WorkflowStatus = 'READY_FOR_HUMAN_REVIEW' | 'NEEDS_HUMAN_EVIDENCE' | 'NEEDS_MANUAL_REVIEW';
