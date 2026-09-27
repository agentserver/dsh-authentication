# dsh-authentication

Authentication providers for DeepSeek Harness Web transports.

This repository publishes three packages under the @agentserver scope:

- @agentserver/dsh-authentication — provider registry and request contracts.
- @agentserver/dsh-authentication-token — local launch-token authentication.
- @agentserver/dsh-authentication-oidc — OIDC Authorization Code + PKCE authentication.

The packages are designed to be mounted beside the Harness Connection carrier. The registry is protocol-neutral; tenant and Workspace authorization remain consumers of the authenticated principal.

## Development

Run pnpm install, then pnpm run verify.
