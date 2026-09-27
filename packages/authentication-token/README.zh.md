---
description: "dsh Web 的本地启动令牌认证 provider。"
kind: "package-reference"
---

# @agentserver/dsh-authentication-token

[English](README.md) | 中文

## 概述

使用本 provider 提供现有的本地 dsh Web 登录：进程打印随机启动 URL，首个浏览器请求把它换成签名 HttpOnly cookie，后续请求使用该 cookie。它是 `@agentserver/dsh-authentication` 的一个 provider，因此部署可以增加 OIDC 或其他方式，而不需要改变 Connection。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 默认挂载本 provider。若本地浏览器会话需要不同生命周期，可以在 plugin row 中配置 `cookieMaxAgeDays`。

不发布 runtime invariant companion；provider 将请求准入交给 authentication 注册表，provider 测试覆盖其行为。

<a id="model-experience"></a>
## 模型体验

无，因为 provider 在 RPC 分发前认证浏览器，不注册模型上下文或工具。

#### KV Cache effect

不产生失效；浏览器 cookie 不会进入模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 启动 URL 是本地 bootstrap credential，不是外部用户身份。
- 本 provider 不暴露 user subject，也不执行 Tenant membership。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
