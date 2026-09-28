---
description: "The browser authentication provider registry used by dsh transports."
kind: "package-reference"
---

# @agentserver/dsh-authentication

English | [中文](README.zh.md)

## Summary

Use this package to compose browser authentication methods without coupling the Connection transport to one protocol. Providers register independently, the registry selects a login entry by priority, and authenticated requests expose one provider-neutral principal lookup. The package owns authentication dispatch only; tenant membership and Workspace authorization remain consumer policy.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the registry before `@deepseek-ai/dsh-client-connection`, then mount one or more provider plugins. The shipped Web composition mounts the token provider and can add OIDC beside it.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The registry orders providers by priority. Each request is authenticated once and returns an anonymous result, a principal, or an explicit rejection; an anonymous index request then offers the entry response to each provider until one returns `handled`. Provider registration returns a disposer, so unloading a plugin removes its authentication method. `authorizeIndex()` is always asynchronous because a provider may verify a remote credential before an entry flow starts.

No runtime invariant companion is published; the registry owns one provider map and its registration/disposal tests cover the observable relationships.

</details>

## Further Exploration

- [Connection transport](../../client/connection/README.md) — the Host carrier that consumes this registry.
- [Launch-token provider](../authentication-token/README.md) — the local default method.
- [OIDC provider](../authentication-oidc/README.md) — browser Authorization Code + PKCE.

## Model Experience

None, as authentication runs before RPC dispatch and registers no model context or tools.

#### KV Cache effect

No invalidation; authentication state never enters a model request prefix.

## Known Limitations and Deferred Work

- The registry authenticates requests but does not decide whether a principal may access a Tenant, Workspace, or Session.
- Provider priorities select one initial login flow; a future login chooser may expose explicit method selection.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
