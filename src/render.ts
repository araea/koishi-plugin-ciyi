// ─────────────────────────────────────────────────────────────────────────────
// 词意 · 原生 Canvas 渲染
//
// 通过 Koishi 通用 Canvas 服务绘图；可复用 Puppeteer 已提供的服务。
// 坐标与文字宽度均由渲染器自身计算，不依赖浏览器布局或同步 measureText。
// ─────────────────────────────────────────────────────────────────────────────

import type CanvasService from "@koishijs/canvas";
import type { CanvasRenderingContext2D as SKRSContext2D } from "@koishijs/canvas";
import {
  EMPHASIZED_WEIGHT,
  FONT_STACK,
  lch,
  MEDAL,
  onColor,
  MONO_STACK,
  scheme,
  SHAPE,
  TYPE,
} from "./m3";
import {
  BoardOptions,
  BoardRow,
  IntroOptions,
  RankOptions,
  TIERS,
  Tier,
  WinOptions,
  nearness,
  tierOf,
} from "./view";

const SCALE = 2;

/** 词意取青绿主调：语义的「远近」是这套图的主题，冷色打底才衬得出近处的暖色。 */
const HUE = 196;
const SCHEME = scheme(HUE);

/**
 * 画布渲染拿不到 CSS 变量，这里把用得到的角色摊平成常量。
 * 名字与 `--md-sys-color-*` 一一对应，改主题只要动上面的 HUE。
 */
const C = {
  surface: SCHEME.surface,
  surfaceContainerLowest: SCHEME.surfaceContainerLowest,
  surfaceContainerLow: SCHEME.surfaceContainerLow,
  surfaceContainer: SCHEME.surfaceContainer,
  surfaceContainerHigh: SCHEME.surfaceContainerHigh,
  surfaceContainerHighest: SCHEME.surfaceContainerHighest,
  onSurface: SCHEME.onSurface,
  onSurfaceVariant: SCHEME.onSurfaceVariant,
  outline: SCHEME.outline,
  outlineVariant: SCHEME.outlineVariant,
  primary: SCHEME.primary,
  onPrimary: SCHEME.onPrimary,
  primaryContainer: SCHEME.primaryContainer,
  onPrimaryContainer: SCHEME.onPrimaryContainer,
  secondaryContainer: SCHEME.secondaryContainer,
  onSecondaryContainer: SCHEME.onSecondaryContainer,
};

/**
 * 刚落下的那一行的底色。取色调 94 的浅主色而不是 primaryContainer：
 * 这是整行的大面积填充，容器色那个饱和度会把行内的文字全部压住。
 */
const FRESH = lch(94, 14, HUE);

const FONT_SANS = FONT_STACK;
/**
 * 名次、次数、序号这类要对齐的数字走等宽栈；画布没有 `font-variant-numeric`，
 * 等宽本身就是对齐手段。尾部接上正文栈，汉字才不会掉出等宽那几支字体。
 */
const FONT_NUM = `${MONO_STACK},${FONT_STACK}`;

function s(n: number): number {
  return Math.round(n * SCALE);
}

/** 圆角矩形。画布里所有容器都走形状刻度，直角只留给分隔线。 */
function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillRound(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string
) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRound(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  width: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

function tierRange(i: number): string {
  return i === TIERS.length - 1 ? `${TIERS[i - 1].max}+` : `≤${TIERS[i].max}`;
}

/** CJK 在 em-box 里常偏下，按字号做轻微上移 */
function cjkOffset(fontSize: number): number {
  return -fontSize * 0.055;
}

function textCenter(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  cy: number,
  font: string,
  color: string,
  offsetY = 0
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + offsetY);
}

function textLeft(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  offsetY = 0
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + offsetY);
}

function textRight(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  offsetY = 0
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + offsetY);
}

/** 保持字号不变，在可用宽度内以省略号收口，避免动态文本挤到相邻栏。 */
function fontSizeOf(font: string): number {
  return Number(font.match(/([\d.]+)px/)?.[1] ?? s(TYPE.bodySmall.size));
}

/**
 * Puppeteer 的 Canvas 服务会批量转发绘图语句，不能同步返回 measureText。
 * 卡片只含短中文、数字和命令名，用稳定的字宽模型比强制浏览器往返更快也更通用。
 */
function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) units += 0.34;
    else if (cp >= 0x2e80 || cp > 0xffff) units += 1;
    else if (/[A-Z0-9#]/.test(ch)) units += 0.64;
    else if (/[a-z]/.test(ch)) units += 0.54;
    else units += 0.5;
  }
  return units * fontSize;
}

function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return "";
  if (textWidth(text, fontSize) <= maxWidth) return text;

  const chars = Array.from(text);
  const suffix = "…";
  if (textWidth(suffix, fontSize) > maxWidth) return "";

  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textWidth(chars.slice(0, mid).join("") + suffix, fontSize) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(0, low).join("") + suffix;
}

function textLeftFit(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: string,
  color: string,
  offsetY = 0
) {
  textLeft(ctx, ellipsize(text, maxWidth, fontSizeOf(font)), x, y, font, color, offsetY);
}

/*
 * 版式刻度（dp，乘 SCALE 后落到画布）。所有卡片共用：
 * 卡片外留白、内容左右内边距、区块间距、页头与页脚的尺寸都只在这里定义，
 * 量高与绘制用的是同一组常量，所以不会再出现「量出来的高度」和「画出来的内容」对不上的空白或重叠。
 */
const L = {
  margin: 16,
  pad: 24,
  gap: 20,
  headerTop: 20,
  seal: 48,
  headerBottom: 18,
  footerPadY: 14,
  footerLine: 20,
  sectionTitle: 20,
  sectionGap: 12,
};
const HEADER_H = L.headerTop + L.seal + L.headerBottom;

/** 四个角各自指定半径的圆角矩形；页脚要贴着卡片底部的圆角，上边却是直角。 */
function cornerRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

function hline(ctx: SKRSContext2D, x0: number, x1: number, y: number, color: string, dash?: number[]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = s(1);
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

/** 页脚的一行：左右两段；两段放不下一行时拆成两行，而不是把右边截成省略号。 */
type FooterLine = { left?: string; right?: string };
function footerRows(innerW: number, lines: FooterLine[]): FooterLine[] {
  const fs = s(TYPE.labelMedium.size);
  const avail = innerW - s(L.pad) * 2 - s(24);
  const rows: FooterLine[] = [];
  for (const line of lines) {
    const lw = line.left ? textWidth(line.left, fs) : 0;
    const rw = line.right ? textWidth(line.right, fs) : 0;
    if (line.left && line.right && lw + rw > avail) rows.push({ left: line.left }, { left: line.right });
    else rows.push(line);
  }
  return rows;
}
function footerHeight(innerW: number, lines: FooterLine[]): number {
  return s(L.footerPadY) * 2 + footerRows(innerW, lines).length * s(L.footerLine);
}
function drawFooter(ctx: SKRSContext2D, ix: number, iy: number, iw: number, ih: number, lines: FooterLine[]) {
  const rows = footerRows(iw, lines);
  const h = footerHeight(iw, lines);
  const y = iy + ih - h;
  const r = s(SHAPE.extraLarge);
  ctx.fillStyle = C.surfaceContainerLow;
  cornerRect(ctx, ix, y, iw, h, [0, 0, r, r]);
  ctx.fill();
  hline(ctx, ix, ix + iw, y, C.outlineVariant);
  const font = `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`;
  const maxW = iw - s(L.pad) * 2;
  rows.forEach((row, i) => {
    const cy = y + s(L.footerPadY) + s(L.footerLine) * (i + 0.5);
    if (row.left) textLeft(ctx, ellipsize(row.left, maxW, s(TYPE.labelMedium.size)), ix + s(L.pad), cy, font, C.onSurfaceVariant);
    if (row.right) textRight(ctx, row.right, ix + iw - s(L.pad), cy, font, C.onSurfaceVariant);
  });
}

async function toPng(
  service: CanvasService,
  innerW: number,
  innerH: number,
  draw: (ctx: SKRSContext2D, ix: number, iy: number, iw: number, ih: number) => void
): Promise<Buffer> {
  // 背景与卡片之间只留一圈留白，层次靠容器色差表达，不再套墨框
  const margin = s(L.margin);
  const canvasW = margin * 2 + innerW;
  const canvasH = margin * 2 + innerH;
  const canvas = await service.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  try {
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, canvasW, canvasH);
    fillRound(ctx, margin, margin, innerW, innerH, s(SHAPE.extraLarge), C.surfaceContainerLowest);
    draw(ctx, margin, margin, innerW, innerH);
    return await canvas.toBuffer("image/png");
  } finally {
    await canvas.dispose();
  }
}

/*
 * 三种格子：字号走 TYPE，字重取 EMPHASIZED_WEIGHT（格子里的字原本就是强调），
 * 圆角走 SHAPE —— 小格 extra-small，中格 small，大格 large。
 * 格子边长、间距与描边宽度是版式，维持原值。
 */
const GRID = {
  sm: {
    cell: 26, gap: 4, border: 1,
    font: TYPE.labelLarge.size, weight: EMPHASIZED_WEIGHT.label, radius: SHAPE.extraSmall,
  },
  md: {
    cell: 34, gap: 4, border: 1,
    font: TYPE.titleLarge.size, weight: EMPHASIZED_WEIGHT.title, radius: SHAPE.small,
  },
  lg: {
    cell: 78, gap: 9, border: 1.5,
    font: TYPE.displayMedium.size, weight: EMPHASIZED_WEIGHT.display, radius: SHAPE.large,
  },
} as const;

type GridSize = keyof typeof GRID;
type GridSpec = (typeof GRID)[GridSize];

function gridWidth(word: string, size: GridSize): number {
  const g = GRID[size];
  const n = Math.max(Array.from(word || "").length, 0);
  if (n === 0) return s(28);
  return s(g.cell * n + g.gap * (n - 1));
}

function drawGridCell(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  ch: string | null,
  mode: "on" | "mk",
  g: GridSpec
) {
  const half = size / 2;
  const radius = s(g.radius);

  if (mode === "mk") {
    fillRound(ctx, x, y, size, size, radius, C.surfaceContainerHighest);
    ctx.save();
    ctx.setLineDash([s(3), s(3)]);
    strokeRound(
      ctx,
      x + s(0.5),
      y + s(0.5),
      size - s(1),
      size - s(1),
      radius,
      C.outline,
      s(g.border)
    );
    ctx.restore();
    return;
  }

  fillRound(ctx, x, y, size, size, radius, C.surfaceContainerHigh);

  if (ch) {
    const fs = s(g.font);
    textCenter(
      ctx,
      ch,
      x + half,
      y + half,
      `${g.weight} ${fs}px ${FONT_SANS}`,
      C.onSurface,
      cjkOffset(fs)
    );
  }
}

function drawWordGrid(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  word: string,
  size: GridSize,
  mask?: number
): number {
  const g = GRID[size];
  const cell = s(g.cell);
  const gap = s(g.gap);
  const chars = Array.from(word || "");

  if (chars.length === 0) {
    textCenter(ctx, "—", x + s(14), y + cell / 2, `${s(TYPE.bodySmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    return s(28);
  }

  let cx = x;
  for (let i = 0; i < chars.length; i++) {
    if (i === mask) {
      drawGridCell(ctx, cx, y, cell, null, "mk", g);
    } else {
      drawGridCell(ctx, cx, y, cell, chars[i], "on", g);
    }
    cx += cell + gap;
  }
  return cell;
}

/** 页头左侧的字号印：实心主色圆角块 + 反白字。 */
function drawSeal(ctx: SKRSContext2D, x: number, y: number, size: number, lines: string[]) {
  fillRound(ctx, x, y, size, size, s(SHAPE.large), C.primary);
  const fs = s(TYPE.titleMedium.size);
  const lh = fs * 1.1;
  let cy = y + size / 2 - (lh * lines.length) / 2 + lh / 2;
  for (const line of lines) {
    textCenter(ctx, line, x + size / 2, cy, `${EMPHASIZED_WEIGHT.title} ${fs}px ${FONT_SANS}`, C.onPrimary, cjkOffset(fs));
    cy += lh;
  }
}

/** 页头：字号印、标题与副标题；右侧可放一个关键数字。底部一道整宽分隔线。 */
function drawHeader(
  ctx: SKRSContext2D,
  ix: number,
  iy: number,
  iw: number,
  sub: string,
  right?: { big: string; cap: string }
): number {
  const x = ix + s(L.pad);
  const top = iy + s(L.headerTop);
  const seal = s(L.seal);
  drawSeal(ctx, x, top, seal, ["词", "意"]);

  const tx = x + seal + s(16);
  const rightW = right
    ? Math.max(textWidth(right.big, s(TYPE.headlineMedium.size)), textWidth(right.cap, s(TYPE.labelMedium.size))) + s(24)
    : 0;
  textLeft(ctx, "词意", tx, top + s(14), `${EMPHASIZED_WEIGHT.headline} ${s(TYPE.titleLarge.size)}px ${FONT_SANS}`, C.onSurface);
  textLeftFit(ctx, sub, tx, top + s(37), ix + iw - s(L.pad) - rightW - tx, `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);

  if (right) {
    const rx = ix + iw - s(L.pad);
    textRight(ctx, right.big, rx, top + s(16), `${EMPHASIZED_WEIGHT.headline} ${s(TYPE.headlineMedium.size)}px ${FONT_NUM}`, C.primary);
    textRight(ctx, right.cap, rx, top + s(40), `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
  }

  hline(ctx, ix, ix + iw, iy + s(HEADER_H), C.outlineVariant);
  return s(HEADER_H);
}

/** 分节标题：主色短竖条 + 标签。不再拖一条到行尾的细线，分节靠下面的容器本身。 */
function drawSectionTitle(ctx: SKRSContext2D, x: number, y: number, title: string): number {
  const h = s(L.sectionTitle);
  fillRound(ctx, x, y + h / 2 - s(7), s(4), s(14), s(SHAPE.full), C.primary);
  textLeft(ctx, title, x + s(12), y + h / 2, `${EMPHASIZED_WEIGHT.title} ${s(TYPE.titleSmall.size)}px ${FONT_SANS}`, C.onSurface);
  return h + s(L.sectionGap);
}

function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
  fillRound(ctx, x, y, w, h, s(SHAPE.large), C.surfaceContainer);
}

const NEAR_BAR_W = 80;

/** 亲疏条：填充与轨道分成两段、中间空一道（M3 新版线性进度指示器），右侧写档名。 */
function drawNearBar(ctx: SKRSContext2D, x: number, y: number, pct: number, tier: Tier) {
  const barW = s(NEAR_BAR_W);
  const barH = s(8);
  const gap = s(3);
  const fillW = Math.max(barH, (barW * pct) / 100);
  const top = y - barH / 2;
  fillRound(ctx, x, top, fillW, barH, s(SHAPE.full), tier.color);
  if (fillW + gap < barW) {
    fillRound(ctx, x + fillW + gap, top, barW - fillW - gap, barH, s(SHAPE.full), C.surfaceContainerHighest);
  }
  textLeft(ctx, tier.name, x + barW + s(10), y, `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, tier.color);
}

/*
 * 猜测表。列宽按自然比例分配到可用宽度；表头一行、每条猜测一行、被折叠的区间一行（较矮）。
 * boardHeight() 与 drawBoardTable() 用同一组行高，量出来的就是画出来的。
 */
const TABLE = { head: 32, row: 56, gap: 32 };
const COLS = [
  { key: "no", label: "序", w: 30 },
  { key: "nb", label: "更近的词", w: 84 },
  { key: "gw", label: "猜测", w: 96 },
  { key: "fb", label: "更远的词", w: 84 },
  { key: "rk", label: "排名", w: 88 },
  { key: "mt", label: "亲疏", w: 136 },
] as const;

function boardHeight(rows: BoardRow[]): number {
  const gaps = rows.filter((r) => r.gapBefore).length;
  return s(TABLE.head) + rows.length * s(TABLE.row) + gaps * s(TABLE.gap);
}

function drawBoardTable(ctx: SKRSContext2D, x: number, y: number, w: number, rows: BoardRow[], total: number): number {
  const sum = COLS.reduce((a, c) => a + c.w, 0);
  const scale = w / s(sum);
  const edges: Record<string, { x: number; w: number }> = {};
  let cx = x;
  for (const col of COLS) {
    const cw = s(col.w) * scale;
    edges[col.key] = { x: cx, w: cw };
    cx += cw;
  }
  const mid = (key: string) => edges[key].x + edges[key].w / 2;
  const labelFont = `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`;
  const headY = y + s(TABLE.head) / 2;
  textLeft(ctx, "序", x + s(8), headY, labelFont, C.onSurfaceVariant);
  for (const col of COLS.slice(1, 5)) textCenter(ctx, col.label, mid(col.key), headY, labelFont, C.onSurfaceVariant);
  const meterW = s(NEAR_BAR_W) + s(10) + textWidth("咫尺", s(TYPE.labelLarge.size));
  const meterX = edges.mt.x + Math.max(0, (edges.mt.w - meterW) / 2);
  textCenter(ctx, "亲疏", meterX + meterW / 2, headY, labelFont, C.onSurfaceVariant);
  hline(ctx, x, x + w, y + s(TABLE.head), C.outline);

  let ry = y + s(TABLE.head);
  let ordinal = 0;
  for (const row of rows) {
    if (row.gapBefore) {
      // 折叠的区间：一行虚线中间嵌一句说明
      const cy = ry + s(TABLE.gap) / 2;
      const label = `中间还有 ${row.gapBefore} 词`;
      const lw = textWidth(label, s(TYPE.labelMedium.size)) + s(24);
      hline(ctx, x, x + w / 2 - lw / 2, cy, C.outlineVariant, [s(4), s(4)]);
      hline(ctx, x + w / 2 + lw / 2, x + w, cy, C.outlineVariant, [s(4), s(4)]);
      textCenter(ctx, label, x + w / 2, cy, labelFont, C.onSurfaceVariant);
      ry += s(TABLE.gap);
    } else if (ordinal > 0) {
      hline(ctx, x, x + w, ry, C.outlineVariant);
    }

    ordinal += 1;
    const { history, fresh } = row;
    const tier = tierOf(history.rank);
    const rowH = s(TABLE.row);
    const midY = ry + rowH / 2;

    if (fresh) {
      fillRound(ctx, x, ry + s(3), w, rowH - s(6), s(SHAPE.medium), FRESH);
      fillRound(ctx, x, ry + s(12), s(4), rowH - s(24), s(SHAPE.full), C.primary);
    }

    textLeft(ctx, String(ordinal).padStart(2, "0"), x + s(8), midY, `${s(TYPE.labelLarge.size)}px ${FONT_NUM}`, C.onSurfaceVariant);
    drawWordGrid(ctx, mid("nb") - gridWidth(history.leftHint, "sm") / 2, midY - s(GRID.sm.cell) / 2, history.leftHint, "sm", 0);
    drawWordGrid(ctx, mid("gw") - gridWidth(history.guess, "md") / 2, midY - s(GRID.md.cell) / 2, history.guess, "md");
    drawWordGrid(ctx, mid("fb") - gridWidth(history.rightHint, "sm") / 2, midY - s(GRID.sm.cell) / 2, history.rightHint, "sm", 1);

    const rankText = String(history.rank);
    const hashFs = s(TYPE.labelLarge.size);
    const rankFs = s(TYPE.titleLarge.size);
    const block = textWidth("#", hashFs) + s(2) + textWidth(rankText, rankFs);
    const left = mid("rk") - block / 2;
    textLeft(ctx, "#", left, midY, `${hashFs}px ${FONT_NUM}`, C.onSurfaceVariant);
    textLeft(ctx, rankText, left + textWidth("#", hashFs) + s(2), midY, `${EMPHASIZED_WEIGHT.title} ${rankFs}px ${FONT_NUM}`, tier.color);

    drawNearBar(ctx, meterX, midY, nearness(history.rank, total), tier);
    ry += rowH;
  }
  return ry - y;
}

/** 六档图例排成一行，等分宽度。 */
const LEGEND_H = 28;
function drawLegendRow(ctx: SKRSContext2D, x: number, y: number, w: number) {
  const slot = w / TIERS.length;
  const fs = s(TYPE.labelMedium.size);
  const cy = y + s(LEGEND_H) / 2;
  TIERS.forEach((tier, i) => {
    const label = `${tier.name} ${tierRange(i)}`;
    const itemW = s(8) + s(6) + textWidth(label, fs);
    const lx = x + slot * i + (slot - itemW) / 2;
    fillRound(ctx, lx, cy - s(4), s(8), s(8), s(SHAPE.full), tier.color);
    textLeft(ctx, tier.name, lx + s(14), cy, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
    textLeft(ctx, tierRange(i), lx + s(14) + textWidth(tier.name + " ", fs), cy, `${fs}px ${FONT_NUM}`, C.onSurfaceVariant);
  });
}

const BOARD_W = 680;

export function renderBoardCard(service: CanvasService, opts: BoardOptions): Promise<Buffer> {
  const innerW = s(BOARD_W);
  const footer: FooterLine[] = [{ left: opts.tip }];
  const tableH = boardHeight(opts.rows);
  const innerH = s(HEADER_H) + s(L.gap) + tableH + s(L.gap) + s(LEGEND_H) + s(L.gap) + footerHeight(innerW, footer);
  const best = opts.rows.length ? `#${opts.rows.reduce((m, r) => Math.min(m, r.history.rank), Infinity)}` : "—";

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, `每日挑战 · 第 ${opts.attempts} 次猜测`, { big: best, cap: "当前最佳" });
    y += s(L.gap);
    y += drawBoardTable(ctx, ix + s(L.pad), y, iw - s(L.pad) * 2, opts.rows, opts.total);
    y += s(L.gap);
    drawLegendRow(ctx, ix + s(L.pad), y, iw - s(L.pad) * 2);
    drawFooter(ctx, ix, iy, iw, ih, footer);
  });
}

export function renderIntroCard(service: CanvasService, opts: IntroOptions): Promise<Buffer> {
  const innerW = s(BOARD_W);
  const footer: FooterLine[] = [{ left: "一日一词，猜中即止，次日零点换题", right: "词库与语义排序来自「词影」" }];
  const usage = [
    ["开始", "ciyi.猜 山水", `开题并报一个两字词${opts.middleware ? "；开题后可直接发词" : ""}`],
    ["切换", "ciyi.裸词 开/关", "改本频道的续猜方式"],
    ["排行", "ciyi.排行榜", "看谁猜中得最多"],
  ];
  const notes = [
    "这一行是说：「企业」与今日答案的意思相近程度，排在第 467 位。",
    "两侧各藏一字：左边是比它更近的词，右边是比它更远的词。",
    "名次越小，离答案越近；#1 就是答案本身。",
  ];
  const sample: BoardRow[] = [{ history: { guess: "企业", rank: 467, leftHint: "良好", rightHint: "地产" } }];
  const panelPad = 16;
  const usageRow = 36;
  const noteLine = 22;
  const legendRow = 30;
  const sectionHead = s(L.sectionTitle) + s(L.sectionGap);
  const usageH = s(panelPad) * 2 + usage.length * s(usageRow);
  const readH = s(panelPad) * 2 + boardHeight(sample) + s(12) + notes.length * s(noteLine);
  const tierH = s(panelPad) * 2 + Math.ceil(TIERS.length / 2) * s(legendRow);
  const innerH = s(HEADER_H) + s(L.gap)
    + sectionHead + usageH + s(L.gap)
    + sectionHead + readH + s(L.gap)
    + sectionHead + tierH + s(L.gap)
    + footerHeight(innerW, footer);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    const x = ix + s(L.pad);
    const w = iw - s(L.pad) * 2;
    let y = iy + drawHeader(ctx, ix, iy, iw, "按意思远近找词 · 每日一题", { big: opts.words.toLocaleString(), cap: "词库容量" });
    y += s(L.gap);

    y += drawSectionTitle(ctx, x, y, "玩法");
    drawPanel(ctx, x, y, w, usageH);
    usage.forEach(([key, command, desc], i) => {
      const cy = y + s(panelPad) + s(usageRow) * (i + 0.5);
      textLeft(ctx, key, x + s(panelPad), cy, `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, C.primary);
      textLeft(ctx, command, x + s(72), cy, `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`, C.onSurface);
      textLeftFit(ctx, desc, x + s(200), cy, w - s(200) - s(panelPad), `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    });
    y += usageH + s(L.gap);

    y += drawSectionTitle(ctx, x, y, "读板");
    drawPanel(ctx, x, y, w, readH);
    let ry = y + s(panelPad);
    ry += drawBoardTable(ctx, x + s(panelPad), ry, w - s(panelPad) * 2, sample, opts.total) + s(12);
    for (const note of notes) {
      textLeftFit(ctx, note, x + s(panelPad), ry + s(noteLine) / 2, w - s(panelPad) * 2, `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
      ry += s(noteLine);
    }
    y += readH + s(L.gap);

    y += drawSectionTitle(ctx, x, y, "亲疏");
    drawPanel(ctx, x, y, w, tierH);
    const colW = (w - s(panelPad) * 2) / 2;
    const fs = s(TYPE.bodyMedium.size);
    TIERS.forEach((tier, i) => {
      const cx = x + s(panelPad) + (i % 2) * colW;
      const cy = y + s(panelPad) + s(legendRow) * (Math.floor(i / 2) + 0.5);
      fillRound(ctx, cx, cy - s(5), s(10), s(10), s(SHAPE.full), tier.color);
      textLeft(ctx, tier.name, cx + s(18), cy, `${EMPHASIZED_WEIGHT.label} ${fs}px ${FONT_SANS}`, tier.color);
      textLeft(ctx, tierRange(i), cx + s(60), cy, `${fs}px ${FONT_NUM}`, C.onSurfaceVariant);
      textLeftFit(ctx, tier.note, cx + s(124), cy, colW - s(132), `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
    });

    drawFooter(ctx, ix, iy, iw, ih, footer);
  });
}

export function renderWinCard(service: CanvasService, opts: WinOptions): Promise<Buffer> {
  const innerW = s(BOARD_W);
  const quip = opts.closest === null ? "一击即中，今日无需第二次落笔" : `从 #${opts.closest} 一步跨到 #1`;
  const footer: FooterLine[] = [
    { left: `${opts.username} 拿下今日一词 · ${quip}` },
    { left: opts.canStartToday ? "发送「ciyi.猜 两字词」开启今日新题" : "明日零点换新题 · 发送「ciyi.排行榜」看看榜单" },
  ];

  // 答案面板：左边是答案大字格，右边是意思最近的词（药丸 chip，按宽度换行）
  const panelPad = 20;
  const labelH = 20;
  const answerW = gridWidth(opts.answer, "lg");
  const chipH = 32;
  const chipGap = 8;
  const chipFs = s(TYPE.labelLarge.size);
  const w = innerW - s(L.pad) * 2;
  const rightX = s(panelPad) + answerW + s(32);
  const rightW = w - rightX - s(panelPad);
  const chips: { word: string; x: number; row: number; w: number }[] = [];
  let cx = 0;
  let row = 0;
  for (const word of opts.neighbors) {
    const fitted = ellipsize(word, s(120), chipFs);
    const cw = textWidth(fitted, chipFs) + s(28);
    if (cx > 0 && cx + cw > rightW) { cx = 0; row += 1; }
    chips.push({ word: fitted, x: cx, row, w: cw });
    cx += cw + s(chipGap);
  }
  const chipRows = chips.length ? row + 1 : 1;
  const leftH = s(labelH) + s(12) + s(GRID.lg.cell);
  const rightH = s(labelH) + s(12) + chipRows * s(chipH) + (chipRows - 1) * s(chipGap);
  const revealH = s(panelPad) * 2 + Math.max(leftH, rightH);
  const statH = 76;
  const innerH = s(HEADER_H) + s(L.gap) + revealH + s(12) + s(statH) + s(L.gap) + footerHeight(innerW, footer);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    const x = ix + s(L.pad);
    let y = iy + drawHeader(ctx, ix, iy, iw, "每日挑战 · 已猜中");
    y += s(L.gap);

    drawPanel(ctx, x, y, w, revealH);
    const top = y + s(panelPad);
    const labelFont = `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`;
    textLeft(ctx, "今日答案", x + s(panelPad), top + s(labelH) / 2, labelFont, C.onSurfaceVariant);
    drawWordGrid(ctx, x + s(panelPad), top + s(labelH) + s(12), opts.answer, "lg");

    const rx = x + rightX;
    if (chips.length) {
      textLeft(ctx, "意思最近的词", rx, top + s(labelH) / 2, labelFont, C.onSurfaceVariant);
      const chipTop = top + s(labelH) + s(12);
      for (const chip of chips) {
        const cy = chipTop + chip.row * (s(chipH) + s(chipGap));
        fillRound(ctx, rx + chip.x, cy, chip.w, s(chipH), s(SHAPE.full), C.secondaryContainer);
        textCenter(ctx, chip.word, rx + chip.x + chip.w / 2, cy + s(chipH) / 2, `${chipFs}px ${FONT_SANS}`, C.onSecondaryContainer, cjkOffset(chipFs));
      }
    } else {
      textLeft(ctx, "今日一词，就此收笔。", rx, top + s(labelH) + s(12) + s(GRID.lg.cell) / 2, `${s(TYPE.bodyLarge.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    }
    y += revealH + s(12);

    const stats = [
      { n: String(opts.attempts), u: "次", c: "本局猜测" },
      { n: opts.closest === null ? "—" : `#${opts.closest}`, u: "", c: "此前最接近" },
      { n: String(opts.score), u: "次", c: "累计猜中" },
    ];
    const statW = (w - s(12) * 2) / 3;
    stats.forEach((stat, i) => {
      const sx = x + i * (statW + s(12));
      drawPanel(ctx, sx, y, statW, s(statH));
      const numFs = s(TYPE.headlineSmall.size);
      textLeft(ctx, stat.n, sx + s(16), y + s(28), `${EMPHASIZED_WEIGHT.headline} ${numFs}px ${FONT_NUM}`, C.primary);
      if (stat.u) textLeft(ctx, stat.u, sx + s(16) + textWidth(stat.n, numFs) + s(4), y + s(31), `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
      textLeft(ctx, stat.c, sx + s(16), y + s(56), `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    });

    drawFooter(ctx, ix, iy, iw, ih, footer);
  });
}

export function renderRankCard(service: CanvasService, opts: RankOptions): Promise<Buffer> {
  const innerW = s(600);
  const footer: FooterLine[] = [{ left: "每猜中一日之词，记一次", right: "发送「ciyi.猜 两字词」参与" }];
  const rowH = 56;
  const hiddenH = opts.hidden > 0 ? 40 : 0;
  const emptyH = 96;
  const contentH = opts.entries.length ? s(8) * 2 + opts.entries.length * s(rowH) + s(hiddenH) : s(emptyH);
  const innerH = s(HEADER_H) + s(L.gap) + contentH + s(L.gap) + footerHeight(innerW, footer);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    const x = ix + s(L.pad);
    const w = iw - s(L.pad) * 2;
    let y = iy + drawHeader(ctx, ix, iy, iw, "每日挑战 · 累计猜中", { big: String(opts.players), cap: "上榜人数" });
    y += s(L.gap);
    drawPanel(ctx, x, y, w, contentH);

    if (!opts.entries.length) {
      textCenter(ctx, "排行榜还空着", x + w / 2, y + s(34), `${EMPHASIZED_WEIGHT.title} ${s(TYPE.titleMedium.size)}px ${FONT_SANS}`, C.onSurface);
      textCenter(ctx, "今日第一个猜中的人，会写在这里。", x + w / 2, y + s(62), `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    } else {
      const left = x + s(16);
      const right = x + w - s(16);
      let ry = y + s(8);
      opts.entries.forEach((e, i) => {
        const midY = ry + s(rowH) / 2;
        if (e.me) fillRound(ctx, x + s(6), ry + s(3), w - s(12), s(rowH) - s(6), s(SHAPE.medium), FRESH);
        if (i > 0 && !e.me && !opts.entries[i - 1].me) hline(ctx, left, right, ry, C.outlineVariant);

        // 前三名用固定的金银铜；名次的含义不该跟着主题色变
        const podium = [MEDAL.gold, MEDAL.silver, MEDAL.bronze];
        const pc = i < 3 ? { bg: podium[i], fg: onColor(podium[i]) } : { bg: C.surfaceContainerHighest, fg: C.onSurfaceVariant };
        const pos = s(32);
        fillRound(ctx, left, midY - pos / 2, pos, pos, s(SHAPE.full), pc.bg);
        textCenter(ctx, String(i + 1), left + pos / 2, midY, `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelLarge.size)}px ${FONT_NUM}`, pc.fg);

        const score = String(e.score);
        const scoreFs = s(TYPE.titleLarge.size);
        const unitFs = s(TYPE.labelLarge.size);
        const scoreRight = right - textWidth("次", unitFs) - s(6);
        const nameX = left + pos + s(14);
        const meW = e.me ? textWidth("我", s(TYPE.labelMedium.size)) + s(20) : 0;
        const nameFs = s(TYPE.titleMedium.size);
        const name = ellipsize(e.username || "无名氏", scoreRight - textWidth(score, scoreFs) - s(20) - nameX - meW, nameFs);
        textLeft(ctx, name, nameX, midY, `${nameFs}px ${FONT_SANS}`, C.onSurface);
        if (e.me) {
          const bx = nameX + textWidth(name, nameFs) + s(8);
          fillRound(ctx, bx, midY - s(10), meW - s(8), s(20), s(SHAPE.full), C.primary);
          textCenter(ctx, "我", bx + (meW - s(8)) / 2, midY, `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelMedium.size)}px ${FONT_SANS}`, C.onPrimary);
        }
        textRight(ctx, score, scoreRight, midY, `${EMPHASIZED_WEIGHT.title} ${scoreFs}px ${FONT_NUM}`, C.onSurface);
        textRight(ctx, "次", right, midY, `${unitFs}px ${FONT_SANS}`, C.onSurfaceVariant);
        ry += s(rowH);
      });
      if (opts.hidden > 0) {
        textCenter(ctx, `另有 ${opts.hidden} 人在榜`, x + w / 2, ry + s(hiddenH) / 2, `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
      }
    }

    drawFooter(ctx, ix, iy, iw, ih, footer);
  });
}
