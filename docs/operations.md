# Operations

## Startup

Apply `migrations/0001_core.sql` to Postgres 16 with pgvector. Supply `DATABASE_URL`; without it the process uses an intentionally ephemeral in-memory store. Inject provider and model keys from the cloud secret manager.

## Health and scaling

`GET /healthz` is unauthenticated for load balancers. HTTP workers are stateless when Postgres is configured. Scale horizontally; provider fan-out is bounded per request. Set upstream timeouts above the request latency budget.

## Retention

The default deadline is 30 days. Run `DELETE FROM episodes WHERE expires_at < now()` on a daily cloud scheduler. Outcome rows cascade. Object storage is not required in the current unit; when raw provider payload archives are added, apply the same 30-day lifecycle policy.

## Alerts

Alert on p95 search latency over the declared request budget, HTTP 5xx over 1%, complete responses with zero results above 5% when at least one provider is enabled, provider circuit-open state, and retention cleanup failures.

## Key rotation

Run old and new tenant API keys in parallel for one deploy, then remove the old hash/reference. Provider keys are process secrets and never enter DB rows or logs. Restart workers after secret rotation unless the deployment platform supports live secret reload.
