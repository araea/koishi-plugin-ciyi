// ─────────────────────────────────────────────────────────────────────────────
// 词意 · 共享类型与亲疏档位
// ─────────────────────────────────────────────────────────────────────────────

/** 一次猜测在相似度榜单上的落点。左邻更接近答案，右邻更远。 */
export interface History {
  guess: string;
  rank: number;
  leftHint: string;
  rightHint: string;
}

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

/** 排名 → 亲近度百分比（对数刻度，适配幂律分布的榜单）。 */
export function nearness(rank: number, total: number): number {
  const span = Math.log(Math.max(total, 2));
  const pct = (1 - Math.log(Math.max(rank, 1)) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export interface BoardRow {
  history: History;
  fresh?: boolean;
  gapBefore?: number;
}

export interface BoardOptions {
  rows: BoardRow[];
  total: number;
  attempts: number;
  tip: string;
}

export interface IntroOptions {
  total: number;
  words: number;
  middleware: boolean;
}

export interface WinOptions {
  answer: string;
  attempts: number;
  closest: number | null;
  neighbors: string[];
  username: string;
  score: number;
  canStartToday: boolean;
}

export interface RankEntry {
  username: string;
  score: number;
  me?: boolean;
}

export interface RankOptions {
  entries: RankEntry[];
  hidden: number;
  players: number;
}
