# Stateless MCP endpoints, no Durable Objects

MCP `2026-07-28` removed protocol sessions, and this gateway has exactly one client class (a service token) over one user's data, so there is no per-connection state worth keeping. Every request is therefore self-contained: a fresh server instance per request, capabilities and protocol version read from that request's `_meta`, no Durable Object, no KV session record.

**Consequences.** The gateway cannot advertise `listChanged` or `resources/subscribe`, because an isolate cannot push to a stream held by another isolate. `subscriptions/listen` is answered with an empty acknowledgement and never emits anything. Single-use `requestState` redemption cannot be enforced, so the gateway never issues MRTR state at all. In exchange: no DO placement, billing or migration, and no cold-start penalty on the MCP path.

**Considered Options.** A Durable Object per MCP endpoint, holding listener registrations and a fan-out loop, would make `listChanged` honest. Rejected because the gateway is single-user and the only freshness signal clients actually need is `ttlMs` on enumeration, which the epoch-keyed KV cache already provides.
