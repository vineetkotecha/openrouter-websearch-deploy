# ADR 0003: context and privacy

Status: accepted, 2026-09-21

Accept pushed context and support a pull contract. A material missing field returns one `needs_input` question only when `may_ask_user` is explicit; the calling agent presents it. Data is tenant-siloed. Cross-tenant learning is opt-in. Default retention is 30 days across raw responses, traces, mandates and episodes. No context is sent to providers unless it is represented safely in the translated query and allowed by scope.
