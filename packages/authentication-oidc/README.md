---
description: "OIDC browser sign-in for Web deployments that need an identity provider instead of the local launch token."
kind: "package-reference"
---

# @agentserver/dsh-authentication-oidc

English | [中文](README.zh.md)

## Summary

Use this package to protect the dsh Web application with an OpenID Connect provider. It redirects unauthenticated browser requests to Authorization Code + PKCE, verifies the returned ID token against the provider's discovery document and JWKS, and keeps the authenticated browser session in a signed HttpOnly cookie. The package registers beside other authentication providers; it does not yet apply tenant or Workspace authorization.

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

Mount it after `@deepseek-ai/dsh-client-connection` and configure an OIDC public client whose redirect URI points at the dsh callback route:

```yaml
- id: authentication-oidc
  name: '@agentserver/dsh-authentication-oidc'
  config:
    issuer: !!js process.env.DSH_OIDC_ISSUER
    clientId: !!js process.env.DSH_OIDC_CLIENT_ID
    redirectUri: !!js process.env.DSH_OIDC_REDIRECT_URI
```

`issuer` and `clientId` are required. The issuer must be an HTTPS origin, and its discovery document must name the same issuer. The default callback path is `/oidc/callback`; configure `redirectUri` explicitly when the public URL, reverse proxy, or forwarded scheme differs from the local request authority.

| Field | Default | Meaning |
|---|---|---|
| `issuer` | required | OIDC issuer origin. |
| `clientId` | required | Registered OIDC client id. |
| `clientSecretRef` | omitted | Credential reference for a confidential client secret. PKCE is always used. |
| `redirectUri` | request authority + `/oidc/callback` | Registered callback URI. |
| `callbackPath` | `/oidc/callback` | Exact local callback route. |
| `scopes` | `openid profile email` | OIDC scopes requested during sign-in. |
| `cookieMaxAgeDays` | `30` | Maximum signed browser-session lifetime. |
| `requestTimeoutMs` | `15000` | Discovery and token-exchange deadline. |

The plugin stores only a signing secret in the configured credential provider. It does not store ID tokens or access tokens. A callback validates state, PKCE, nonce, issuer, audience, signature, and the `sub` claim before issuing a cookie. The Host provides an `oidcAuth` lookup through `ctx.get('oidcAuth')` for a later tenant-scoped facade. Failed discovery or callback verification fails closed.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Connection package owns the trust fence and RPC routes. This plugin discovers OIDC metadata during activation, registers the callback route, and registers a provider that redirects the frontend index request and validates its signed cookie synchronously on later API requests. Multiple authentication providers may be registered with different priorities.

No runtime invariant companion is published; OIDC verification and callback behavior are checked at the provider and route boundaries.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Connection transport](../../client/connection/README.md) — browser request trust, session cookies, and the replaceable authenticator slot.
- [Credentials seam](../credentials/README.md) — credential references and provider-owned secret values.
- [Workspace subsystem](../../../docs/subsystems/workspace.md) — the future authorization consumer for tenant-scoped Workspace access.

<a id="model-experience"></a>
## Model Experience

None, as OIDC authentication runs before RPC dispatch and registers no model context or tools.

#### KV Cache effect

No invalidation; authentication state never enters a model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The current plugin authenticates a browser but does not expose the OIDC principal to controllers or enforce tenant/Workspace membership.
- Pending login state is process-local; restarting the Host invalidates callbacks that have not completed.
- The callback requires a registered redirect URI and a reachable issuer discovery document.
- The signed cookie is an application session credential; the provider's access and refresh tokens are not retained by this plugin.

### Dev Note

<a id="dev-note"></a>

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
