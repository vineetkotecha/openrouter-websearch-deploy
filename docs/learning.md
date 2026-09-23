# Learning loop (issue #1)

No learned policy is serving. Everything here is offline or shadow-only.

- **Event contract** (`src/learning/contract.ts`): joins outcomes to episodes and the full
  returned candidate set with positions, provider runs, latency and estimated cost. Stamps
  mandate prompt, route policy, planner, ranker, faithfulness and reward versions. Episodes
  with `permissions.may_learn` not true, expired episodes and other tenants are excluded at
  derivation. Tenant-local only.
- **Reward v1** (`src/learning/reward.ts`): viewed +0.1, selected +1, converted +3 (plus a
  capped value term), returned +1.5, refined -0.25 unless followed by success, rejected -1,
  failed -2, bounded latency and cost penalties. Components are kept next to the scalar.
- **Offline replay** (`src/learning/replay.ts`, `npm run learn:report`): time-ordered
  train/eval split, replays logged candidate sets under deterministic policies, reports
  reward, nDCG@3/@10, supported share of top 3, p50/p95 latency and cost by query class.
  Logged-candidate replay only; no causal claims.
- **Shadow policy** (`src/learning/shadow.ts`): UCB1 provider scorer per query class. It
  proposes; it cannot serve. Table `shadow_decisions` (migration 0005) stores proposals.
  Wired into the request path: after each stored episode with `permissions.may_learn`, the
  tenant-local policy (refit every 15 min from that tenant's may_learn episodes) logs a proposal
  next to the production primary. Never served. Admins read recent proposals and the agreement
  rate at `GET /v1/admin/shadow`.
