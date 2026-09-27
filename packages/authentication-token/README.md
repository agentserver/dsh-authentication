---
description: "The local launch-token authentication provider for dsh Web."
kind: "package-reference"
---

# @agentserver/dsh-authentication-token

English | [中文](README.zh.md)

## Summary

Use this provider for the existing local dsh Web login: the process prints a random launch URL, the first browser request exchanges it for a signed HttpOnly cookie, and later requests use that cookie. It is one provider in `@agentserver/dsh-authentication`, so deployments can add OIDC or another method without changing Connection.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this provider by default. Configure `cookieMaxAgeDays` in its plugin row when the local browser session needs a different lifetime.

No runtime invariant companion is published; the provider delegates request admission to the authentication registry and its behavior is covered by provider tests.

## Model Experience

None, as the provider authenticates the browser before RPC dispatch and registers no model context or tools.

#### KV Cache effect

No invalidation; the browser cookie never enters a model request prefix.

## Known Limitations and Deferred Work

- The launch URL is a local bootstrap credential, not an external user identity.
- The provider does not expose a user subject or enforce Tenant membership.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
