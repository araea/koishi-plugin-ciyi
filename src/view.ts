// ─────────────────────────────────────────────────────────────────────────────
// 词意 · 视图层
//
// 一整套卡片共用「墨与纸」这一套语言：宣纸底、古籍双线框、朱砂印、通篇衬线。
// 词是这个游戏的主角，所以每个字都住在自己的田字格里；隐去的字保留格子与
// 虚线中缝，读起来就像一张写了一半的字帖 —— 提示是「缺了什么」，而不是一个问号。
//
// 样式全部内联，不引用任何外部字体、图片或脚本，无头浏览器里可以稳定出图。
// ─────────────────────────────────────────────────────────────────────────────

/** 一次猜测在相似度榜单上的落点。左邻更接近答案，右邻更远。 */
export interface History {
  guess: string;
  rank: number;
  leftHint: string;
  rightHint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 亲疏
//
// 榜单长四万余条，排名的绝对值对玩家没有意义，「还有多远」才有。
// 六个档位从「咫尺」走到「天涯」，正好凑成一句成语；每个档名都是两字词，
// 与这个游戏本身的规则同构。
// ─────────────────────────────────────────────────────────────────────────────

export interface Tier {
  max: number;
  name: string;
  color: string;
  note: string;
}

export const TIERS: Tier[] = [
  { max: 10, name: "咫尺", color: "#B7352B", note: "答案就在手边" },
  { max: 50, name: "毗邻", color: "#C4703A", note: "已在同一条街" },
  { max: 200, name: "相近", color: "#AE8A2C", note: "方向是对的" },
  { max: 1000, name: "沾边", color: "#6E8B52", note: "擦到了边缘" },
  { max: 5000, name: "疏远", color: "#4E7C93", note: "还隔着几重" },
  { max: Infinity, name: "天涯", color: "#4A5470", note: "换个思路吧" },
];

export function tierOf(rank: number): Tier {
  return TIERS.find((t) => rank <= t.max)!;
}

/**
 * 排名 → 亲近度百分比。
 *
 * 榜单是幂律分布的：#1 与 #50 的差别，远大于 #20000 与 #30000 的差别。
 * 所以取对数刻度，否则前一千名会全部挤在进度条最左端的一根头发丝里。
 */
export function nearness(rank: number, total: number): number {
  const span = Math.log(Math.max(total, 2));
  const pct = (1 - Math.log(Math.max(rank, 1)) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 昵称
//
// 昵称是整张卡片里唯一一处玩家能自由书写的文本，所以它也是唯一一处需要设防的
// 地方。转义挡得住尖括号，却挡不住方向控制符 —— 那不是可见字符，却能让它右边
// 的一整行倒着排：一个带 U+202E 的昵称足以把页脚翻成「1# 到跨步一 21# 从」。
// 图片和文本两条路都走这里收口。
// ─────────────────────────────────────────────────────────────────────────────

const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/** 剔掉不可见的方向控制符。任何要落到版面上的外来文本都先过一遍。 */
export function plain(s: any): string {
  return String(s ?? "").replace(BIDI, "");
}

/** 昵称的规范形态：去控制符、去首尾空白，空的记作无名氏。 */
export function nameOf(s: any): string {
  return plain(s).trim() || "无名氏";
}

export function esc(s: any): string {
  return plain(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─────────────────────────────────────────────────────────────────────────────
// 样式
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --paper:#F3EDE1;--paper-2:#EBE2D0;--ink:#241F1A;--ink-2:#6B6259;--ink-3:#9B9186;
  --rule:#D5CAB4;--seal:#B23A2E;
  --serif:"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","SimSun","宋体",serif;
  --num:Georgia,"Times New Roman","Songti SC",serif;
}
body{display:inline-block;background:#DED4C0;font-family:var(--serif);color:var(--ink);
  -webkit-font-smoothing:antialiased;font-kerning:normal}

/* 古籍双线框：外粗内细，中间留一线纸白 */
#card{display:inline-block;border:3px solid var(--ink);padding:5px;
  background:
    radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.55),rgba(255,255,255,0) 62%),
    repeating-linear-gradient(90deg,rgba(120,104,78,.030) 0 1px,transparent 1px 3px),
    repeating-linear-gradient(0deg,rgba(120,104,78,.022) 0 1px,transparent 1px 4px),
    var(--paper)}
.inner{border:1px solid var(--rule)}

/* ── 页眉 ─────────────────────────────────────────── */
.hd{position:relative;display:flex;align-items:center;gap:15px;padding:19px 22px 16px;
  border-bottom:1px solid var(--rule)}
/* 朱砂短线压在栏线上，像一枚书签 */
.hd::after{content:"";position:absolute;left:22px;bottom:-1px;width:54px;height:2px;background:var(--seal)}
.seal{width:52px;height:52px;flex:none;border-radius:2px;background:var(--seal);color:#F7F1E5;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  font-size:19px;font-weight:700;line-height:1.06;letter-spacing:.02em;
  box-shadow:inset 0 0 0 1.5px rgba(247,241,229,.6),inset 0 0 0 4px var(--seal)}
.brand .nm{font-size:26px;font-weight:700;letter-spacing:.3em;line-height:1.1}
.brand .py{margin-top:5px;font-family:var(--num);font-style:italic;font-size:10px;
  letter-spacing:.36em;color:var(--ink-3);text-transform:uppercase}
.brand .sub{margin-top:7px;font-size:12.5px;color:var(--ink-2);letter-spacing:.08em}
.hd-r{margin-left:auto;text-align:right;flex:none;padding-left:20px}
.hd-r .big{font-family:var(--num);font-size:31px;font-weight:700;line-height:1;color:var(--seal)}
.hd-r .cap{margin-top:7px;font-size:10.5px;letter-spacing:.2em;color:var(--ink-3)}

.pad{padding:20px 22px}

/* ── 田字格 ───────────────────────────────────────── */
.w{display:inline-flex;gap:4px;vertical-align:middle}
.ce{position:relative;display:flex;align-items:center;justify-content:center;flex:none;
  border:1px solid var(--rule);background:rgba(255,255,255,.42);line-height:1;font-weight:600}
.ce.on{background:#FFFCF4;border-color:#B9AC93}
/* 隐去的字：格子还在，中缝虚线还在，只是没落笔。不写问号 —— 空着的田字格
   本身就说明「这里有个字」，再压一个问号在中缝上只会把格子弄脏 */
.ce.mk{background:rgba(205,192,168,.32);border-style:dashed;border-color:#C0B399}
.ce.mk::before,.ce.mk::after{content:"";position:absolute}
.ce.mk::before{left:4px;right:4px;top:50%;border-top:1px dashed rgba(150,138,120,.55)}
.ce.mk::after{top:4px;bottom:4px;left:50%;border-left:1px dashed rgba(150,138,120,.55)}
/* 尺寸修饰类一律带 w- 前缀。裸的 sm/md/lg 会撞上页脚图例的 .lg —— 撞上那次，
   .lg i 的 display:block 盖掉了这里的 flex，答案字直接掉到格子左上角 */
.w-sm .ce{width:26px;height:26px;font-size:15px}
.w-md .ce{width:34px;height:34px;font-size:20px}
.w-lg{gap:9px}
.w-lg .ce{width:78px;height:78px;font-size:46px;border-width:1.5px}
.none{display:inline-block;color:var(--ink-3);font-size:13px;letter-spacing:.2em}

/* ── 猜测板 ───────────────────────────────────────── */
table{border-collapse:collapse;width:100%;min-width:640px}
thead th{padding:0 12px 10px;font-size:10.5px;font-weight:400;white-space:nowrap;
  letter-spacing:.2em;color:var(--ink-3);text-align:center}
thead th.no{text-align:left;letter-spacing:.1em}
thead th.mt,thead th.rk{text-align:right}
thead th em{font-style:normal;color:#BDB2A0}
tbody td{padding:8px 12px;border-top:1px solid var(--rule);vertical-align:middle}
tbody tr:first-child td{border-top:1px solid #C2B69E}
td.no{font-family:var(--num);font-size:13px;color:var(--ink-3);width:34px}
td.nb{text-align:center;width:74px}
td.gw{text-align:center}
td.rk{text-align:right;white-space:nowrap;width:86px}
td.rk .h{font-family:var(--num);font-size:13px;color:var(--ink-3);margin-right:1px}
td.rk b{font-family:var(--num);font-size:21px;font-weight:700;color:var(--tone)}
td.mt{width:150px}
.mt-in{display:flex;align-items:center;justify-content:flex-end;gap:9px}
.bar{position:relative;width:88px;height:6px;flex:none;background:rgba(36,31,26,.09)}
.fill{height:100%;background:var(--tone)}
.tag{width:2.4em;flex:none;font-size:12.5px;color:var(--tone);letter-spacing:.05em}
/* 最新一次猜测：左缘一道朱砂，底色向右洇开 */
tr.fresh{background:linear-gradient(90deg,rgba(178,58,46,.075),rgba(178,58,46,0) 58%)}
tr.fresh td:first-child{box-shadow:inset 3px 0 0 var(--seal)}
tr.gap td{padding:5px 12px;text-align:center;font-size:11.5px;color:var(--ink-3);letter-spacing:.3em}

/* ── 页脚 ─────────────────────────────────────────── */
.ft{display:flex;flex-wrap:wrap;align-items:center;gap:8px 13px;
  padding:12px 22px;border-top:1px solid var(--rule);background:rgba(36,31,26,.022)}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-2)}
.lg i{display:block;width:9px;height:9px;flex:none;background:var(--tone)}
.lg u{font-family:var(--num);text-decoration:none;color:var(--ink-3);font-size:11px}
/* 昵称的长短不由我们做主。中文能随处折行，一串不断行的西文却会把整条页脚顶出
   卡片 —— 而截图只裁到卡片边框，顶出去的部分连同后半句一起没了。所以给昵称
   一个上限，让它自己省略，把「拿下今日一词 · …」那半句留全 */
.lg .who{max-width:16em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tip{margin-left:auto;font-size:11.5px;color:var(--ink-3);letter-spacing:.05em}

/* ── 区块 ─────────────────────────────────────────── */
.sec{margin-top:19px}
.sec:first-child{margin-top:0}
.sec-t{display:flex;align-items:center;gap:9px;margin-bottom:11px;
  font-size:11.5px;letter-spacing:.24em;color:var(--ink-2)}
.sec-t i{width:6px;height:6px;flex:none;background:var(--seal)}
.sec-t s{flex:1;height:1px;text-decoration:none;
  background:repeating-linear-gradient(90deg,var(--rule) 0 3px,transparent 3px 7px)}
.panel{padding:14px 16px;background:rgba(255,255,255,.34);border:1px solid var(--rule)}
.row{display:flex;gap:12px;font-size:14px;line-height:1.75;color:var(--ink)}
.row+.row{margin-top:8px}
.row .k{flex:none;width:3.4em;color:var(--seal);letter-spacing:.1em}
.row .v{min-width:0}
.row .v em{font-style:normal;color:var(--ink-2)}
.cmd{font-family:var(--num);font-size:13.5px;padding:1px 7px;background:rgba(36,31,26,.06);
  border:1px solid var(--rule);white-space:nowrap}
.note{margin-top:11px;font-size:12px;color:var(--ink-3);line-height:1.7}
.note b{color:var(--ink-2)}

/* ── 揭晓 ─────────────────────────────────────────── */
.reveal{position:relative;display:flex;align-items:center;gap:22px;
  padding:22px;background:rgba(255,255,255,.4);border:1px solid var(--rule)}
.reveal .lead{font-size:11.5px;letter-spacing:.26em;color:var(--ink-3)}
.reveal .word{margin-top:12px}
.reveal .aside{margin-left:auto;text-align:right;max-width:290px}
.reveal .aside .q{font-size:13.5px;line-height:1.9;color:var(--ink-2)}
.near{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end;margin-top:12px}
.nw{padding:4px 10px;font-size:14px;color:var(--ink);background:rgba(255,255,255,.55);
  border:1px solid var(--rule)}
/* 骑在卡角上的一枚闲章 */
.stamp{position:absolute;right:16px;top:-13px;width:42px;height:42px;transform:rotate(-8deg);
  background:var(--seal);color:#F7F1E5;font-size:21px;font-weight:700;
  display:flex;align-items:center;justify-content:center;border-radius:2px;
  box-shadow:inset 0 0 0 1.5px rgba(247,241,229,.6),inset 0 0 0 4px var(--seal)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.stat{padding:12px 14px;background:rgba(255,255,255,.34);border:1px solid var(--rule)}
.stat .n{font-family:var(--num);font-size:23px;font-weight:700;line-height:1;color:var(--seal)}
.stat .n small{font-family:var(--serif);font-size:12px;font-weight:400;margin-left:3px;color:var(--ink-2)}
.stat .c{margin-top:7px;font-size:10.5px;letter-spacing:.16em;color:var(--ink-3)}

/* ── 排行榜 ───────────────────────────────────────── */
.rank{display:flex;flex-direction:column}
.ent{display:flex;align-items:center;gap:14px;padding:11px 4px;border-top:1px solid var(--rule)}
.ent:first-child{border-top:none}
.ent .pos{width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;
  font-family:var(--num);font-size:14px;font-weight:700;color:var(--ink-2);
  border:1px solid var(--rule);background:rgba(255,255,255,.4)}
/* 前三名换成朱砂 / 黛 / 赭三枚小印，不落金银铜的俗套 */
.ent.p1 .pos{background:var(--seal);color:#F7F1E5;border-color:var(--seal)}
.ent.p2 .pos{background:#4A5470;color:#F7F1E5;border-color:#4A5470}
.ent.p3 .pos{background:#9C7B4B;color:#F7F1E5;border-color:#9C7B4B}
/* 省略号只该吃掉名字，不该连「我」一起吃掉 —— 那个标记恰恰是名字长、人又多的
   时候最要紧的一处。所以裁剪只发生在名字自己那一层，标记留在外面不参与收缩 */
.ent .nm{display:flex;align-items:baseline;min-width:0;max-width:380px;font-size:15px}
.ent .nm .t{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ent .me{flex:none;margin-left:8px;font-size:10.5px;letter-spacing:.16em;color:var(--seal)}
/* 自己那一行淡淡洇一层朱砂，人多时一眼能找到 */
.ent.mine{background:linear-gradient(90deg,rgba(178,58,46,.07),rgba(178,58,46,0) 70%)}
.ent .sc{margin-left:auto;flex:none;font-family:var(--num);font-size:19px;font-weight:700}
.ent .sc small{font-family:var(--serif);font-size:11.5px;font-weight:400;color:var(--ink-3);margin-left:4px}
.more{padding:9px 4px 0;font-size:11.5px;color:var(--ink-3);letter-spacing:.1em}
.empty{padding:38px 20px;text-align:center;color:var(--ink-3);font-size:13.5px;line-height:2.1}
`;

// ─────────────────────────────────────────────────────────────────────────────
// 骨架
// ─────────────────────────────────────────────────────────────────────────────

function shell(body: string, width?: number): string {
  const w = width ? `width:${width}px` : "";
  return (
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${CSS}</style></head>` +
    `<body><div id="card" style="${w}"><div class="inner">${body}</div></div></body></html>`
  );
}

function header(sub: string, right?: { big: string; cap: string }): string {
  const aside = right
    ? `<div class="hd-r"><div class="big">${esc(right.big)}</div><div class="cap">${esc(
        right.cap
      )}</div></div>`
    : "";
  return `<header class="hd"><div class="seal"><span>词</span><span>意</span></div>
  <div class="brand"><div class="nm">词意</div><div class="py">ci&nbsp;yi</div>
  <div class="sub">${esc(sub)}</div></div>${aside}</header>`;
}

function footer(items: string, tip: string): string {
  return `<footer class="ft">${items}<div class="tip">${esc(tip)}</div></footer>`;
}

/** 档位区间的可读写法：最后一档没有上界，写成「5000+」。 */
function tierRange(i: number): string {
  return i === TIERS.length - 1 ? `${TIERS[i - 1].max}+` : `≤${TIERS[i].max}`;
}

function legend(): string {
  return TIERS.map(
    (t, i) =>
      `<div class="lg" style="--tone:${t.color}"><i></i><span>${t.name}</span><u>${tierRange(
        i
      )}</u></div>`
  ).join("");
}

/** 把一个词铺进田字格；mask 指定哪一格只留格子不落字。 */
function grid(
  word: string,
  opts: { mask?: number; size?: "sm" | "md" | "lg" } = {}
): string {
  const chars = Array.from(word || "");
  // 榜首与榜尾各缺一个邻居，用一道短横交代「这边没有了」，而不是再画一个空格子
  if (chars.length === 0) return `<span class="none">—</span>`;
  const cells = chars
    .map((ch, i) =>
      i === opts.mask ? `<i class="ce mk"></i>` : `<i class="ce on">${esc(ch)}</i>`
    )
    .join("");
  return `<span class="w w-${opts.size ?? "md"}">${cells}</span>`;
}

function section(title: string, body: string): string {
  return `<section class="sec"><div class="sec-t"><i></i><span>${esc(
    title
  )}</span><s></s></div>${body}</section>`;
}

function rows(list: [string, string][]): string {
  return `<div class="panel">${list
    .map(
      ([k, v]) =>
        `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`
    )
    .join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 猜测板
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardRow {
  history: History;
  /** 本次刚提交的那一条，单独点亮 */
  fresh?: boolean;
  /** 这一行之前被截断了多少条 */
  gapBefore?: number;
}

export interface BoardOptions {
  rows: BoardRow[];
  /** 榜单总词数，用于换算亲近度 */
  total: number;
  /** 本局累计猜了多少词（不受截断影响） */
  attempts: number;
  tip: string;
}

function boardRow({ history, fresh }: BoardRow, ordinal: number, total: number): string {
  const tier = tierOf(history.rank);
  const pct = nearness(history.rank, total);
  return (
    `<tr class="${fresh ? "fresh" : ""}" style="--tone:${tier.color}">` +
    `<td class="no">${String(ordinal).padStart(2, "0")}</td>` +
    `<td class="nb">${grid(history.leftHint, { mask: 0, size: "sm" })}</td>` +
    `<td class="gw">${grid(history.guess)}</td>` +
    `<td class="nb">${grid(history.rightHint, { mask: 1, size: "sm" })}</td>` +
    `<td class="rk"><span class="h">#</span><b>${history.rank}</b></td>` +
    `<td class="mt"><div class="mt-in"><div class="bar"><div class="fill" style="width:${pct}%"></div></div>` +
    `<span class="tag">${tier.name}</span></div></td>` +
    `</tr>`
  );
}

function boardTable(opts: BoardOptions): string {
  const head =
    `<thead><tr><th class="no">序</th><th>更近 <em>◀</em></th><th>猜测</th>` +
    `<th><em>▶</em> 更远</th><th class="rk">排名</th><th class="mt">亲疏</th></tr></thead>`;

  const body = opts.rows
    .map((row, i) => {
      // 断档处补一行省略记号，免得名次突然跳跃看起来像出了错
      const gap = row.gapBefore
        ? `<tr class="gap"><td colspan="6">⋯ 另有 ${row.gapBefore} 词未列 ⋯</td></tr>`
        : "";
      return gap + boardRow(row, i + 1, opts.total);
    })
    .join("");

  return `<table>${head}<tbody>${body}</tbody></table>`;
}

export function boardCard(opts: BoardOptions): string {
  const best = opts.rows.reduce((m, r) => Math.min(m, r.history.rank), Infinity);
  const body =
    header(`每日挑战 · 第 ${opts.attempts} 次猜测`, { big: `#${best}`, cap: "当前最佳" }) +
    `<div class="pad">${boardTable(opts)}</div>` +
    footer(legend(), opts.tip);
  return shell(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// 开局 / 帮助
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 规则里的示例不另画一套，直接借真正的猜测板渲染，所见即所得。
 * 但不加 fresh 标记 —— 那道朱砂在真正的板上表示「这是你刚猜的」，
 * 出现在说明书里只会让人以为它另有含义。
 */
function sampleBoard(total: number): string {
  return boardTable({
    rows: [
      { history: { guess: "企业", rank: 467, leftHint: "良好", rightHint: "地产" } },
    ],
    total,
    attempts: 1,
    tip: "",
  });
}

export interface StartOptions {
  total: number;
  words: number;
  /** 题库里还剩多少道没出过 */
  left: number;
}

export function startCard(opts: StartOptions): string {
  const body =
    header("每日挑战 · 今日题目已开", { big: "壹", cap: "今日一词" }) +
    `<div class="pad">` +
    section(
      "目标",
      rows([
        [
          "一词",
          `在 <em>${opts.words.toLocaleString()}</em> 个两字词里，找出今天被藏起来的那一个。`,
        ],
      ])
    ) +
    section(
      "反馈",
      `<div class="panel" style="padding:10px 12px 4px">${sampleBoard(opts.total)}
      <div class="note">排名是这个词与答案的意思有多近 —— <b>#1 就是答案本身</b>。<br>
      左右是它在榜单上的邻居，<b>左邻更近，右邻更远</b>；空着的田字格里各藏一字，<br>
      看得见方向，猜不到全貌。</div></div>`
    ) +
    section(
      "周期",
      rows([
        ["每日", "一词，猜中即封题，次日零点换新。"],
        [
          "记数",
          `猜中记入排行榜；题库尚余 <em>${opts.left.toLocaleString()}</em> 题未出。`,
        ],
      ])
    ) +
    `</div>` +
    footer(
      `<div class="lg"><span class="cmd">ciyi.猜 山水</span></div>
       <div class="lg" style="color:var(--ink-3)">提交一次猜测</div>`,
      "咫尺 · 毗邻 · 相近 · 沾边 · 疏远 · 天涯"
    );
  return shell(body, 720);
}

export interface IntroOptions {
  total: number;
  words: number;
  middleware: boolean;
}

export function introCard(opts: IntroOptions): string {
  const body =
    header("按意思远近找词 · 每日一题", {
      big: opts.words.toLocaleString(),
      cap: "词库容量",
    }) +
    `<div class="pad">` +
    section(
      "玩法",
      rows([
        ["其一", `<span class="cmd">ciyi.每日挑战</span>　开今天的题`],
        [
          "其二",
          `<span class="cmd">ciyi.猜 山水</span>　报一个两字词${
            opts.middleware ? "，也可以直接把词发出来" : ""
          }`,
        ],
        ["其三", `<span class="cmd">ciyi.排行榜</span>　看谁猜中得最多`],
      ])
    ) +
    section(
      "读板",
      `<div class="panel" style="padding:10px 12px 4px">${sampleBoard(opts.total)}
      <div class="note">这一行是说：「企业」与今日答案的意思相近程度，排在第 <b>467</b> 位。<br>
      两侧空着的格子里各藏着一个字：更近一位的词只露出「好」，更远一位的只露出「地」。<br>
      名次越小，离答案越近；<b>#1 就是答案本身</b>。</div></div>`
    ) +
    section(
      "亲疏",
      `<div class="panel" style="display:flex;flex-wrap:wrap;gap:11px 20px">${TIERS.map(
        (t, i) =>
          `<div class="lg" style="--tone:${t.color}"><i></i><span>${
            t.name
          }</span><u>${tierRange(i)}</u><span style="color:var(--ink-3)">${
            t.note
          }</span></div>`
      ).join("")}</div>`
    ) +
    `</div>` +
    footer(
      `<div class="lg" style="color:var(--ink-3)">一日一词，猜中即止，次日零点换题</div>`,
      "词库与语义排序来自「词影」"
    );
  return shell(body, 720);
}

// ─────────────────────────────────────────────────────────────────────────────
// 揭晓 / 排行榜
// ─────────────────────────────────────────────────────────────────────────────

export interface WinOptions {
  answer: string;
  attempts: number;
  /** 猜中之前最接近的一次排名；首猜即中时为空 */
  closest: number | null;
  /** 榜单上紧挨着答案的几个词，封题后一并奉上 */
  neighbors: string[];
  username: string;
  score: number;
}

export function winCard(opts: WinOptions): string {
  // 封题这一刻正是玩家最想知道「那它到底跟什么最像」的时候，
  // 榜单第 2 名往后本来就在手里，不给出来才是浪费。
  const aside = opts.neighbors.length
    ? `<div class="lead">意思最近的几个词</div>
       <div class="near">${opts.neighbors
         .map((w) => `<span class="nw">${esc(w)}</span>`)
         .join("")}</div>`
    : `<div class="q">今日一词，就此收笔。</div>`;

  const quip =
    opts.closest === null
      ? "一击即中，今日无需第二次落笔"
      : `从 #${opts.closest} 一步跨到 #1`;

  const body =
    header("每日挑战 · 已封题") +
    `<div class="pad">
      <div class="reveal"><div class="stamp">中</div>
        <div><div class="lead">今日答案</div><div class="word">${grid(opts.answer, {
          size: "lg",
        })}</div></div>
        <div class="aside">${aside}</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${
          opts.attempts
        }<small>次</small></div><div class="c">本局猜测</div></div>
        <div class="stat"><div class="n">${
          opts.closest === null ? "—" : "#" + opts.closest
        }</div><div class="c">此前最接近</div></div>
        <div class="stat"><div class="n">${
          opts.score
        }<small>次</small></div><div class="c">累计猜中</div></div>
      </div>
    </div>` +
    footer(
      `<div class="lg" style="color:var(--ink-2)"><span class="who">${esc(
        nameOf(opts.username)
      )}</span><span>拿下今日一词 · ${quip}</span></div>`,
      "明日零点换新题 · ciyi.排行榜"
    );
  return shell(body, 720);
}

export interface RankEntry {
  username: string;
  score: number;
  me?: boolean;
}

export interface RankOptions {
  entries: RankEntry[];
  hidden: number;
  /** 上榜总人数 */
  players: number;
}

export function rankCard(opts: RankOptions): string {
  const list = opts.entries.length
    ? `<div class="rank">${opts.entries
        .map(
          (e, i) =>
            `<div class="ent p${i + 1}${e.me ? " mine" : ""}"><div class="pos">${i + 1}</div>` +
            `<div class="nm"><span class="t">${esc(nameOf(e.username))}</span>${
              e.me ? `<span class="me">我</span>` : ""
            }</div>` +
            `<div class="sc">${e.score}<small>次</small></div></div>`
        )
        .join("")}${
        opts.hidden > 0 ? `<div class="more">⋯ 另有 ${opts.hidden} 人在榜</div>` : ""
      }</div>`
    : `<div class="empty">榜上无名。<br>今日第一个猜中的人，会写在这里。</div>`;

  const body =
    header("每日挑战 · 累计猜中", { big: String(opts.players), cap: "上榜人数" }) +
    `<div class="pad">${list}</div>` +
    footer(
      `<div class="lg" style="color:var(--ink-3)">每猜中一日之词，记一次</div>`,
      "ciyi.每日挑战"
    );
  return shell(body, 620);
}
