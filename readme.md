# koishi-plugin-ciyi

词意猜词插件。每天生成一个两字词，在群内进行猜测。

## 安装

~~~sh
yarn add koishi-plugin-ciyi
~~~

在 Koishi 配置中启用 koishi-plugin-ciyi，并提供 database 服务；需要图片输出时再提供 canvas 服务。

## 指令

| 指令 | 说明 |
| --- | --- |
| ciyi | 查看玩法 |
| ciyi.猜 &lt;词&gt; | 开始今日游戏并提交猜测 |
| ciyi.裸词 [开/关] | 临时切换本群的无前缀续猜 |
| ciyi.排行榜 | 查看猜中次数排行 |

第一次使用 ciyi.猜 &lt;词&gt; 开题；开题后可直接发送两字词继续猜测。裸词设置仅对当前群
生效，重启后恢复默认。

## 许可证

可按 [Apache-2.0](LICENSE-APACHE) 或 [MIT](LICENSE-MIT) 使用。
