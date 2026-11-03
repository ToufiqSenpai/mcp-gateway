# Per-request Account selection, explicit default, no fallback

Every tool and resource read selects its Account per request: an explicit `account` slug, otherwise the MCP's Default Account. When the selected Account is missing, `needs_reauth` or `revoked`, the call fails with an `isError` tool result naming the slug and the admin URL. It never silently falls back to another `active` Account.

**Consequences.** One MCP can hold several Accounts (`personal`, `work`) with no risk that a request written for one lands in the other. Prompts resolve `account` the same way and return `-32602` when no default exists, because a prompt has no tool-result envelope. Revoking the Default Account leaves the MCP with no default until an admin picks one; requests without an `account` then fail rather than guessing.

**Considered Options.** Falling back to "the only active Account" is the obvious convenience, and it is exactly the failure mode being avoided: silently writing to someone else's calendar is worse than an error the operator can read. Inferring a default at request time was rejected for the same reason — the mapping from request to identity must be explicit.
