import { Context, h, Random, Schema, Session } from "koishi";
import {} from "koishi-plugin-puppeteer";
import allWords from "./data/allWords.json";
import questionList from "./data/questionList.json";
import {
  BoardRow,
  History,
  boardCard,
  introCard,
  nearness,
  rankCard,
  startCard,
  tierOf,
  winCard,
} from "./view";

export const name = "ciyi";
export const usage = `# 词意

按「意思有多近」找词：系统每天藏起一个两字词，你报词，它回你这个词与答案的语义排名。
名次越小越近，**#1 就是答案本身**。

## 使用

1. 设置指令别名（推荐把 \`ciyi.猜\` 设为 \`猜\`）。
2. 发送 \`ciyi\` 查看图文玩法说明。

## 图片

安装 \`puppeteer\` 服务后，玩法、开局、猜测板、揭晓与排行榜都会渲染成「墨与纸」风格的卡片；
未安装、渲染失败或关掉「渲染图片」时，自动回退为等价文本，玩法不受影响。

## QQ 群

* 956758505`;

export const inject = { required: ["database"], optional: ["puppeteer"] };

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
  quoteReply: Schema.boolean().default(true).description("响应时引用"),
  isEnableMiddleware: Schema.boolean()
    .default(false)
    .description("是否启用中间件（若启用，猜测词语时可以不使用指令直接猜测）"),
  renderImage: Schema.boolean()
    .default(true)
    .description("渲染图片（需要 puppeteer 服务；关闭或渲染失败时使用等价文本）"),
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

  // zjj*
  if (cfg.isEnableMiddleware) {
    ctx.middleware(async (session, next) => {
      const text = `${h.select(session.event.message.elements, "text")}`;
      if (text.length !== 2) {
        return await next();
      }
      if (!allWords.includes(text)) {
        return await next();
      }
      const gameInfo = await ctx.database.get("ciyi", {
        channelId: session.channelId,
      });
      if (gameInfo.length === 0 || gameInfo[0].isOver) {
        return await next();
      }
      await session.execute(`ciyi.猜 ${text}`);
    });
  }

  // zl*
  ctx.command("ciyi", "词意（猜词游戏）").action(async ({ session }) => {
    return await wf(session);
  });
  // mryt* mrtz*
  ctx.command("ciyi.每日挑战", "开启今日题目").action(async ({ session }) => {
    return await mrtz(session);
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
  // 没有 puppeteer 时走这条路。文本不是图片的残次品，排版一样要站得住：
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

  function introText(): string {
    return textCard(
      "词意 · 按意思远近找词",
      `每天藏起一个两字词。你报词，我回它与答案的语义排名 —— 名次越小越近，#1 就是答案本身。`,
      [
        `其一　ciyi.每日挑战　开今天的题`,
        `其二　ciyi.猜 山水　　报一个两字词${
          cfg.isEnableMiddleware ? "（也可直接发词）" : ""
        }`,
        `其三　ciyi.排行榜　　看谁猜中得最多`,
      ],
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

  function startText(left: number): string {
    return textCard(
      "词意每日挑战 · 今日题目已开",
      [
        `目标　在 ${allWords.length.toLocaleString()} 个两字词里，找出今天被藏起来的那一个`,
        `反馈　每次猜测回你一个语义名次，外加左右邻词各遮一字`,
        `　　　例：？好）企业（地？ #467 · 沾边`,
        `　　　左邻更近答案，右邻更远，#1 即是答案`,
        `周期　一词一日，猜中即封题，次日零点换新`,
      ],
      `题库尚余 ${left.toLocaleString()} 题 · 报词请用 ciyi.猜 山水`
    );
  }

  function winText(o: {
    answer: string;
    attempts: number;
    closest: number | null;
    neighbors: string[];
    username: string;
    score: number;
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
      "明日零点换新题 · ciyi.排行榜 看战绩"
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

  // tx* 图片渲染
  //
  // puppeteer 是可选服务：没装、渲染超时、字体没就绪，都只是「这次没有图」，
  // 一律安静地回退到等价文本，绝不让一局游戏卡在渲染上。
  async function renderCard(html: string): Promise<string | null> {
    if (!cfg.renderImage || !ctx.puppeteer) return null;
    try {
      return await ctx.puppeteer.render("", async (page, next) => {
        try {
          // 视口给得比最宽的猜测板还宽，让卡片按内容自然收缩而不是被挤到换行
          await page.setViewport({
            width: 1400,
            height: 900,
            deviceScaleFactor: 2,
          });
          await page.setContent(html, { waitUntil: "load", timeout: 15000 });
          // 中文衬线体加载完再截图，否则会拍到一张回退字体的板
          await page.evaluate(async () => {
            await (document as any).fonts?.ready;
          });
          const card = await page.$("#card");
          return await next((card ?? undefined) as any);
        } catch (error) {
          // render() 只在回调正常返回后关页，出错这条路得自己收尾
          await page.close().catch(() => {});
          throw error;
        }
      });
    } catch (error: any) {
      logger.warn("图片渲染失败，本次回退为文本：%s", error?.message ?? error);
      return null;
    }
  }

  async function sendCard(session: Session, html: string, fallback: string) {
    const image = await renderCard(html);
    return await sendMsg(session, image ?? fallback);
  }

  // zlhs* 指令实现
  async function wf(session: Session) {
    return await sendCard(
      session,
      introCard({
        total: allWords.length,
        words: allWords.length,
        middleware: cfg.isEnableMiddleware,
      }),
      introText()
    );
  }

  async function phb(session: Session) {
    const ranks = await ctx.database.get("ciyi_rank", {});
    const sorted = [...ranks].sort((a, b) => b.score - a.score);
    const max = cfg.maxRank;
    const shown = max < sorted.length ? sorted.slice(0, max) : sorted;
    const hidden = sorted.length - shown.length;

    return await sendCard(
      session,
      rankCard({
        entries: shown.map((it) => ({
          username: it.username,
          score: it.score,
          me: it.userId === session.userId,
        })),
        hidden,
        players: sorted.length,
      }),
      rankText(shown, hidden)
    );
  }

  async function c(session: Session, guess: string) {
    if (!guess || Array.from(guess).length !== 2) {
      return await sendMsg(session, "词意只收两字词 · 例：ciyi.猜 山水");
    }
    if (!allWords.includes(guess)) {
      return await sendMsg(session, `「${guess}」不在词库中 · 换个常见些的词试试`);
    }

    // 使用 let 因为 gameInfo 可能会被重新赋值
    let gameInfo = (
      await ctx.database.get("ciyi", {
        channelId: session.channelId,
      })
    )[0];

    // 新增逻辑：如果游戏从未开始，或者已结束且日期已是新的一天，则自动开始新游戏
    if (
      !gameInfo ||
      (gameInfo.isOver &&
        !isSameDayInChina(session.timestamp, gameInfo.lastStartTimestamp))
    ) {
      const timestamp = session.timestamp;
      const oldGuessedWords = gameInfo ? gameInfo.guessedWords : [];

      let answer = getNewUniqueAnswer(oldGuessedWords);
      if (!answer) {
        logger.warn("没有可用的词语，无法开始新游戏");
        return await sendMsg(session, "开始新挑战失败：题库已尽。");
      }

      const rankList = (await fetchCiYi(answer))?.trim().split("\n");
      if (!rankList) {
        logger.warn(`获取词库 ${answer}.txt 失败`);
        return await sendMsg(
          session,
          "开始新挑战失败：无法获取词库，请稍后再试。"
        );
      }

      const newGameData = {
        channelId: session.channelId,
        answer,
        lastStartTimestamp: new Date(timestamp),
        guessedWords: [...oldGuessedWords, answer],
        rankList: rankList,
        isOver: false,
        guessedHistoryInOneGame: [],
        history: [],
      };

      if (!gameInfo) {
        await ctx.database.create("ciyi", newGameData);
      } else {
        await ctx.database.set(
          "ciyi",
          { channelId: session.channelId },
          newGameData
        );
      }

      // 关键：重新获取游戏信息，以便后续流程使用最新的状态
      gameInfo = (
        await ctx.database.get("ciyi", {
          channelId: session.channelId,
        })
      )[0];
    }

    // 经过上面的逻辑，如果游戏仍然是结束状态，那说明是“当天”的挑战已结束
    if (gameInfo.isOver) {
      return await sendMsg(
        session,
        `今日挑战已结束 · 答案是「${gameInfo.answer}」\n明日零点换新题 · ciyi.排行榜 看战绩`
      );
    }

    if (gameInfo.guessedHistoryInOneGame.includes(guess)) {
      // 与其只说一句「已猜过」，不如把上次的结果一并奉还，省去玩家往上翻
      const old = gameInfo.history.find((it) => it.guess === guess);
      return await sendMsg(
        session,
        old
          ? `「${guess}」已猜过 · #${old.rank} · ${tierOf(old.rank).name}`
          : `「${guess}」已猜过`
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
      };
      return await sendCard(session, winCard(win), winText(win));
    }

    const rankList = gameInfo.rankList;
    const entry = getHistory(guess, rankList);
    if (!entry) {
      // 词库与今日榜单理论上同源，真出现落差时说清楚，别让玩家以为是自己打错了
      logger.warn(`「${guess}」不在 ${gameInfo.answer} 的榜单中`);
      return await sendMsg(session, `「${guess}」不在今日榜单中 · 换个词试试`);
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
      boardCard({
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

  async function mrtz(session: Session) {
    const timestamp = session.timestamp;
    const gameInfo = await ctx.database.get("ciyi", {
      channelId: session.channelId,
    });
    const isNone = gameInfo.length === 0;
    if (!isNone) {
      if (isSameDayInChina(timestamp, gameInfo[0].lastStartTimestamp)) {
        return await sendMsg(
          session,
          gameInfo[0].isOver
            ? `今日挑战早已收官 · 答案是「${gameInfo[0].answer}」\n明日零点换新题`
            : `今日挑战早已开题 · 已猜 ${gameInfo[0].history.length} 词\n继续报词：ciyi.猜 山水`
        );
      }
      if (!gameInfo[0].isOver) {
        return await sendMsg(
          session,
          `上一题还没解出来 · 已猜 ${gameInfo[0].history.length} 词\n先把它拿下：ciyi.猜 山水`
        );
      }
    }

    // 首次开题时表里还没有记录，取旧词表要先绕开这个空
    const oldGuessedWords = isNone ? [] : gameInfo[0].guessedWords;
    const answer = getNewUniqueAnswer(oldGuessedWords);
    if (!answer) {
      logger.warn("没有可用的词语，无法开始新游戏");
      return await sendMsg(session, "开始新挑战失败：题库已尽。");
    }

    const rankList = (await fetchCiYi(answer))?.trim().split("\n");
    if (!rankList) {
      logger.warn(`获取词库 ${answer}.txt 失败`);
      return await sendMsg(
        session,
        "开始新挑战失败：无法获取词库，请稍后再试。"
      );
    }

    if (isNone) {
      await ctx.database.create("ciyi", {
        channelId: session.channelId,
        answer,
        lastStartTimestamp: new Date(timestamp),
        guessedWords: [`${answer}`],
        rankList: rankList,
        history: [],
        isOver: false,
        guessedHistoryInOneGame: [],
      });
    } else {
      await ctx.database.set(
        "ciyi",
        { channelId: session.channelId },
        {
          answer,
          lastStartTimestamp: new Date(timestamp),
          guessedWords: [...oldGuessedWords, `${answer}`],
          rankList: rankList,
          isOver: false,
          guessedHistoryInOneGame: [],
          history: [],
        }
      );
    }

    const left = Math.max(0, questionList.length - (oldGuessedWords.length + 1));
    return await sendCard(
      session,
      startCard({ total: rankList.length, words: allWords.length, left }),
      startText(left)
    );
  }

  async function fetchCiYi(word: string): Promise<string> {
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
    if (cfg.atReply) {
      msg = `${h.at(session.userId)}${h("p", "")}${msg}`;
    }

    if (cfg.quoteReply) {
      msg = `${h.quote(session.messageId)}${msg}`;
    }

    await session.send(msg);
  }
}
