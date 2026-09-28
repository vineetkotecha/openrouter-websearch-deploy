# 13-step search flow (implementation state)

The calling personal agent owns the user conversation and supplies the initial query and only permitted, evidenced context. The harness does not infer psychological facts from demographics or a broad search phrase.

1. Intake: validate tenant, query, permissions and context.
2. Basic query formation: identify possible answer units and intent space, without selecting an ungrounded personal preference.
3. Parameter curation: inventory utilizable constraints and psychological choice factors, with source, freshness, confidence and allowed uses. Explicit hard constraints govern eligibility; evidenced psychological factors affect ranking only.
4. Grade missing parameter candidates provisionally. An ungrounded model suggestion cannot become a fact or a mandatory question by itself.
5. Caller-context fill: return `kind: context_request` with agent-only accepted sources. Do not ask the user or write a final mandate at this stage. Caller retries with values it can evidence and `caller_fill_complete: true`.
6. Grade the remainder into necessary and good-to-have. Missing good-to-have values are recorded as missing, never invented.
7. Necessary user fill: return `kind: user_question` via the caller, or an incomplete `needs_input` state when no resume channel is available. Retrieval does not run until necessary answers arrive. An authorized resume carries typed human answers.
8. Final mandate and query formation: only after the two fill stages, write the mandate and post-fill provider query.
9. Decompose into bounded jobs or distinct category branches. Each job records its own query and relevant factors.
10. Route each job's subquery independently; retain the planner's provider capability, cost, fallback and budget checks.
11. Retrieve, triage, extract and verify source records with eligibility gates.
12. Rank eligible records, use evidenced psychological factors for choice among them, and return at most five with honest evidence states.
13. On an explicit outcome sent through the builder-scoped MCP `record_search_outcome` tool or REST endpoint for a retained, `may_learn` episode, update its tenant-local learning example from all recorded events. The shadow policy is invalidated for a later refit; learned policy is not served.

The heuristic gap detector recognizes common high-impact cases; the general intent model can suggest additional questions, but its hypotheses remain optional until the criticality policy establishes necessity. This is not proof that all open-domain necessary parameters are identified. The Gemini prompt pair is unchanged here and awaits separate review.
