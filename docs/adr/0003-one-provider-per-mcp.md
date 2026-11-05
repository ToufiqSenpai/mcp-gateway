# One Provider per MCP, and Accounts never cross MCPs

Each MCP is first-party against exactly one Provider, and an Account belongs to one MCP. The database enforces both: a `CHECK` pairs `mcp` with `provider` (`calendar`↔`google`, `notes`↔`microsoft`), and `(mcp, provider, provider_subject)` is unique. The same Google identity authorized for `calendar` and, say, a future Google-backed MCP would be two Accounts with two consents and two token sets.

**Consequences.** Reauthorizing or revoking one MCP's Account leaves every other MCP untouched. Each MCP owns a single required scope set, so no MCP ever holds a permission it does not need. A Provider identity can appear several times in the database, once per MCP, which is deliberate rather than a duplicate to clean up.

**Considered Options.** Sharing one Provider identity across MCPs would mean one consent and one Credential store, but it would also mean a scope set union across MCPs, a shared revocation blast radius, and a resource URI authority that does not identify which MCP the Credential belongs to. Rejected: the tool surface is the security boundary here, and it should not be able to reach a Credential it never asked for.
