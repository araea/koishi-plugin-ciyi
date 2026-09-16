# koishi-plugin-ciyi

词意猜词：每天一个两字词，在群里开猜

## 安装

```sh
yarn add koishi-plugin-ciyi
```

在 Koishi 配置中启用，并提供 database 服务；需要图片输出时再提供 canvas 服务。

## 指令

| 指令 | 说明 |
| --- | --- |
| `ciyi` | 玩法 |
| `ciyi.猜 <词>` | 开始今日对局并报一个两字词 |
| `ciyi.裸词 [开/关]` | 切换本频道无前缀续猜 |
| `ciyi.排行榜` | 累计猜中排行榜 |

首次用 `ciyi.猜 <词>` 开题，之后可直接发送两字词继续猜。裸词设置只对当前频道生效，重启后恢复默认。

## 许可证

可按 [Apache-2.0](LICENSE-APACHE) 或 [MIT](LICENSE-MIT) 使用。
