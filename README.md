# CV Workflow Orchestrator (TypeScript)

An engineering-first starting implementation of your workflow:

**Vacancy → CV Application Engine → CV Interview Optimiser → independent CV Quality Gate → (up to two revise/review cycles) → human review.**

No automatic job submission. The written draft is reviewed by the candidate before DOCX/PDF exports. This matches your existing content-approval rule.

## Requirements

- Node.js 22+
- OpenAI API account/key with billing enabled (ChatGPT subscription does not cover API usage)
- Source files from your existing CV Projects

## One-time setup

1. Unzip this project, open a terminal in the directory and run `npm install`.
2. Copy `.env.example` to `.env`, add your API key. Check your account can use the model named in `OPENAI_MODEL`; set `OPENAI_QA_MODEL` separately if desired.
3. Copy `config/locked-facts.example.json` to `config/locked-facts.json`. Add every approved immutable string, especially JustGo Health's precise title, dates **and all four exact approved bullets**. This configuration is intentionally not complete: the authoritative bullets were not available when this starter was assembled.
4. Put your authoritative master CV, `JUSTGO-HEALTH-EXPERIENCE.md`, GitLab MR exports, Jira exports, and other verified evidence under `evidence/`. Supports `.md`, `.txt`, `.json`, `.csv`, `.pdf` (text-layer), `.docx`. Scanned/image-only PDFs need extraction by a separate OCR process.
5. **Important:** Overwrite/merge the three starter files in `instructions/` with the newest instructions from your existing **CV Application Engine**, **CV Interview Optimiser**, and **CV Quality Gate** projects. Existing contents are reconstructions, not full verified project prompts.
6. Run `npm run check` and `npm test` before your first live job application.

### Usage: vacancy URL

```bash
npm start -- --url "https://company.com/careers/software-engineer"
```

### Usage: blocked or JS-rendered vacancy

Save the full job description to `vacancy.txt`, then:

```bash
npm start -- --file vacancy.txt
```

URL with local fallback:

```bash
npm start -- --url "https://company.com/job/123" --file vacancy.txt
```

## Outputs

Each run creates an isolated folder in `runs/YYYY-MM-DD...-company-role/`:

- `candidate-cv.md`: final unapproved written CV draft.
- `report.json`: Quality Gate status, issues and claim/source relationships.
- `01-role-analysis.json` etc.: stage snapshots for diagnosis.
- `vacancy.txt`, `source-manifest.json`: input copy + evidence IDs/file references.

Possible workflow statuses:

- `READY_FOR_HUMAN_REVIEW`: automated checks passed; you still approve.
- `NEEDS_HUMAN_EVIDENCE`: missing/contradictory facts; do not auto-fill.
- `NEEDS_MANUAL_REVIEW`: maximum revision rounds exhausted.

## Design and limitations

- Three agents are run as separate API calls with separate system instructions. The Orchestrator (TypeScript) decides every transition; no agent is allowed to self-certify a PASS.
- The evidence pool is keyword-ranked locally after role analysis, with a cap to avoid sending multi-megabyte Jira/GitLab exports. Critical source filenames (e.g. `master-cv`, `justgo`, `employment`) are prioritized. **This heuristic is not semantic retrieval** and may miss a relevant obscure source; strengthen with BM25/embeddings for scale.
- Claim-to-evidence links are required and cited source IDs must exist. The LLM Quality Gate still has to reason whether a source truly supports a claim; source IDs alone do not prove the claim.
- A two-round revision limit keeps the workflow from running forever. Only fixable review failures are automatically revised.
- PDF extraction requires a text layer. The code intentionally does not use OCR.
- Scraping some job portals will fail due to login, anti-bot protection, or JS rendering. Use the `--file` fallback.
- The first version does not generate DOCX/PDF, track applications, or click submit. This is deliberate: you previously required approval of written content before exports, and approval should remain a hard boundary.
- Local source evidence and runs are excluded by `.gitignore`. **Do not commit personal CVs, private MR/Jira exports, `.env`, or logs**. The relevant evidence text and CV are sent to the model API when you execute a run. Respect employer confidentiality and remove secrets/private data before ingestion.
- SDK tracing is disabled by default because candidate/employer evidence may be sensitive. Opt in only if needed.
- The provided scaffold was assembled in an environment without npm registry access; dependency installation, TypeScript checking and live agent calls must be verified on your machine. No claim of live end-to-end execution is made.

## Next engineering milestones

1. Integrate your **exact current** prompts and verified evidence records.
2. Compare the generated outputs against 3 previously approved applications, focusing on factual accuracy, edit distance and QA false passes.
3. Add semantic retrieval, evidence provenance at individual claim level, and automated benchmarks.
4. After candidate approval, add ATS-friendly DOCX/PDF export plus extraction/hyperlink checks. Do not export before approval.
