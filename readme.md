koishi-plugin-ciyi
==================

[<img alt="github" src="https://img.shields.io/badge/github-araea/ci_yi-8da0cb?style=for-the-badge&labelColor=555555&logo=github" height="20">](https://github.com/araea/koishi-plugin-ciyi)
[<img alt="npm" src="https://img.shields.io/npm/v/koishi-plugin-ciyi.svg?style=for-the-badge&color=fc8d62&logo=npm" height="20">](https://www.npmjs.com/package/koishi-plugin-ciyi)

Koishi 的词意（猜词游戏）插件。根据词语的含义相似程度，猜测正确的词语。

每天藏起一个两字词。你报词，它回你这个词与答案的语义排名 —— 名次越小越近，`#1`
就是答案本身；同时给出它在相似度榜单上的左右邻居，各遮去一字。

## 使用

1. 设置指令别名（推荐把 `ciyi.猜` 设为 `猜`）。
2. 发送 `ciyi` 查看图文玩法说明。

| 指令 | 作用 |
| --- | --- |
| `ciyi` | 玩法说明 |
| `ciyi.每日挑战` | 开今天的题 |
| `ciyi.猜 山水` | 报一个两字词 |
| `ciyi.排行榜` | 累计猜中次数榜 |

## 图片

安装 `puppeteer` 服务后，玩法、开局、猜测板、揭晓与排行榜都会渲染成「墨与纸」
风格的卡片：宣纸底、古籍双线框、朱砂印，每个字住在自己的田字格里，隐去的字
只留空格与虚线中缝。猜测按名次由近及远排列，配六档亲疏色阶 ——
咫尺 / 毗邻 / 相近 / 沾边 / 疏远 / 天涯。

未安装、渲染失败或在配置里关掉「渲染图片」时，自动回退为排版等价的文本，
玩法不受影响。

## 致谢

- [Koishi](https://koishi.chat/)
- [词影](https://cy.surprising.studio/)

## QQ 群

- 956758505

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
