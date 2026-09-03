koishi-plugin-ciyi
==================

[<img alt="github" src="https://img.shields.io/badge/github-araea/koishi__plugin__ciyi-8da0cb?style=for-the-badge&labelColor=555555&logo=github" height="20">](https://github.com/araea/koishi-plugin-ciyi)
[<img alt="npm" src="https://img.shields.io/npm/v/koishi-plugin-ciyi.svg?style=for-the-badge&color=fc8d62&logo=npm" height="20">](https://www.npmjs.com/package/koishi-plugin-ciyi)

Koishi 的词意猜词插件。

## 使用

设置指令别名后，发送 `ciyi` 查看玩法。每日藏一个两字词，使用 `ciyi.猜 <词>` 提交第一次猜测并开题；开题后可直接发送两字词继续猜测。`ciyi.裸词` 可在当前群临时切换这一行为，不改插件配置，重启后自动复原。

## 指令

| 指令 | 说明 |
| --- | --- |
| `ciyi` | 玩法说明 |
| `ciyi.猜 <词>` | 开始今日游戏并提交猜测 |
| `ciyi.裸词 [开/关]` | 临时切换本群裸词续猜 |
| `ciyi.排行榜` | 猜中次数榜 |

## QQ 群

956758505

<br>

#### License

<sup>
Licensed under either of <a href="LICENSE-APACHE">Apache License, Version
2.0</a> or <a href="LICENSE-MIT">MIT license</a> at your option.
</sup>

<br>

<sub>
Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this crate by you, as defined in the Apache-2.0 license, shall
be dual licensed as above, without any additional terms or conditions.
</sub>
