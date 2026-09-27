---
description: "dsh transport 使用的浏览器认证 provider 注册表。"
kind: "package-reference"
---

# @agentserver/dsh-authentication

[English](README.md) | 中文

## 概述

使用本包在不让 Connection transport 绑定单一协议的情况下组合浏览器认证方式。各 provider 独立注册，注册表按优先级选择登录入口，并以 provider 无关的 principal 查询暴露已认证请求。本包只负责认证分发；tenant membership 与 Workspace 授权仍由消费方负责。

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

在 `@deepseek-ai/dsh-client-connection` 之前挂载本注册表，再挂载一个或多个 provider 插件。随附 Web 组合挂载 token provider，也可以在它旁边增加 OIDC。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

注册表按优先级排序 provider。index 请求如果已经被某个 provider 认证就放行；如果某个 provider 启动登录，则由它处理；没有 provider 接受时拒绝。API 请求只要有一个 provider 校验凭据成功即可通过。provider 注册返回 disposer，插件卸载时会移除对应认证方式。

不发布 runtime invariant companion；注册表拥有唯一的 provider 映射，注册与卸载测试覆盖可观察关系。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Connection transport](../../client/connection/README.zh.md)——消费本注册表的 Host carrier。
- [启动令牌 provider](../authentication-token/README.zh.md)——本地默认方式。
- [OIDC provider](../authentication-oidc/README.zh.md)——浏览器 Authorization Code + PKCE。

<a id="model-experience"></a>
## 模型体验

无，因为认证在 RPC 分发前执行，不注册模型上下文或工具。

#### KV Cache effect

不产生失效；认证状态不会进入模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 注册表只认证请求，不决定 principal 是否可以访问 Tenant、Workspace 或 Session。
- provider 优先级决定初始登录流程；未来可以增加显式登录方式选择器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
