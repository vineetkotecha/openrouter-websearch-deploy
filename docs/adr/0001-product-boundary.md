# ADR 0001: product boundary

Status: accepted, 2026-09-21

The v1 is a general consumer-search control plane, not a vertical-specific product. MCP is the main surface. HTTP exists as an operational integration surface; SDKs are deferred. Every offered surface must be represented in the builder dashboard. The core returns ranked resources with provenance, not a synthesized answer.
