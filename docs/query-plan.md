# Provider query plan v1
A typed intermediate plan separates mandate semantics from provider syntax. Precedence is hard constraints, then mandate factors, then permitted caller context. The trace records where every derived control came from.

Shared controls: task class, objective/query, result limit, language/country/location, date/relative freshness, include/exclude domains, source types, primary-only preference, fast/balanced/deep mode, content extraction and vertical/proprietary sources.

Adapters map only supported fields. Unsupported controls stay visible in the plan rather than being silently invented. Current mappings: Exa domain/date/category/content; SerpApi engine/localization/recency; Valyu proprietary sources/date; Jina domain operators; Firecrawl source/location/time/extraction; Parallel objective/query/source policy/date; Linkup depth/domain/date; You locale/freshness/domain; Apify Google locale/domain query shaping.

Security: plans are internal typed data. Provider output remains untrusted. Never send the derivation trace, unrelated context or unsupported private factors to providers.
