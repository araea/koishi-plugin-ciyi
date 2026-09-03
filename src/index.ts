import { $, Context, h, Random, Schema, Session } from "koishi";
import allWords from "./data/allWords.json";
import questionList from "./data/questionList.json";
import {
  renderBoardCard,
  renderIntroCard,
  renderRankCard,
  renderWinCard,
} from "./render";
import { BoardRow, History, nearness, tierOf } from "./view";

export const name = "ciyi";
export const usage = `## 使用

设置指令别名后，发送 \`ciyi\` 查看玩法。每日藏一个两字词，使用 \`ciyi.猜 <词>\` 提交第一次猜测并开题；开题后可直接发送两字词继续猜测。\`ciyi.裸词\` 可在当前群临时切换这一行为，不改插件配置，重启后自动复原。

## 指令

| 指令 | 说明 |
| --- | --- |
| \`ciyi\` | 玩法说明 |
| \`ciyi.猜 <词>\` | 开始今日游戏并提交猜测 |
| \`ciyi.裸词 [开/关]\` | 临时切换本群裸词续猜 |
| \`ciyi.排行榜\` | 猜中次数榜 |`;

export const inject = { required: ["database"], optional: ["canvas"] };

// pz*
export interface Config {
  atReply: boolean;
  quoteReply: boolean;
  isEnableMiddleware: boolean;
  renderImage: boolean;
  maxHistory: number;
  maxRank: number;
}

export const Config: Schema<Config> = Schema.object({
  atReply: Schema.boolean().default(false).description("响应时 @"),
  quoteReply: Schema.boolean().default(false).description("响应时引用"),
  isEnableMiddleware: Schema.boolean()
    .default(true)
    .description(
      "是否启用中间件（若启用，已开题时可以不使用指令直接猜测；ciyi.裸词 指令可在单个群内临时切换）"
    ),
  renderImage: Schema.boolean()
    .default(true)
    .description("渲染图片（复用 Koishi Canvas 服务；不可用时使用等价文本）"),
  maxHistory: Schema.number()
    .default(10)
    .min(0)
    .description("猜测板最多列出的历史条数（最新一次猜测始终会列出）"),
  maxRank: Schema.number().default(10).min(0).description("最大排行榜人数"),
});

// smb*
declare module "koishi" {
  interface Tables {
    ciyi: Ciyi;
    ciyi_rank: CiyiRank;
  }
}

// jk*
export interface Ciyi {
  id: number;
  channelId: string;
  answer: string;
  lastStartTimestamp: Date;
  guessedWords: string[];
  guessedHistoryInOneGame: string[];
  rankList: string[];
  history: History[];
  isOver: boolean;
}

export interface CiyiRank {
  id: number;
  userId: string;
  username: string;
  score: number;
}

export type { History };

/**
 * 裸词中间件只接受一条完整、无修饰的两字中文纯文本消息。
 * 引用、@、图片、富文本以及机器人消息都可能只是普通聊天的一部分，不能据此猜词。
 */
export function getMiddlewareGuess(session: Session): string | null {
  const message = session.event.message;
  if (
    !message ||
    message.quote ||
    session.event.user?.isBot ||
    message.user?.isBot
  ) {
    return null;
  }

  const elements = message.elements ?? [];
  if (elements.length !== 1 || elements[0].type !== "text") {
    return null;
  }

  const text = elements[0].attrs.content;
  if (
    typeof text !== "string" ||
    text !== text.trim() ||
    Array.from(text).length !== 2 ||
    !/^\p{Script=Han}{2}$/u.test(text) ||
    !allWords.includes(text)
  ) {
    return null;
  }

  return text;
}

/** 裸词只能加入已开始且未封题的游戏，不能开题，也不重复提交旧猜测。 */
export function canHandleMiddlewareGuess(
  game: Ciyi | null | undefined,
  guess: string
): boolean {
  if (!game || game.isOver) return false;
  if (game.guessedHistoryInOneGame?.includes(guess)) return false;

  // 损坏或尚未载入完成的榜单不应由普通聊天触发错误提示。
  return guess === game.answer || game.rankList?.includes(guess) === true;
}

export type MiddlewareSwitch =
  | { error: string }
  | {
      /** 写回本群覆盖表的新值；undefined 表示清除覆盖，回到插件配置 */
      override: boolean | undefined;
      /** 切换后的生效状态 */
      on: boolean;
      /** 本次是否清除了本群已有的临时改动 */
      reverted: boolean;
    };

/**
 * 裸词开关是「插件配置」与「本群临时相反」之间的往返：本群从不保留与配置相同的冗余覆盖，
 * 状态只有两种来历 —— 本群临时改动，或跟随插件配置，回复也因此总能如实相告。
 * 无参调用是切换，显式 开/关 与配置同值时视作复原，状态 只查不改。
 */
export function resolveMiddlewareSwitch(
  config: boolean,
  override: boolean | undefined,
  action: string | null | undefined
): MiddlewareSwitch {
  const arg = action?.trim();

  if (!arg) {
    return override === undefined
      ? { override: !config, on: !config, reverted: false }
      : { override: undefined, on: config, reverted: true };
  }
  if (arg === "状态") {
    return { override, on: override ?? config, reverted: false };
  }

  const on = arg === "开" || arg === "开启";
  if (!on && arg !== "关" && arg !== "关闭") {
    return { error: "裸词开关只认 开 / 关 / 状态" };
  }
  if (on === config) {
    return { override: undefined, on: config, reverted: override !== undefined };
  }
  return { override: on, on, reverted: false };
}

export function apply(ctx: Context, cfg: Config) {
  // tzb*
  ctx.model.extend(
    "ciyi",
    {
      id: "unsigned",
      channelId: "string",
      answer: "string",
      lastStartTimestamp: "timestamp",
      guessedWords: "list",
      guessedHistoryInOneGame: "list",
      rankList: "list",
      history: { type: "json", initial: [] },
      isOver: "boolean",
    },
    { autoInc: true, primary: "id" }
  );

  ctx.model.extend(
    "ciyi_rank",
    {
      id: "unsigned",
      userId: "string",
      username: "string",
      score: "unsigned",
    },
    { autoInc: true, primary: "id" }
  );

  // cl*
  const logger = ctx.logger("ciyi");
  const random = new Random(() => Math.random());
  const RULE = "────────────";

  // 裸词开关的临时改动只落在当前频道，不动插件配置；插件重载后自然回到配置默认
  const middlewareOverrides = new Map<string, boolean>();
  const middlewareOn = (channelId: string | undefined) =>
    channelId === undefined
      ? cfg.isEnableMiddleware
      : middlewareOverrides.get(channelId) ?? cfg.isEnableMiddleware;

  // zjj* 常驻注册，以本群生效状态做闸门，ciyi.裸词 才能即时切换
  ctx.middleware(async (session, next) => {
    if (!session.channelId || !middlewareOn(session.channelId)) return await next();

    const guess = getMiddlewareGuess(session);
    if (!guess) return await next();

    try {
      const [game] = await ctx.database.get("ciyi", {
        channelId: session.channelId,
      });
      if (!canHandleMiddlewareGuess(game, guess)) return await next();
    } catch (error) {
      logger.warn(
        "中间件读取游戏状态失败，本次消息不作猜测：%s",
        error instanceof Error ? error.message : String(error)
      );
      return await next();
    }

    return await session.execute(`ciyi.猜 ${guess}`);
  });

  // zl*
  ctx.command("ciyi", "词意（猜词游戏）").action(async ({ session }) => {
    return await wf(session);
  });
  // c*
  ctx
    .command("ciyi.猜 <guess:string>", "报一个两字词")
    .usage("例：ciyi.猜 山水")
    .action(async ({ session }, guess) => {
      return await c(session, guess?.trim());
    });
  // phb*
  ctx.command("ciyi.排行榜", "累计猜中次数榜").action(async ({ session }) => {
    return await phb(session);
  });
  // lw*
  ctx
    .command("ciyi.裸词 [state:string]", "临时开关本群的裸词续猜")
    .usage("例：ciyi.裸词（切换）· ciyi.裸词 开 · ciyi.裸词 关 · ciyi.裸词 状态")
    .action(async ({ session }, state) => {
      const result = resolveMiddlewareSwitch(
        cfg.isEnableMiddleware,
        session.channelId === undefined
          ? undefined
          : middlewareOverrides.get(session.channelId),
        state
      );
      if ("error" in result) {
        return await sendMsg(session, `⚠️ ${result.error}。例：ciyi.裸词 开`);
      }

      if (result.override === undefined) middlewareOverrides.delete(session.channelId);
      else middlewareOverrides.set(session.channelId, result.override);

      return await sendMsg(
        session,
        middlewareSwitchText({
          on: result.on,
          temporary: result.override !== undefined,
          reverted: result.reverted,
        })
      );
    });

  // hs*
  function getNewUniqueAnswer(oldGuessedWords: string[]): string | null {
    const usedWordsSet = new Set(oldGuessedWords);

    const availableWords = questionList.filter(
      (word) => !usedWordsSet.has(word)
    );

    if (availableWords.length === 0) {
      return null;
    }

    return random.pick(availableWords);
  }

  function getHistory(
    targetString: string,
    stringArray: string[]
  ): History | null {
    const index = stringArray.indexOf(targetString);

    if (index === -1) {
      return null;
    }

    const rank = index + 1;

    const leftHint = index > 0 ? stringArray[index - 1] : "";
    const rightHint =
      index < stringArray.length - 1 ? stringArray[index + 1] : "";

    return {
      guess: targetString,
      rank,
      leftHint,
      rightHint,
    };
  }

  // pb* 排版
  //
  // 历史按名次从近到远排，这样「最好的一手」永远在第一行。
  // 但刚提交的那个词可能排得很靠后，被 maxHistory 截掉 —— 那玩家就看不到
  // 自己这一手的结果了，所以它无论如何都要留在板上，接在省略记号后面。
  interface Layout {
    rows: BoardRow[];
    hidden: number;
  }

  function layout(history: History[], latest: string | null): Layout {
    const sorted = [...history].sort((a, b) => a.rank - b.rank);
    const max = cfg.maxHistory;

    if (max >= sorted.length) {
      return {
        rows: sorted.map((it) => ({ history: it, fresh: it.guess === latest })),
        hidden: 0,
      };
    }

    const head = sorted.slice(0, max);
    const rest = sorted.slice(max);
    const rows: BoardRow[] = head.map((it) => ({
      history: it,
      fresh: it.guess === latest,
    }));

    const tail = rest.find((it) => it.guess === latest);
    if (tail) {
      rows.push({ history: tail, fresh: true, gapBefore: rest.length - 1 });
      return { rows, hidden: rest.length - 1 };
    }
    return { rows, hidden: rest.length };
  }

  function bestRank(history: History[]): number | null {
    return history.length
      ? history.reduce((m, it) => Math.min(m, it.rank), Infinity)
      : null;
  }

  // wb* 文本
  //
  // 没有 Canvas 服务时走这条路。文本不是图片的残次品，排版一样要站得住：
  // 一行一手，名次右对齐前的位置固定，扫一眼就能看出哪一手最近。
  function textCard(
    title: string,
    ...sections: (string | string[] | null | undefined)[]
  ): string {
    const body = sections
      .map((s) => (Array.isArray(s) ? s.filter(Boolean).join("\n") : s))
      .filter((s): s is string => !!s && !!s.trim())
      .join("\n\n");
    return [`▍${title}`, RULE, body].filter(Boolean).join("\n");
  }

  /** 邻词的文本形态：隐去的字写成「？」，没有邻居写成「──」。 */
  function neighborText(hint: string, side: "left" | "right"): string {
    if (!hint) return "──";
    return side === "left" ? `？${hint[1] ?? "？"}` : `${hint[0]}？`;
  }

  function boardText(rows: BoardRow[], hidden: number, attempts: number): string {
    const lines: string[] = [];
    rows.forEach((row, i) => {
      // 断档记号紧贴在被拎出来的那一手之前，与图片里的位置一致
      if (row.gapBefore) lines.push(`　⋯ 另有 ${row.gapBefore} 词未列 ⋯`);
      const { guess, rank, leftHint, rightHint } = row.history;
      const mark = row.fresh ? "▸" : "　";
      lines.push(
        `${mark}${String(i + 1).padStart(2, "0")} ` +
          `${neighborText(leftHint, "left")}）${guess}（${neighborText(rightHint, "right")}` +
          ` #${rank} · ${tierOf(rank).name}`
      );
    });

    const best = bestRank(rows.map((r) => r.history));
    const tail = rows.some((r) => r.gapBefore);
    return textCard(
      `词意 · 第 ${attempts} 次猜测`,
      best === null
        ? null
        : `当前最佳 #${best} · ${tierOf(best).name}（${tierOf(best).note}）`,
      lines,
      hidden > 0 && !tail ? `　⋯ 另有 ${hidden} 词未列 ⋯` : null,
      "左邻更近答案，右邻更远；？ 为隐去的字"
    );
  }

  function introText(channelOn: boolean): string {
    return textCard(
      "词意 · 按意思远近找词",
      `每天藏起一个两字词。你报词，我回它与答案的语义排名 —— 名次越小越近，#1 就是答案本身。`,
      [
        `开始　ciyi.猜 山水　　开题并报一个两字词`,
        channelOn ? `续猜　直接发送两字词　仅限已开题且未结束` : null,
        `排行　ciyi.排行榜　　看谁猜中得最多`,
        `切换　ciyi.裸词 开/关　　临时改本群续猜方式`,
      ].filter(Boolean) as string[],
      [
        `读板　？好）企业（地？ #467 · 沾边`,
        `　　　#467 是「企业」与答案的相近名次`,
        `　　　？好 / 地？ 是它在榜上的左右邻居，各遮去一字`,
        `　　　左邻更近答案，右邻更远`,
      ],
      [
        `亲疏　咫尺 ≤10　毗邻 ≤50　相近 ≤200`,
        `　　　沾边 ≤1000　疏远 ≤5000　天涯 5000+`,
      ],
      `词库 ${allWords.length.toLocaleString()} 词，题库 ${questionList.length.toLocaleString()} 题，一日一词。`
    );
  }

  /** 裸词开关的回复：状态只有「本群临时」与「跟随插件配置」两种来历，如实相告。 */
  function middlewareSwitchText(o: {
    on: boolean;
    temporary: boolean;
    reverted: boolean;
  }): string {
    const mark = o.on ? "✅" : "⛔";
    const state = o.on ? "开启" : "停用";
    const config = cfg.isEnableMiddleware ? "开启" : "停用";

    if (!o.temporary) {
      return `${mark} 裸词续猜 · ${o.reverted ? "已复原，" : ""}跟随插件配置（${state}）`;
    }
    const hint = o.on
      ? "开题后直接发送两字词即可续猜"
      : "续猜请用 ciyi.猜 山水";
    return [
      `${mark} 裸词续猜 · 本群临时${state}（插件配置：${config}）`,
      `${hint}；再次发送 ciyi.裸词 复原`,
    ].join("\n");
  }

  function winText(o: {
    answer: string;
    attempts: number;
    closest: number | null;
    neighbors: string[];
    username: string;
    score: number;
    canStartToday: boolean;
  }): string {
    return textCard(
      "猜中了 · 今日已封题",
      `答案　${o.answer}`,
      [
        `猜测　${o.attempts} 次`,
        o.closest === null
          ? `此前　一击即中`
          : `此前　最接近 #${o.closest} · ${tierOf(o.closest).name}`,
        `累计　${o.username} 已猜中 ${o.score} 次`,
        o.neighbors.length ? `近旁　${o.neighbors.join(" · ")}` : null,
      ].filter(Boolean) as string[],
      o.canStartToday
        ? "继续 ciyi.猜 山水 · 开启今日新题"
        : "明日零点换新题 · ciyi.排行榜 看战绩"
    );
  }

  function rankText(entries: { username: string; score: number }[], hidden: number): string {
    if (!entries.length) {
      return textCard(
        "词意每日挑战排行榜",
        "榜上无名。今日第一个猜中的人，会写在这里。"
      );
    }
    return textCard(
      "词意每日挑战排行榜",
      entries.map(
        (e, i) => `${String(i + 1).padStart(2, "0")}. ${e.username || "无名氏"} ${e.score} 次`
      ),
      hidden > 0 ? `⋯ 另有 ${hidden} 人在榜 ⋯` : null
    );
  }

  // tx* 图片渲染 — 复用 Koishi Canvas 服务；没有服务时无损回退为文本
  async function renderCard(render: () => Promise<Buffer>): Promise<h | null> {
    if (!cfg.renderImage || !ctx.canvas) return null;
    try {
      const buffer = await render();
      return h.image(buffer, "image/png");
    } catch (error: any) {
      logger.warn("图片渲染失败，本次回退为文本：%s", error?.message ?? error);
      return null;
    }
  }

  async function sendCard(session: Session, render: () => Promise<Buffer>, fallback: string) {
    const image = await renderCard(render);
    const prefix: h[] = [];
    if (cfg.quoteReply && session.messageId) prefix.push(h.quote(session.messageId));
    if (cfg.atReply) prefix.push(h.at(session.userId), h("p"));
    if (image) {
      await session.send([...prefix, image]);
      return;
    }
    await session.send([...prefix, ...h.normalize(fallback)]);
  }

  // zlhs* 指令实现
  async function wf(session: Session) {
    // 本群可能用 ciyi.裸词 临时改过续猜方式，玩法说明要按本群的生效状态来讲
    const channelOn = middlewareOn(session.channelId);
    return await sendCard(
      session,
      () =>
        renderIntroCard(ctx.canvas, {
          total: allWords.length,
          words: allWords.length,
          middleware: channelOn,
        }),
      introText(channelOn)
    );
  }

  async function phb(session: Session) {
    // 排序与截断交给数据库，只有前 maxRank 行进内存
    const [shown, players] = await Promise.all([
      ctx.database
        .select("ciyi_rank")
        .orderBy("score", "desc")
        .limit(cfg.maxRank)
        .execute(),
      ctx.database.select("ciyi_rank").execute((row) => $.count(row.id)),
    ]);
    const hidden = Math.max(0, players - shown.length);

    return await sendCard(
      session,
      () =>
        renderRankCard(ctx.canvas, {
          entries: shown.map((it) => ({
            username: it.username,
            score: it.score,
            me: it.userId === session.userId,
          })),
          hidden,
          players,
        }),
      rankText(shown, hidden)
    );
  }

  /** 未完成的旧题继续保留；只有已封题且跨日后才生成新题。 */
  async function getTodayGame(session: Session): Promise<Ciyi | null> {
    const current = (
      await ctx.database.get("ciyi", { channelId: session.channelId })
    )[0];

    if (
      current &&
      (!current.isOver ||
        isSameDayInChina(session.timestamp, current.lastStartTimestamp))
    ) {
      return current;
    }

    const oldGuessedWords = current?.guessedWords ?? [];
    const answer = getNewUniqueAnswer(oldGuessedWords);
    if (!answer) {
      logger.warn("没有可用的词语，无法开始新游戏");
      return null;
    }

    const source = await fetchCiYi(answer);
    const rankList = source
      ?.split(/\r?\n/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (!rankList?.length) {
      logger.warn(`获取词库 ${answer}.txt 失败`);
      return null;
    }

    const data = {
      channelId: session.channelId,
      answer,
      lastStartTimestamp: new Date(session.timestamp),
      guessedWords: [...oldGuessedWords, answer],
      rankList,
      isOver: false,
      guessedHistoryInOneGame: [],
      history: [],
    };

    if (!current) return await ctx.database.create("ciyi", data);

    await ctx.database.set("ciyi", { id: current.id }, data);
    return { ...current, ...data };
  }

  async function c(session: Session, guess: string) {
    if (!guess || Array.from(guess).length !== 2) {
      return await sendMsg(session, "⚠️ 词意只收两字词。例：ciyi.猜 山水");
    }
    if (!allWords.includes(guess)) {
      return await sendMsg(session, `⚠️ 「${guess}」不在词库中，换个常见些的词试试。`);
    }

    const gameInfo = await getTodayGame(session);
    if (!gameInfo) {
      return await sendMsg(
        session,
        "❌ 今日题目暂时无法载入，请稍后再试。"
      );
    }

    // 经过上面的逻辑，如果游戏仍然是结束状态，那说明是“当天”的挑战已结束
    if (gameInfo.isOver) {
      return await sendMsg(
        session,
        `今日挑战已结束。答案是「${gameInfo.answer}」\n明日零点换新题。发送 ciyi.排行榜 查看战绩。`
      );
    }

    if (gameInfo.guessedHistoryInOneGame.includes(guess)) {
      // 与其只说一句「已猜过」，不如把上次的结果一并奉还，省去玩家往上翻
      const old = gameInfo.history.find((it) => it.guess === guess);
      return await sendMsg(
        session,
        old
          ? `⚠️ 「${guess}」已猜过 · #${old.rank} · ${tierOf(old.rank).name}`
          : `⚠️ 「${guess}」已猜过`
      );
    }

    if (guess === gameInfo.answer) {
      await ctx.database.set(
        "ciyi",
        { channelId: session.channelId },
        {
          isOver: true,
          history: [],
          guessedHistoryInOneGame: [],
        }
      );

      const playerInfo = await ctx.database.get("ciyi_rank", {
        userId: session.userId,
      });
      const score = playerInfo.length === 0 ? 1 : playerInfo[0].score + 1;
      if (playerInfo.length === 0) {
        await ctx.database.create("ciyi_rank", {
          userId: session.userId,
          username: session.username,
          score,
        });
      } else {
        await ctx.database.set(
          "ciyi_rank",
          { userId: session.userId },
          {
            username: session.username,
            score,
          }
        );
      }

      const win = {
        answer: gameInfo.answer,
        attempts: gameInfo.history.length + 1,
        closest: bestRank(gameInfo.history),
        // 榜首是答案自己，紧随其后的几个才是「最像它的词」
        neighbors: gameInfo.rankList.slice(1, 6),
        username: session.username,
        score,
        canStartToday: !isSameDayInChina(
          session.timestamp,
          gameInfo.lastStartTimestamp
        ),
      };
      return await sendCard(session, () => renderWinCard(ctx.canvas, win), winText(win));
    }

    const rankList = gameInfo.rankList;
    const entry = getHistory(guess, rankList);
    if (!entry) {
      // 词库与今日榜单理论上同源，真出现落差时说清楚，别让玩家以为是自己打错了
      logger.warn(`「${guess}」不在 ${gameInfo.answer} 的榜单中`);
      return await sendMsg(session, `⚠️ 「${guess}」不在今日榜单中，换个词试试。`);
    }

    const history = [...gameInfo.history, entry];
    await ctx.database.set(
      "ciyi",
      { channelId: session.channelId },
      {
        guessedHistoryInOneGame: [...gameInfo.guessedHistoryInOneGame, guess],
        history,
      }
    );

    const { rows, hidden } = layout(history, guess);
    const near = nearness(entry.rank, rankList.length);
    return await sendCard(
      session,
      () =>
        renderBoardCard(ctx.canvas, {
          rows,
          total: rankList.length,
          attempts: history.length,
          tip:
            hidden > 0 && !rows.some((r) => r.gapBefore)
              ? `另有 ${hidden} 词未列 · 亲近度 ${near}%`
              : `亲近度 ${near}% · ${tierOf(entry.rank).note}`,
        }),
      boardText(rows, hidden, history.length)
    );
  }

  async function fetchCiYi(word: string): Promise<string | null> {
    const url = `https://ci-ying.oss-cn-zhangjiakou.aliyuncs.com/v1/ci-yi-list/${word}.txt`;

    try {
      const response = await ctx.http.get(url, {
        responseType: 'text'
      });

      return response;
    } catch (error) {
      logger.error("Error fetching data:", error);
      return null;
    }
  }

  function isSameDayInChina(timestamp1: number, timestamp2: Date): boolean {
    const toChinaDateString = (ts: Date | number) =>
      new Date(ts).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });

    return toChinaDateString(timestamp1) === toChinaDateString(timestamp2);
  }

  async function sendMsg(session: Session, msg: string) {
    const prefix: h[] = [];
    if (cfg.quoteReply && session.messageId) prefix.push(h.quote(session.messageId));
    if (cfg.atReply) prefix.push(h.at(session.userId), h("p"));
    await session.send([...prefix, ...h.normalize(msg)]);
  }
}
