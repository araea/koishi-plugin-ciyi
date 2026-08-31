// ─────────────────────────────────────────────────────────────────────────────
// 词意 · 原生 Canvas 渲染
//
// 通过 Koishi 通用 Canvas 服务绘图；可复用 Puppeteer 已提供的服务。
// 坐标与文字宽度均由渲染器自身计算，不依赖浏览器布局或同步 measureText。
// ─────────────────────────────────────────────────────────────────────────────

import type CanvasService from "@koishijs/canvas";
import type { CanvasRenderingContext2D as SKRSContext2D } from "@koishijs/canvas";
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

const C = {
  paper: "#F3EDE1",
  paper2: "#EBE2D0",
  ink: "#241F1A",
  ink2: "#6B6259",
  ink3: "#9B9186",
  rule: "#D5CAB4",
  ruleDark: "#C2B69E",
  seal: "#B23A2E",
  sealLight: "#B7352B",
  bg: "#DED4C0",
  white: "#FFFCF4",
  fresh: "rgba(178,58,46,0.075)",
};

const FONT_SERIF = '"Noto Serif CJK SC", "Noto Serif CJK", serif';
const FONT_NUM = '"Noto Serif CJK SC", "Noto Serif CJK", serif';

function s(n: number): number {
  return Math.round(n * SCALE);
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
  return Number(font.match(/([\d.]+)px/)?.[1] ?? s(12));
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

function drawPaper(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, Math.round(h * 0.34));

  ctx.save();
  ctx.globalAlpha = 0.028;
  ctx.strokeStyle = "#78684E";
  for (let ly = y; ly < y + h; ly += s(4)) {
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + w, ly);
    ctx.stroke();
  }
  for (let lx = x; lx < x + w; lx += s(3)) {
    ctx.beginPath();
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

async function toPng(
  service: CanvasService,
  innerW: number,
  innerH: number,
  draw: (ctx: SKRSContext2D, ix: number, iy: number, iw: number, ih: number) => void
): Promise<Buffer> {
  const ox = s(6);
  const oy = s(6);
  const borderOut = s(3);
  const gap = s(5);
  const canvasW = (ox + borderOut + gap) * 2 + innerW + s(10);
  const canvasH = (oy + borderOut + gap) * 2 + innerH + s(10);
  const canvas = await service.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  try {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const paperX = ox + borderOut + gap;
    const paperY = oy + borderOut + gap;
    drawPaper(ctx, paperX, paperY, innerW, innerH);

    ctx.strokeStyle = C.ink;
    ctx.lineWidth = borderOut;
    ctx.strokeRect(
      ox + borderOut / 2,
      oy + borderOut / 2,
      canvasW - ox * 2 - borderOut,
      canvasH - oy * 2 - borderOut
    );

    ctx.strokeStyle = C.rule;
    ctx.lineWidth = s(1);
    ctx.strokeRect(paperX - s(3), paperY - s(3), innerW + s(6), innerH + s(6));

    draw(ctx, paperX, paperY, innerW, innerH);
    return await canvas.toBuffer("image/png");
  } finally {
    await canvas.dispose();
  }
}

const GRID = {
  sm: { cell: 26, gap: 4, font: 15, border: 1 },
  md: { cell: 34, gap: 4, font: 20, border: 1 },
  lg: { cell: 78, gap: 9, font: 46, border: 1.5 },
} as const;

type GridSize = keyof typeof GRID;

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
  fontSize: number,
  borderW: number
) {
  const half = size / 2;

  if (mode === "mk") {
    ctx.fillStyle = "rgba(205,192,168,0.32)";
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "#C0B399";
    ctx.lineWidth = s(borderW);
    ctx.setLineDash([s(3), s(3)]);
    ctx.strokeRect(x + s(0.5), y + s(0.5), size - s(1), size - s(1));
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(150,138,120,0.55)";
    ctx.lineWidth = s(1);
    ctx.setLineDash([s(2), s(2)]);
    ctx.beginPath();
    ctx.moveTo(x + s(4), y + half);
    ctx.lineTo(x + size - s(4), y + half);
    ctx.moveTo(x + half, y + s(4));
    ctx.lineTo(x + half, y + size - s(4));
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  ctx.fillStyle = C.white;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "#B9AC93";
  ctx.lineWidth = s(borderW);
  ctx.strokeRect(x + s(0.5), y + s(0.5), size - s(1), size - s(1));

  if (ch) {
    const fs = s(fontSize);
    textCenter(
      ctx,
      ch,
      x + half,
      y + half,
      `600 ${fs}px ${FONT_SERIF}`,
      C.ink,
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
    textCenter(ctx, "—", x + s(14), y + cell / 2, `${s(13)}px ${FONT_SERIF}`, C.ink3);
    return s(28);
  }

  let cx = x;
  for (let i = 0; i < chars.length; i++) {
    if (i === mask) {
      drawGridCell(ctx, cx, y, cell, null, "mk", g.font, g.border);
    } else {
      drawGridCell(ctx, cx, y, cell, chars[i], "on", g.font, g.border);
    }
    cx += cell + gap;
  }
  return cell;
}

function drawSeal(ctx: SKRSContext2D, x: number, y: number, size: number, lines: string[]) {
  ctx.fillStyle = C.seal;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "rgba(247,241,229,0.6)";
  ctx.lineWidth = s(1.5);
  ctx.strokeRect(x + s(1.5), y + s(1.5), size - s(3), size - s(3));
  ctx.strokeStyle = C.seal;
  ctx.lineWidth = s(4);
  ctx.strokeRect(x + s(4), y + s(4), size - s(8), size - s(8));

  const fs = s(19);
  const lh = fs * 1.06;
  const total = lh * lines.length;
  let cy = y + size / 2 - total / 2 + lh / 2;
  for (const line of lines) {
    textCenter(ctx, line, x + size / 2, cy, `700 ${fs}px ${FONT_SERIF}`, "#F7F1E5");
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
  textLeft(ctx, "词意", brandX, innerY + padTop + s(14), `700 ${s(26)}px ${FONT_SERIF}`, C.ink);
  textLeft(
    ctx,
    "ci yi",
    brandX,
    innerY + padTop + s(36),
    `italic ${s(10)}px ${FONT_NUM}`,
    C.ink3
  );
  const subRight = right ? innerX + innerW - padX - s(150) : innerX + innerW - padX;
  textLeftFit(
    ctx,
    sub,
    brandX,
    innerY + padTop + s(58),
    subRight - brandX,
    `${s(12.5)}px ${FONT_SERIF}`,
    C.ink2
  );

  if (right) {
    const rx = innerX + innerW - padX;
    textRight(ctx, right.big, rx, innerY + padTop + s(16), `700 ${s(31)}px ${FONT_NUM}`, C.seal);
    textRight(ctx, right.cap, rx, innerY + padTop + s(44), `${s(10.5)}px ${FONT_SERIF}`, C.ink3);
  }

  const lineY = innerY + h;
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(innerX, lineY);
  ctx.lineTo(innerX + innerW, lineY);
  ctx.stroke();

  ctx.fillStyle = C.seal;
  ctx.fillRect(innerX + padX, lineY - s(1), s(54), s(2));

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

  ctx.fillStyle = "rgba(36,31,26,0.022)";
  ctx.fillRect(innerX, y, innerW, h + padY * 2);

  ctx.strokeStyle = C.rule;
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(innerX, y);
  ctx.lineTo(innerX + innerW, y);
  ctx.stroke();

  let lx = innerX + padX;
  const cy = y + padY + h / 2;
  for (const { tier, range } of legendItems) {
    ctx.fillStyle = tier.color;
    ctx.fillRect(lx, cy - s(4.5), s(9), s(9));
    lx += s(9) + s(6);
    textLeft(ctx, tier.name, lx, cy, `${s(11.5)}px ${FONT_SERIF}`, C.ink2);
    lx += textWidth(tier.name, s(11.5)) + s(4);
    textLeft(ctx, range, lx, cy, `${s(11)}px ${FONT_NUM}`, C.ink3);
    lx += textWidth(range, s(11)) + s(13);
  }

  const tipFont = `${s(11.5)}px ${FONT_SERIF}`;
  const maxTipWidth = legendItems.length ? s(145) : innerW - padX * 2;
  textRight(
    ctx,
    ellipsize(tip, maxTipWidth, s(11.5)),
    innerX + innerW - padX,
    cy,
    tipFont,
    C.ink3
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
    ctx.fillStyle = t.color;
    ctx.fillRect(cx, cy - s(4.5), s(9), s(9));
    textLeft(ctx, t.name, cx + s(15), cy, `${s(11.5)}px ${FONT_SERIF}`, C.ink2);
    textLeft(ctx, tierRange(i), cx + s(52), cy, `${s(11)}px ${FONT_NUM}`, C.ink3);
    textLeft(ctx, t.note, cx + s(100), cy, `${s(11.5)}px ${FONT_SERIF}`, C.ink3);
  }
  return rowH * Math.ceil(TIERS.length / 2) + s(8);
}

function drawSectionTitle(ctx: SKRSContext2D, x: number, y: number, w: number, title: string): number {
  ctx.fillStyle = C.seal;
  ctx.fillRect(x, y + s(2), s(6), s(6));
  textLeft(ctx, title, x + s(15), y + s(5), `${s(11.5)}px ${FONT_SERIF}`, C.ink2);
  const tw = textWidth(title, s(11.5));
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = s(1);
  ctx.setLineDash([s(3), s(4)]);
  ctx.beginPath();
  ctx.moveTo(x + s(15) + tw + s(9), y + s(5));
  ctx.lineTo(x + w, y + s(5));
  ctx.stroke();
  ctx.setLineDash([]);
  return s(24);
}

function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "rgba(255,255,255,0.34)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = s(1);
  ctx.strokeRect(x + s(0.5), y + s(0.5), w - s(1), h - s(1));
}

function drawNearBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  pct: number,
  tier: Tier
) {
  const barW = s(88);
  const barH = s(6);
  ctx.fillStyle = "rgba(36,31,26,0.09)";
  ctx.fillRect(x, y - barH / 2, barW, barH);
  ctx.fillStyle = tier.color;
  ctx.fillRect(x, y - barH / 2, (barW * pct) / 100, barH);
  textLeft(ctx, tier.name, x + barW + s(9), y, `${s(12.5)}px ${FONT_SERIF}`, tier.color);
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
  const meterBlockW = s(88) + s(9) + textWidth("咫尺", s(12.5));
  const mtX = mt0 + Math.max(0, (cols.mt - meterBlockW) / 2);

  const headY = y;
  const fs = s(10.5);
  textLeft(ctx, "序", noX, headY, `${fs}px ${FONT_SERIF}`, C.ink3);
  textCenter(ctx, "更近 ◀", nb0 + cols.nb / 2, headY, `${fs}px ${FONT_SERIF}`, C.ink3);
  textCenter(ctx, "猜测", gw0 + cols.gw / 2, headY, `${fs}px ${FONT_SERIF}`, C.ink3);
  textCenter(ctx, "▶ 更远", nb1 + cols.nb / 2, headY, `${fs}px ${FONT_SERIF}`, C.ink3);
  textCenter(ctx, "排名", rk0 + cols.rk / 2, headY, `${fs}px ${FONT_SERIF}`, C.ink3);
  textCenter(ctx, "亲疏", mt0 + cols.mt / 2, headY, `${fs}px ${FONT_SERIF}`, C.ink3);

  let ry = y + s(22);
  let ordinal = 0;

  for (const row of opts.rows) {
    if (row.gapBefore) {
      ry += s(8);
      textCenter(
        ctx,
        `⋯ 另有 ${row.gapBefore} 词未列 ⋯`,
        cx + tableW / 2,
        ry + s(10),
        `${s(11.5)}px ${FONT_SERIF}`,
        C.ink3
      );
      ctx.strokeStyle = C.rule;
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
      ctx.fillStyle = C.fresh;
      ctx.fillRect(cx, ry, tableW, rowH);
      ctx.fillStyle = C.seal;
      ctx.fillRect(cx, ry, accentW, rowH);
    }

    ctx.strokeStyle = ordinal === 1 ? C.ruleDark : C.rule;
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
      `${s(13)}px ${FONT_NUM}`,
      C.ink3
    );

    const nbX = nb0 + (cols.nb - gridWidth(history.leftHint, "sm")) / 2;
    drawWordGrid(ctx, nbX, midY - s(13), history.leftHint, "sm", 0);

    const gwX = gw0 + (cols.gw - gridWidth(history.guess, "md")) / 2;
    drawWordGrid(ctx, gwX, midY - s(17), history.guess, "md");

    const rbX = nb1 + (cols.nb - gridWidth(history.rightHint, "sm")) / 2;
    drawWordGrid(ctx, rbX, midY - s(13), history.rightHint, "sm", 1);

    const rankText = String(history.rank);
    const rankFont = `700 ${s(21)}px ${FONT_NUM}`;
    const rankWidth = textWidth(rankText, s(21));
    const hashW = textWidth("#", s(13));
    const rankBlock = hashW + s(3) + rankWidth;
    const rankLeft = rk0 + (cols.rk - rankBlock) / 2;
    textLeft(ctx, "#", rankLeft, midY, `${s(13)}px ${FONT_NUM}`, C.ink3);
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
  const innerH = s(688);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, "按意思远近找词 · 每日一题", {
      big: opts.words.toLocaleString(),
      cap: "词库容量",
    });
    y += s(20);

    y += drawSectionTitle(ctx, ix + s(22), y, iw - s(44), "玩法");
    y += s(11);
    const p1h = s(76);
    drawPanel(ctx, ix + s(22), y, iw - s(44), p1h);
    textLeft(ctx, "开始", ix + s(38), y + s(24), `${s(14)}px ${FONT_SERIF}`, C.seal);
    textLeft(ctx, "ciyi.猜 山水", ix + s(96), y + s(24), `${s(13.5)}px ${FONT_NUM}`, C.ink);
    textLeftFit(
      ctx,
      `开题并报一个两字词${opts.middleware ? "，也可以直接把词发出来" : ""}`,
      ix + s(230),
      y + s(24),
      iw - s(268),
      `${s(14)}px ${FONT_SERIF}`,
      C.ink
    );
    textLeft(ctx, "排行", ix + s(38), y + s(52), `${s(14)}px ${FONT_SERIF}`, C.seal);
    textLeft(ctx, "ciyi.排行榜", ix + s(96), y + s(52), `${s(13.5)}px ${FONT_NUM}`, C.ink);
    textLeft(ctx, "看谁猜中得最多", ix + s(230), y + s(52), `${s(14)}px ${FONT_SERIF}`, C.ink);
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
      `${s(12)}px ${FONT_SERIF}`,
      C.ink3
    );
    textLeft(
      ctx,
      "两侧空格各藏一字：左邻更近，右邻更远。",
      ix + s(38),
      y + s(126),
      `${s(12)}px ${FONT_SERIF}`,
      C.ink3
    );
    textLeft(
      ctx,
      "名次越小，离答案越近；#1 就是答案本身。",
      ix + s(38),
      y + s(148),
      `${s(12)}px ${FONT_SERIF}`,
      C.ink2
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
      `${s(11.5)}px ${FONT_SERIF}`,
      C.ink3
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

    textLeft(ctx, "今日答案", ix + s(38), y + s(24), `${s(11.5)}px ${FONT_SERIF}`, C.ink3);
    drawWordGrid(ctx, ix + s(38), y + s(40), opts.answer, "lg");

    const ax = ix + iw - s(310);
    if (opts.neighbors.length) {
      textLeft(ctx, "意思最近的几个词", ax, y + s(24), `${s(11.5)}px ${FONT_SERIF}`, C.ink3);
      let nx = ax;
      let ny = y + s(48);
      const chipFont = `${s(14)}px ${FONT_SERIF}`;
      const chipRight = ix + iw - s(38);
      for (const word of opts.neighbors) {
        const fittedWord = ellipsize(word, s(116), s(14));
        const pw = textWidth(fittedWord, s(14)) + s(20);
        if (nx !== ax && nx + pw > chipRight) {
          nx = ax;
          ny += s(36);
        }
        if (ny + s(14) > y + revealH - s(12)) break;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(nx, ny - s(14), pw, s(28));
        ctx.strokeStyle = C.rule;
        ctx.strokeRect(nx + s(0.5), ny - s(14) + s(0.5), pw - s(1), s(28) - s(1));
        textCenter(ctx, fittedWord, nx + pw / 2, ny, chipFont, C.ink, cjkOffset(s(14)));
        nx += pw + s(7);
      }
    } else {
      textLeft(ctx, "今日一词，就此收笔。", ax, y + s(50), `${s(13.5)}px ${FONT_SERIF}`, C.ink2);
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
      textLeft(ctx, stats[i].n, sx + s(14), y + s(22), `700 ${s(23)}px ${FONT_NUM}`, C.seal);
      if (stats[i].u) {
        textLeft(ctx, stats[i].u, sx + s(14) + textWidth(stats[i].n, s(23)) + s(3), y + s(26), `${s(12)}px ${FONT_SERIF}`, C.ink2);
      }
      textLeft(ctx, stats[i].c, sx + s(14), y + s(44), `${s(10.5)}px ${FONT_SERIF}`, C.ink3);
    }

    const quip =
      opts.closest === null
        ? "一击即中，今日无需第二次落笔"
        : `从 #${opts.closest} 一步跨到 #1`;

    const footerTip = "明日零点换新题 · ciyi.排行榜";
    drawFooter(
      ctx,
      ix,
      iy + ih - s(60),
      iw,
      [],
      footerTip
    );
    const footerFont = `${s(11.5)}px ${FONT_SERIF}`;
    const footerTipWidth = textWidth(footerTip, s(11.5));
    textLeftFit(
      ctx,
      `${opts.username} 拿下今日一词 · ${quip}`,
      ix + s(22),
      iy + ih - s(30),
      iw - s(62) - footerTipWidth,
      footerFont,
      C.ink2
    );
  });
}

export function renderRankCard(service: CanvasService, opts: RankOptions): Promise<Buffer> {
  const innerW = s(620);
  const rowCount = Math.max(opts.entries.length, 1);
  const innerH = s(120 + rowCount * 52 + (opts.hidden > 0 ? 36 : 0) + 60);

  return toPng(service, innerW, innerH, (ctx, ix, iy, iw, ih) => {
    let y = iy + drawHeader(ctx, ix, iy, iw, "每日挑战 · 累计猜中", {
      big: String(opts.players),
      cap: "上榜人数",
    });
    y += s(20);

    if (!opts.entries.length) {
      textCenter(
        ctx,
        "榜上无名。",
        ix + iw / 2,
        y + s(40),
        `${s(13.5)}px ${FONT_SERIF}`,
        C.ink3
      );
      textCenter(
        ctx,
        "今日第一个猜中的人，会写在这里。",
        ix + iw / 2,
        y + s(68),
        `${s(13.5)}px ${FONT_SERIF}`,
        C.ink3
      );
    } else {
      let ry = y;
      for (let i = 0; i < opts.entries.length; i++) {
        const e = opts.entries[i];
        const rowH = s(52);
        const midY = ry + rowH / 2;

        if (e.me) {
          ctx.fillStyle = "rgba(178,58,46,0.055)";
          ctx.fillRect(ix + s(22), ry, iw - s(44), rowH);
        }

        if (i > 0) {
          ctx.strokeStyle = C.rule;
          ctx.beginPath();
          ctx.moveTo(ix + s(22), ry);
          ctx.lineTo(ix + iw - s(22), ry);
          ctx.stroke();
        }

        const posSize = s(30);
        const px = ix + s(26);
        const py = midY - posSize / 2;
        const posColors = [
          { bg: C.seal, fg: "#F7F1E5", border: C.seal },
          { bg: "#4A5470", fg: "#F7F1E5", border: "#4A5470" },
          { bg: "#9C7B4B", fg: "#F7F1E5", border: "#9C7B4B" },
        ];
        const pc = i < 3 ? posColors[i] : { bg: "rgba(255,255,255,0.4)", fg: C.ink2, border: C.rule };
        ctx.fillStyle = pc.bg;
        ctx.fillRect(px, py, posSize, posSize);
        ctx.strokeStyle = pc.border;
        ctx.strokeRect(px + s(0.5), py + s(0.5), posSize - s(1), posSize - s(1));
        textCenter(ctx, String(i + 1), px + posSize / 2, midY, `700 ${s(14)}px ${FONT_NUM}`, pc.fg);

        const name = e.username || "无名氏";
        const nameX = px + posSize + s(14);
        const nameFont = `${s(15)}px ${FONT_SERIF}`;
        const fittedName = ellipsize(
          name,
          ix + iw - s(118) - nameX - (e.me ? s(28) : 0),
          s(15)
        );
        textLeft(ctx, fittedName, nameX, midY, nameFont, C.ink);
        if (e.me) {
          const nw = textWidth(fittedName, s(15));
          textLeft(ctx, "我", nameX + nw + s(8), midY, `${s(10.5)}px ${FONT_SERIF}`, C.seal);
        }

        textRight(
          ctx,
          String(e.score),
          ix + iw - s(38),
          midY,
          `700 ${s(19)}px ${FONT_NUM}`,
          C.ink
        );
        textRight(ctx, "次", ix + iw - s(22), midY, `${s(11.5)}px ${FONT_SERIF}`, C.ink3);

        ry += rowH;
      }

      if (opts.hidden > 0) {
        textLeft(
          ctx,
          `⋯ 另有 ${opts.hidden} 人在榜`,
          ix + s(26),
          ry + s(16),
          `${s(11.5)}px ${FONT_SERIF}`,
          C.ink3
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
      ix + s(22),
      iy + ih - s(30),
      `${s(11.5)}px ${FONT_SERIF}`,
      C.ink3
    );
  });
}
