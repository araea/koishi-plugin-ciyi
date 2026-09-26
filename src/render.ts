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

/** 卡片本体：一块比背景高一档的表面，圆角走 extra-large。 */
function drawCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
  fillRound(ctx, x, y, w, h, s(SHAPE.extraLarge), C.surfaceContainerLowest);
}

async function toPng(
  service: CanvasService,
  innerW: number,
  innerH: number,
  draw: (ctx: SKRSContext2D, ix: number, iy: number, iw: number, ih: number) => void
): Promise<Buffer> {
  // 背景与卡片之间只留一圈留白，层次靠容器色差表达，不再套墨框
  const margin = s(18);
  const canvasW = margin * 2 + innerW;
  const canvasH = margin * 2 + innerH;
  const canvas = await service.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  try {
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, canvasW, canvasH);
    drawCard(ctx, margin, margin, innerW, innerH);
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

/** 结果图右上角那枚标记块：实心主色 + 反白字，形状走 extra-large。 */
function drawSeal(ctx: SKRSContext2D, x: number, y: number, size: number, lines: string[]) {
  fillRound(ctx, x, y, size, size, s(SHAPE.extraLarge), C.primary);

  // 印章里是插件的字号标记，走 title 档；两行的行距仍是版式，维持 ×1.06
  const fs = s(TYPE.titleLarge.size);
  const lh = fs * 1.06;
  const total = lh * lines.length;
  let cy = y + size / 2 - total / 2 + lh / 2;
  for (const line of lines) {
    textCenter(ctx, line, x + size / 2, cy, `${EMPHASIZED_WEIGHT.title} ${fs}px ${FONT_SANS}`, C.onPrimary);
    cy += lh;
  }
}

function drawHeader(
  ctx: SKRSContext2D,
  innerX: number,
  innerY: number,
  innerW: number,
  sub: string,
  right?: { big: string; cap: string }
): number {
  const padX = s(22);
  const padTop = s(19);
  const padBottom = s(16);
  const sealSize = s(52);
  const h = padTop + sealSize + padBottom;

  drawSeal(ctx, innerX + padX, innerY + padTop, sealSize, ["词", "意"]);

  const brandX = innerX + padX + sealSize + s(15);
  textLeft(
    ctx,
    "词意",
    brandX,
    innerY + padTop + s(14),
    `${EMPHASIZED_WEIGHT.headline} ${s(TYPE.headlineMedium.size)}px ${FONT_SANS}`,
    C.onSurface
  );
  textLeft(
    ctx,
    "ci yi",
    brandX,
    innerY + padTop + s(36),
    `italic ${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
    C.onSurfaceVariant
  );
  const subRight = right ? innerX + innerW - padX - s(150) : innerX + innerW - padX;
  textLeftFit(
    ctx,
    sub,
    brandX,
    innerY + padTop + s(58),
    subRight - brandX,
    `${s(TYPE.bodySmall.size)}px ${FONT_SANS}`,
    C.onSurfaceVariant
  );

  if (right) {
    const rx = innerX + innerW - padX;
    textRight(
      ctx,
      right.big,
      rx,
      innerY + padTop + s(16),
      `${EMPHASIZED_WEIGHT.headline} ${s(TYPE.headlineLarge.size)}px ${FONT_NUM}`,
      C.primary
    );
    textRight(
      ctx,
      right.cap,
      rx,
      innerY + padTop + s(44),
      `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
  }

  const lineY = innerY + h;
  ctx.strokeStyle = C.outlineVariant;
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(innerX, lineY);
  ctx.lineTo(innerX + innerW, lineY);
  ctx.stroke();

  // 标题下那道主色短线，圆头
  fillRound(ctx, innerX + padX, lineY - s(1.5), s(54), s(3), s(SHAPE.full), C.primary);

  return h;
}

function drawFooter(
  ctx: SKRSContext2D,
  innerX: number,
  y: number,
  innerW: number,
  legendItems: { tier: Tier; range: string }[],
  tip: string
): number {
  const padX = s(22);
  const padY = s(12);
  const h = s(36);

  // 图例带比卡片低一档并向内收一点，四角才不会顶出卡片的圆角
  const inset = s(10);
  fillRound(
    ctx,
    innerX + inset,
    y,
    innerW - inset * 2,
    h + padY * 2,
    s(SHAPE.large),
    C.surfaceContainerLow
  );

  ctx.strokeStyle = C.outlineVariant;
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(innerX, y);
  ctx.lineTo(innerX + innerW, y);
  ctx.stroke();

  let lx = innerX + padX;
  const cy = y + padY + h / 2;
  for (const { tier, range } of legendItems) {
    fillRound(ctx, lx, cy - s(4.5), s(9), s(9), s(SHAPE.full), tier.color);
    lx += s(9) + s(6);
    textLeft(ctx, tier.name, lx, cy, `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    lx += textWidth(tier.name, s(TYPE.labelSmall.size)) + s(4);
    textLeft(ctx, range, lx, cy, `${s(TYPE.labelSmall.size)}px ${FONT_NUM}`, C.onSurfaceVariant);
    lx += textWidth(range, s(TYPE.labelSmall.size)) + s(13);
  }

  const tipFont = `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`;
  const maxTipWidth = legendItems.length ? s(145) : innerW - padX * 2;
  textRight(
    ctx,
    ellipsize(tip, maxTipWidth, s(TYPE.labelSmall.size)),
    innerX + innerW - padX,
    cy,
    tipFont,
    C.onSurfaceVariant
  );

  return h + padY * 2;
}

function drawLegendFull(ctx: SKRSContext2D, x: number, y: number, w: number): number {
  const colW = w / 2;
  const rowH = s(30);
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    const cx = x + (i % 2) * colW;
    const cy = y + Math.floor(i / 2) * rowH;
    fillRound(ctx, cx, cy - s(4.5), s(9), s(9), s(SHAPE.full), t.color);
    textLeft(ctx, t.name, cx + s(15), cy, `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    textLeft(ctx, tierRange(i), cx + s(52), cy, `${s(TYPE.labelSmall.size)}px ${FONT_NUM}`, C.onSurfaceVariant);
    textLeft(ctx, t.note, cx + s(100), cy, `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
  }
  return rowH * Math.ceil(TIERS.length / 2) + s(8);
}

function drawSectionTitle(ctx: SKRSContext2D, x: number, y: number, w: number, title: string): number {
  // 标题前的短竖条是主色，和正文的中性色拉开，一眼看得出这是分节
  fillRound(ctx, x, y - s(1), s(3), s(12), s(SHAPE.full), C.primary);
  textLeft(
    ctx,
    title,
    x + s(15),
    y + s(5),
    `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelMedium.size)}px ${FONT_SANS}`,
    C.onSurfaceVariant
  );
  const tw = textWidth(title, s(TYPE.labelMedium.size));
  ctx.strokeStyle = C.outlineVariant;
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(x + s(15) + tw + s(9), y + s(5));
  ctx.lineTo(x + w, y + s(5));
  ctx.stroke();
  return s(24);
}

function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
  fillRound(ctx, x, y, w, h, s(SHAPE.large), C.surfaceContainer);
}

function drawNearBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  pct: number,
  tier: Tier
) {
  const barW = s(88);
  const barH = s(8);
  const gap = s(3);
  const fillW = Math.max(barH, (barW * pct) / 100);
  const top = y - barH / 2;

  // 填充与轨道分成两段，中间空一道——M3 新版进度指示器就长这样，两段都是全圆头
  fillRound(ctx, x, top, fillW, barH, s(SHAPE.full), tier.color);
  if (fillW + gap < barW) {
    fillRound(
      ctx,
      x + fillW + gap,
      top,
      barW - fillW - gap,
      barH,
      s(SHAPE.full),
      C.surfaceContainerHighest
    );
  }
  textLeft(
    ctx,
    tier.name,
    x + barW + s(9),
    y,
    `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelMedium.size)}px ${FONT_SANS}`,
    tier.color
  );
}

function measureBoard(opts: BoardOptions): { innerW: number; innerH: number; rowH: number } {
  const innerW = s(680);
  const rowH = s(50);
  const gapH = s(28);
  const headerH = s(87);
  const tableHeadH = s(32);
  const padV = s(20);
  const footerH = s(60);
  let rows = opts.rows.length;
  for (const r of opts.rows) if (r.gapBefore) rows += 1;
  const innerH = headerH + padV + tableHeadH + rows * rowH + (rows > 0 ? 0 : gapH) + padV + footerH;
  return { innerW, innerH, rowH };
}

function drawBoardTable(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  opts: BoardOptions,
  rowH: number
): number {
  // 左侧 accent 槽，其余宽度按比例均分给六列，避免左空或右空。
  const accentW = s(3);
  const gutter = s(10);
  const tableW = w - s(44);
  const cx = x + s(22);
  const usable = Math.max(tableW - gutter, s(1));
  const natural = [32, 72, 88, 72, 72, 148];
  const naturalSum = natural.reduce((a, b) => a + b, 0);
  const scale = usable / naturalSum;
  const cols = {
    no: natural[0] * scale,
    nb: natural[1] * scale,
    gw: natural[2] * scale,
    rk: natural[4] * scale,
    mt: natural[5] * scale,
  };
  const bx = cx + gutter;
  const nb0 = bx + cols.no;
  const gw0 = nb0 + cols.nb;
  const nb1 = gw0 + cols.gw;
  const rk0 = nb1 + cols.nb;
  const mt0 = rk0 + cols.rk;
  const noX = bx + s(2);
  const meterBlockW = s(88) + s(9) + textWidth("咫尺", s(TYPE.labelMedium.size));
  const mtX = mt0 + Math.max(0, (cols.mt - meterBlockW) / 2);

  const headY = y;
  const fs = s(TYPE.labelSmall.size);
  textLeft(ctx, "序", noX, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
  textCenter(ctx, "更近 ◀", nb0 + cols.nb / 2, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
  textCenter(ctx, "猜测", gw0 + cols.gw / 2, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
  textCenter(ctx, "▶ 更远", nb1 + cols.nb / 2, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
  textCenter(ctx, "排名", rk0 + cols.rk / 2, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);
  textCenter(ctx, "亲疏", mt0 + cols.mt / 2, headY, `${fs}px ${FONT_SANS}`, C.onSurfaceVariant);

  let ry = y + s(22);
  let ordinal = 0;

  for (const row of opts.rows) {
    if (row.gapBefore) {
      ry += s(8);
      textCenter(
        ctx,
        `…… 另有 ${row.gapBefore} 词未列`,
        cx + tableW / 2,
        ry + s(10),
        `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
        C.onSurfaceVariant
      );
      ctx.strokeStyle = C.outlineVariant;
      ctx.beginPath();
      ctx.moveTo(cx, ry + s(20));
      ctx.lineTo(cx + tableW, ry + s(20));
      ctx.stroke();
      ry += s(28);
    }

    ordinal += 1;
    const { history, fresh } = row;
    const tier = tierOf(history.rank);
    const pct = nearness(history.rank, opts.total);
    const midY = ry + rowH / 2;

    if (fresh) {
      fillRound(ctx, cx, ry, tableW, rowH, s(SHAPE.medium), FRESH);
      // 行首那道主色标记也收成圆头，和整行的圆角对齐
      fillRound(ctx, cx, ry + s(4), accentW, rowH - s(8), s(SHAPE.full), C.primary);
    }

    ctx.strokeStyle = ordinal === 1 ? C.outline : C.outlineVariant;
    ctx.lineWidth = s(1);
    ctx.beginPath();
    ctx.moveTo(cx, ry);
    ctx.lineTo(cx + tableW, ry);
    ctx.stroke();

    textLeft(
      ctx,
      String(ordinal).padStart(2, "0"),
      noX,
      midY,
      `${s(TYPE.labelMedium.size)}px ${FONT_NUM}`,
      C.onSurfaceVariant
    );

    const nbX = nb0 + (cols.nb - gridWidth(history.leftHint, "sm")) / 2;
    drawWordGrid(ctx, nbX, midY - s(13), history.leftHint, "sm", 0);

    const gwX = gw0 + (cols.gw - gridWidth(history.guess, "md")) / 2;
    drawWordGrid(ctx, gwX, midY - s(17), history.guess, "md");

    const rbX = nb1 + (cols.nb - gridWidth(history.rightHint, "sm")) / 2;
    drawWordGrid(ctx, rbX, midY - s(13), history.rightHint, "sm", 1);

    const rankText = String(history.rank);
    const rankFont = `${EMPHASIZED_WEIGHT.title} ${s(TYPE.titleLarge.size)}px ${FONT_NUM}`;
    const rankWidth = textWidth(rankText, s(TYPE.titleLarge.size));
    const hashW = textWidth("#", s(TYPE.labelMedium.size));
    const rankBlock = hashW + s(3) + rankWidth;
    const rankLeft = rk0 + (cols.rk - rankBlock) / 2;
    textLeft(ctx, "#", rankLeft, midY, `${s(TYPE.labelMedium.size)}px ${FONT_NUM}`, C.onSurfaceVariant);
    textLeft(ctx, rankText, rankLeft + hashW + s(3), midY, rankFont, tier.color);

    drawNearBar(ctx, mtX, midY, pct, tier);

    ry += rowH;
  }

  return ry - y;
}

export function renderBoardCard(service: CanvasService, opts: BoardOptions): Promise<Buffer> {
  const { innerW, innerH, rowH } = measureBoard(opts);
  const best = opts.rows.length
    ? `#${opts.rows.reduce((m, r) => Math.min(m, r.history.rank), Infinity)}`
    : "—";

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, `每日挑战 · 第 ${opts.attempts} 次猜测`, {
      big: best,
      cap: "当前最佳",
    });
    y += s(20);
    drawBoardTable(ctx, ix, y, iw, opts, rowH);
    drawFooter(
      ctx,
      ix,
      iy + ih - s(60),
      iw,
      TIERS.map((tier, i) => ({ tier, range: tierRange(i) })),
      opts.tip
    );
  });
}

export function renderIntroCard(service: CanvasService, opts: IntroOptions): Promise<Buffer> {
  const innerW = s(720);
  // 所有区块按真实占用高度累加，页脚与最后一块之间保留完整呼吸区。
  const innerH = s(716);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, "按意思远近找词 · 每日一题", {
      big: opts.words.toLocaleString(),
      cap: "词库容量",
    });
    y += s(20);

    y += drawSectionTitle(ctx, ix + s(22), y, iw - s(44), "玩法");
    y += s(11);
    const p1h = s(104);
    drawPanel(ctx, ix + s(22), y, iw - s(44), p1h);
    textLeft(ctx, "开始", ix + s(38), y + s(24), `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, C.primary);
    textLeft(
      ctx,
      "ciyi.猜 山水",
      ix + s(96),
      y + s(24),
      `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    textLeftFit(
      ctx,
      `开题并报一个两字词${opts.middleware ? "；开题后可直接发词" : ""}`,
      ix + s(230),
      y + s(24),
      iw - s(268),
      `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    textLeft(ctx, "切换", ix + s(38), y + s(52), `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, C.primary);
    textLeft(
      ctx,
      "ciyi.裸词 开/关",
      ix + s(96),
      y + s(52),
      `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    textLeftFit(
      ctx,
      "临时改本频道的续猜方式",
      ix + s(230),
      y + s(52),
      iw - s(268),
      `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    textLeft(ctx, "排行", ix + s(38), y + s(80), `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`, C.primary);
    textLeft(
      ctx,
      "ciyi.排行榜",
      ix + s(96),
      y + s(80),
      `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    textLeft(
      ctx,
      "看谁猜中得最多",
      ix + s(230),
      y + s(80),
      `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
      C.onSurface
    );
    y += p1h + s(19);

    y += drawSectionTitle(ctx, ix + s(22), y, iw - s(44), "读板");
    y += s(11);
    const sampleH = s(172);
    drawPanel(ctx, ix + s(22), y, iw - s(44), sampleH);
    drawBoardTable(
      ctx,
      ix + s(22),
      y + s(10),
      iw - s(44),
      {
        rows: [{ history: { guess: "企业", rank: 467, leftHint: "良好", rightHint: "地产" } }],
        total: opts.total,
        attempts: 1,
        tip: "",
      },
      s(50)
    );
    textLeft(
      ctx,
      "这一行是说：「企业」与今日答案的意思相近程度，排在第 467 位。",
      ix + s(38),
      y + s(104),
      `${s(TYPE.bodySmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
    textLeft(
      ctx,
      "两侧空格各藏一字：左邻更近，右邻更远。",
      ix + s(38),
      y + s(126),
      `${s(TYPE.bodySmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
    textLeft(
      ctx,
      "名次越小，离答案越近；#1 就是答案本身。",
      ix + s(38),
      y + s(148),
      `${s(TYPE.bodySmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
    y += sampleH + s(19);

    y += drawSectionTitle(ctx, ix + s(22), y, iw - s(44), "亲疏");
    y += s(11);
    const tierH = s(112);
    drawPanel(ctx, ix + s(22), y, iw - s(44), tierH);
    drawLegendFull(ctx, ix + s(38), y + s(18), iw - s(80));
    y += tierH;

    drawFooter(
      ctx,
      ix,
      iy + ih - s(60),
      iw,
      [],
      "词库与语义排序来自「词影」"
    );
    textLeft(
      ctx,
      "一日一词，猜中即止，次日零点换题",
      ix + s(22),
      iy + ih - s(30),
      `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
  });
}

export function renderWinCard(service: CanvasService, opts: WinOptions): Promise<Buffer> {
  const innerW = s(720);
  const innerH = s(420);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, "每日挑战 · 已封题");
    y += s(20);

    const revealH = s(130);
    drawPanel(ctx, ix + s(22), y, iw - s(44), revealH);

    drawSeal(ctx, ix + iw - s(80), y - s(13), s(42), ["中"]);

    textLeft(ctx, "今日答案", ix + s(38), y + s(24), `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
    drawWordGrid(ctx, ix + s(38), y + s(40), opts.answer, "lg");

    const ax = ix + iw - s(310);
    if (opts.neighbors.length) {
      textLeft(ctx, "意思最近的几个词", ax, y + s(24), `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`, C.onSurfaceVariant);
      let nx = ax;
      let ny = y + s(48);
      const chipFont = `${s(TYPE.labelLarge.size)}px ${FONT_SANS}`;
      const chipRight = ix + iw - s(38);
      for (const word of opts.neighbors) {
        const fittedWord = ellipsize(word, s(116), s(TYPE.labelLarge.size));
        const pw = textWidth(fittedWord, s(TYPE.labelLarge.size)) + s(20);
        if (nx !== ax && nx + pw > chipRight) {
          nx = ax;
          ny += s(36);
        }
        if (ny + s(14) > y + revealH - s(12)) break;
        // 近义词做成药丸形的 chip：次要容器色打底，不再描边
        fillRound(ctx, nx, ny - s(14), pw, s(28), s(SHAPE.full), C.secondaryContainer);
        textCenter(
          ctx,
          fittedWord,
          nx + pw / 2,
          ny,
          chipFont,
          C.onSecondaryContainer,
          cjkOffset(s(TYPE.labelLarge.size))
        );
        nx += pw + s(7);
      }
    } else {
      textLeft(
        ctx,
        "今日一词，就此收笔。",
        ax,
        y + s(50),
        `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
        C.onSurfaceVariant
      );
    }

    y += revealH + s(14);

    const statW = (iw - s(44) - s(20)) / 3;
    const stats = [
      { n: String(opts.attempts), u: "次", c: "本局猜测" },
      { n: opts.closest === null ? "—" : `#${opts.closest}`, u: "", c: "此前最接近" },
      { n: String(opts.score), u: "次", c: "累计猜中" },
    ];
    for (let i = 0; i < 3; i++) {
      const sx = ix + s(22) + i * (statW + s(10));
      drawPanel(ctx, sx, y, statW, s(56));
      textLeft(
        ctx,
        stats[i].n,
        sx + s(14),
        y + s(22),
        `${EMPHASIZED_WEIGHT.headline} ${s(TYPE.headlineSmall.size)}px ${FONT_NUM}`,
        C.primary
      );
      if (stats[i].u) {
        textLeft(
          ctx,
          stats[i].u,
          sx + s(14) + textWidth(stats[i].n, s(TYPE.headlineSmall.size)) + s(3),
          y + s(26),
          `${s(TYPE.labelMedium.size)}px ${FONT_SANS}`,
          C.onSurfaceVariant
        );
      }
      textLeft(
        ctx,
        stats[i].c,
        sx + s(14),
        y + s(44),
        `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
        C.onSurfaceVariant
      );
    }

    const quip =
      opts.closest === null
        ? "一击即中，今日无需第二次落笔"
        : `从 #${opts.closest} 一步跨到 #1`;

    const footerTip = opts.canStartToday
      ? "ciyi.猜 山水 · 开启今日新题"
      : "明日零点换新题 · ciyi.排行榜";
    drawFooter(
      ctx,
      ix,
      iy + ih - s(60),
      iw,
      [],
      footerTip
    );
    const footerFont = `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`;
    const footerTipWidth = textWidth(footerTip, s(TYPE.labelSmall.size));
    textLeftFit(
      ctx,
      `${opts.username} 拿下今日一词 · ${quip}`,
      ix + s(22),
      iy + ih - s(30),
      iw - s(62) - footerTipWidth,
      footerFont,
      C.onSurfaceVariant
    );
  });
}

export function renderRankCard(service: CanvasService, opts: RankOptions): Promise<Buffer> {
  const innerW = s(640);
  const rankPadX = s(32);
  const rankInnerPad = s(20);
  // 排行区的每一段都单独计高，避免空榜提示或末行落进固定在底部的页脚。
  const headerH = s(87);
  const contentGap = s(20);
  const rowH = s(52);
  const emptyH = s(92);
  const hiddenH = opts.hidden > 0 ? s(36) : 0;
  const footerGap = s(20);
  const footerH = s(60);
  const contentH = opts.entries.length ? opts.entries.length * rowH + hiddenH : emptyH;
  const innerH = headerH + contentGap + contentH + footerGap + footerH;

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    const panelX = ix + rankPadX;
    const panelW = iw - rankPadX * 2;
    const contentLeft = panelX + rankInnerPad;
    const contentRight = panelX + panelW - rankInnerPad;

    let y = iy + drawHeader(ctx, ix, iy, iw, "每日挑战 · 累计猜中", {
      big: String(opts.players),
      cap: "上榜人数",
    });
    y += s(20);

    drawPanel(ctx, panelX, y, panelW, contentH);

    if (!opts.entries.length) {
      textCenter(
        ctx,
        "排行榜还空着",
        panelX + panelW / 2,
        y + s(31),
        `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
        C.onSurfaceVariant
      );
      textCenter(
        ctx,
        "今日第一个猜中的人，会写在这里。",
        panelX + panelW / 2,
        y + s(61),
        `${s(TYPE.bodyMedium.size)}px ${FONT_SANS}`,
        C.onSurfaceVariant
      );
    } else {
      let ry = y;
      for (let i = 0; i < opts.entries.length; i++) {
        const e = opts.entries[i];
        const midY = ry + rowH / 2;

        if (e.me) {
          fillRound(ctx, panelX, ry, panelW, rowH, s(SHAPE.medium), FRESH);
        }

        if (i > 0) {
          ctx.strokeStyle = C.outlineVariant;
          ctx.beginPath();
          ctx.moveTo(contentLeft, ry);
          ctx.lineTo(contentRight, ry);
          ctx.stroke();
        }

        const posSize = s(30);
        const px = contentLeft;
        const py = midY - posSize / 2;
        // 前三名用固定的金银铜；名次的含义不该跟着主题色变。
        // 徽章里的字是反白，取 scheme 的 on 角色（色调 100，与 components() 里 m3-badge 的白同源）
        const podium = [MEDAL.gold, MEDAL.silver, MEDAL.bronze];
        const pc = i < 3
          ? { bg: podium[i], fg: onColor(podium[i]) }
          : { bg: C.surfaceContainerHighest, fg: C.onSurfaceVariant };
        fillRound(ctx, px, py, posSize, posSize, s(SHAPE.full), pc.bg);
        textCenter(
          ctx,
          String(i + 1),
          px + posSize / 2,
          midY,
          `${EMPHASIZED_WEIGHT.label} ${s(TYPE.labelLarge.size)}px ${FONT_NUM}`,
          pc.fg
        );

        const name = e.username || "无名氏";
        const nameX = px + posSize + s(14);
        const nameFont = `${s(TYPE.titleMedium.size)}px ${FONT_SANS}`;
        const score = String(e.score);
        const unitFont = s(TYPE.labelSmall.size);
        const unitW = textWidth("次", unitFont);
        const scoreFont = s(TYPE.titleLarge.size);
        const scoreRight = contentRight - unitW - s(8);
        const scoreLeft = scoreRight - textWidth(score, scoreFont);
        const meWidth = e.me ? textWidth("我", s(TYPE.labelSmall.size)) + s(18) : 0;
        const fittedName = ellipsize(
          name,
          Math.max(0, scoreLeft - s(16) - nameX - meWidth),
          s(TYPE.titleMedium.size)
        );
        textLeft(ctx, fittedName, nameX, midY, nameFont, C.onSurface);
        if (e.me) {
          const nw = textWidth(fittedName, s(TYPE.titleMedium.size));
          textLeft(
            ctx,
            "我",
            nameX + nw + s(8),
            midY,
            `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
            C.primary
          );
        }

        textRight(
          ctx,
          score,
          scoreRight,
          midY,
          `${EMPHASIZED_WEIGHT.title} ${scoreFont}px ${FONT_NUM}`,
          C.onSurface
        );
        textRight(ctx, "次", contentRight, midY, `${unitFont}px ${FONT_SANS}`, C.onSurfaceVariant);

        ry += rowH;
      }

      if (opts.hidden > 0) {
        textLeft(
          ctx,
          `…… 另有 ${opts.hidden} 人在榜`,
          contentLeft,
          ry + s(16),
          `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
          C.onSurfaceVariant
        );
      }
    }

    drawFooter(
      ctx,
      ix,
      iy + ih - s(60),
      iw,
      [],
      "ciyi.猜 山水"
    );
    textLeft(
      ctx,
      "每猜中一日之词，记一次",
      panelX,
      iy + ih - s(30),
      `${s(TYPE.labelSmall.size)}px ${FONT_SANS}`,
      C.onSurfaceVariant
    );
  });
}
