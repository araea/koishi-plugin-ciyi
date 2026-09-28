# 词意

Koishi 插件：每天出一个两字词，玩家按语义远近竞猜并累计排行

[![GitHub](https://img.shields.io/badge/GitHub-仓库-181717)](https://github.com/araea/koishi-plugin-ciyi)
[![npm](https://img.shields.io/badge/npm-koishi--plugin--ciyi-CB3837)](https://www.npmjs.com/package/koishi-plugin-ciyi)

## 安装

```sh
yarn add koishi-plugin-ciyi
```

在 Koishi 中启用，并安装 `database` 服务。图片输出需要 `canvas` 服务。

## 快速使用

| 指令 | 说明 |
| --- | --- |
| `ciyi` | 查看玩法 |
| `ciyi.猜 <词>` | 开始今日对局或提交猜测 |
| `ciyi.裸词 [开/关]` | 切换本频道无前缀续猜 |
| `ciyi.排行榜` | 查看累计猜中排行 |

开局后可直接发送两字词继续猜，也可在 @ 或引用消息后输入词语。裸词设置仅对当前频道有效，插件重载后恢复默认。

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `atReply` | boolean | `false` | 回复时 @ 用户 |
| `quoteReply` | boolean | `false` | 回复时引用消息 |
| `enableDirectInput` | boolean | `true` | 对局中直接发送两字词即可续猜，无需指令前缀 |
| `renderImage` | boolean | `true` | 把猜测板渲染成图片，无 `canvas` 服务时回退为等价文本 |
| `maxHistory` | number | `10` | 猜测板最多列出的历史条数，最新一次始终列出 |
| `maxRank` | number | `10` | 排行榜最多显示的人数 |
| `retractDelay` | number | `0` | 自动撤回延迟（秒），`0` 表示不撤回 |

## 限制 / 风险

需要 `database` 服务存储对局与榜单。图片渲染依赖 `canvas` 服务，不可用时自动回退文本。每日题目从远程词库拉取，网络不可用则当题无法开始。
