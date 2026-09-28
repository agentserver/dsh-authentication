---
description: "为需要使用身份提供方而非本地启动令牌的 Web 部署提供 OIDC 浏览器登录。"
kind: "package-reference"
---

# @agentserver/dsh-authentication-oidc

[English](README.md) | 中文

## 概述

使用本包让 dsh Web 应用通过 OpenID Connect 提供方保护访问。它通过 Authorization Code + PKCE 将未认证浏览器重定向到提供方，使用 discovery 文档和 JWKS 校验返回的 ID token，并把认证后的浏览器会话保存为签名 HttpOnly cookie。本包与其他 authentication provider 并列注册；它尚未执行 tenant 或 Workspace 授权。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本包挂载在 `@deepseek-ai/dsh-client-connection` 之后，并配置 OIDC public client 的回调地址：

```yaml
- id: authentication-oidc
  name: '@agentserver/dsh-authentication-oidc'
  config:
    issuer: !!js process.env.DSH_OIDC_ISSUER
    clientId: !!js process.env.DSH_OIDC_CLIENT_ID
    redirectUri: !!js process.env.DSH_OIDC_REDIRECT_URI
```

`issuer` 与 `clientId` 必填。issuer 必须是 HTTPS origin，discovery 文档声明的 issuer 必须与配置一致。默认回调路径为 `/oidc/callback`；如果公网 URL、反向代理或转发协议不同于本地请求 authority，请显式配置 `redirectUri`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `issuer` | 必填 | OIDC issuer origin。 |
| `clientId` | 必填 | 注册的 OIDC client id。 |
| `clientSecretRef` | 省略 | confidential client secret 的凭据引用；始终使用 PKCE。 |
| `redirectUri` | request authority + `/oidc/callback` | 已注册的回调 URI。 |
| `callbackPath` | `/oidc/callback` | 本地精确回调路由。 |
| `scopes` | `openid profile email` | 登录请求的 OIDC scope。 |
| `cookieMaxAgeDays` | `30` | 签名浏览器会话的最长生命周期。 |
| `requestTimeoutMs` | `15000` | discovery 与 token exchange 的截止时间。 |

本插件只在配置的 credential provider 中保存签名 secret，不保存 ID token 或 access token。回调会校验 state、PKCE、nonce、issuer、audience、签名和 sub 字段后才签发 cookie。认证后的 principal 通过 ctx.authentication.authenticate() 返回，供后续 tenant scoped authorization 使用。discovery 或回调校验失败时拒绝访问。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Connection 包拥有 trust fence 和 RPC 路由。本插件在激活时读取 OIDC metadata，注册回调路由，并注册自己的 provider：provider 对签名 cookie 返回 authenticated principal，或通过 OIDC 重定向接管 anonymous 的 index 响应。多个 authentication provider 可以通过优先级同时注册；遇到 token 查询参数时显式 decline，由 token provider 处理。

不发布 runtime invariant companion；OIDC 校验与回调行为在 provider 和路由入口处检查。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Connection transport](../../client/connection/README.zh.md)——浏览器请求信任、会话 cookie 与可替换认证器插槽。
- [Credentials seam](../credentials/README.zh.md)——凭据引用和由提供方拥有的秘密值。
- [Workspace 子系统](../../../docs/subsystems/workspace.zh.md)——未来 tenant scoped Workspace 访问的授权消费方。

<a id="model-experience"></a>
## 模型体验

无，因为 OIDC 认证在 RPC 分发前执行，不注册模型上下文或工具。

#### KV Cache effect

不产生失效；认证状态不会进入模型请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 当前插件只认证浏览器，不向 controller 暴露 OIDC principal，也不执行 tenant/Workspace membership。
- 未完成的登录状态只保存在进程内；Host 重启会使未完成的回调失效。
- 回调必须注册到 OIDC 提供方，并且 Host 能访问 issuer discovery 文档。
- 签名 cookie 是应用会话凭据；本插件不保存提供方 access token 或 refresh token。

### 开发备注

<a id="dev-note"></a>

<details>
<summary>维护者工作上下文</summary>

无。

</details>
