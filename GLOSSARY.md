# MCP Gateway

A single-user gateway that hosts first-party MCP servers, each against exactly one Provider, with several Accounts per MCP.

## Language

### Topology

**Provider**:
An external service whose API an MCP wraps and whose authorization an Account holds. This gateway has two: Google and Microsoft.
_Avoid_: vendor, backend, integration, upstream

**MCP**:
A first-party server this gateway hosts at `/mcps/<slug>`, exposing tools, resources and prompts against exactly one Provider.
_Avoid_: connector, plugin, integration, tool server

### Accounts and authorization

**Account**:
A Provider identity authorized for exactly one MCP, addressed by a human-chosen slug that is unique within that MCP.
_Avoid_: connection, profile, user

**Credential**:
The access and refresh tokens belonging to one Account.
_Avoid_: token pair, secrets, keys

**Default Account**:
The Account an MCP uses when a request names none. At most one per MCP, and a broken Default Account never falls back to another Account.
_Avoid_: primary account, active account

**Account state**:
Where an Account stands with its Provider: `active` (usable), `needs_reauth` (its Credential can no longer be refreshed), or `revoked` (its Credential was deleted on purpose).
_Avoid_: status, health

**Required scope set**:
The Provider permissions one MCP's entire tool surface needs. An Account for that MCP must hold all of them.
_Avoid_: scope list, permission list

**Granted scope set**:
The Provider permissions an Account's owner actually consented to, as the Provider reports them. It may exceed the required scope set; while the Account is usable it never falls short of it.
_Avoid_: granted scopes, token scopes
