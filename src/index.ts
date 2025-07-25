import { Context, h, Random, Schema, Session } from "koishi";
import allWords from "./data/allWords.json";
import questionList from "./data/questionList.json";

export const name = "ciyi";
export const usage = `## 使用

1. 设置指令别名。
2. 发送 \`ciyi\` 查看帮助。

## QQ 群

* 956758505`;
export const inject = ["database"];

// pz*
export interface Config {
  atReply: boolean;
  quoteReply: boolean;
  isEnableMiddleware: boolean;
  maxHistory: number;
  maxRank: number;
}

export const Config: Schema<Config> = Schema.object({
  atReply: Schema.boolean().default(false).description("响应时 @"),
  quoteReply: Schema.boolean().default(true).description("响应时引用"),
  isEnableMiddleware: Schema.boolean()
    .default(false)
    .description("是否启用中间件（若启用，猜测词语时可以不使用指令直接猜测）"),
  maxHistory: Schema.number().default(10).min(0).description("最大历史记录数"),
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

interface History {
  guess: string;
  rank: number;
  leftHint: string;
  rightHint: string;
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
  ctx.command("ciyi", "词意（猜词游戏）");
  // mryt* mrtz*
  ctx.command("ciyi.每日挑战").action(async ({ session }) => {
    return await mrtz(session);
  });
  // c*
  ctx.command("ciyi.猜 <guess:string>").action(async ({ session }, guess) => {
    return await c(session, guess?.trim());
  });
  // phb*
  ctx.command("ciyi.排行榜").action(async ({ session }) => {
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

  function formatCiyiRanks(ranks: CiyiRank[]): string {
    ranks.sort((a, b) => b.score - a.score);

    const maxRank = cfg.maxRank;

    const needsSlicing = maxRank !== undefined && maxRank < ranks.length;
    const slicedRanks = needsSlicing ? ranks.slice(0, maxRank) : ranks;

    const formattedString = slicedRanks
      .map((rank, index) => {
        return `${index + 1}. ${rank.username} ${rank.score}`;
      })
      .join("\n");

    return needsSlicing ? `${formattedString}\n...` : formattedString;
  }

  function formatHistories(histories: History[]): string {
    const sortedHistories = histories.sort((a, b) => a.rank - b.rank);
    const maxHistory = cfg.maxHistory;

    const needsSlicing =
      maxHistory !== undefined && maxHistory < sortedHistories.length;
    const slicedHistories = needsSlicing
      ? sortedHistories.slice(0, maxHistory)
      : sortedHistories;

    const formattedString = slicedHistories
      .map((history, index) => {
        const leftHintChar =
          history.leftHint.length > 1 ? history.leftHint[1] : "？";
        const rightHintChar =
          history.rightHint.length > 0 ? history.rightHint[0] : "？";
        return `${index + 1}. ？${leftHintChar}）${
          history.guess
        }（${rightHintChar}？ #${history.rank}`;
      })
      .join("\n");

    return needsSlicing ? `${formattedString}\n...` : formattedString;
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

  async function phb(session: Session) {
    const ranks = await ctx.database.get("ciyi_rank", {});
    const formattedRanks = formatCiyiRanks(ranks);

    const msg = `词意每日挑战排行榜：
${formattedRanks}`;

    return await sendMsg(session, msg);
  }

  async function c(session: Session, guess: string) {
    if (!guess || guess.length !== 2) {
      return await sendMsg(session, "请输入两字词语！");
    }
    if (!allWords.includes(guess)) {
      return await sendMsg(session, "${guess} 不在词库中");
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
        return sendMsg(session, "开始新挑战失败：题库已尽。");
      }

      const rankList = (await fetchCiYi(answer))?.trim().split("\n");
      if (!rankList) {
        logger.warn(`获取词库 ${answer}.txt 失败`);
        return sendMsg(session, "开始新挑战失败：无法获取词库，请稍后再试。");
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
      return await sendMsg(session, "今日挑战已结束！");
    }

    if (gameInfo.guessedHistoryInOneGame.includes(guess)) {
      return await sendMsg(session, `${guess} 已猜过`);
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

      const msg = `恭喜你猜对了！
答案：${gameInfo.answer}
猜测：${gameInfo.history.length + 1} 次`;

      const playerInfo = await ctx.database.get("ciyi_rank", {
        userId: session.userId,
      });
      if (playerInfo.length === 0) {
        await ctx.database.create("ciyi_rank", {
          userId: session.userId,
          username: session.username,
          score: 1,
        });
      } else {
        await ctx.database.set(
          "ciyi_rank",
          { userId: session.userId },
          {
            username: session.username,
            score: playerInfo[0].score + 1,
          }
        );
      }
      return await sendMsg(session, msg);
    }
    const rankList = gameInfo.rankList;
    const history = [...gameInfo.history, getHistory(guess, rankList)];
    await ctx.database.set(
      "ciyi",
      { channelId: session.channelId },
      {
        guessedHistoryInOneGame: [...gameInfo.guessedHistoryInOneGame, guess],
        history,
      }
    );

    const historyString = formatHistories(history);
    return await sendMsg(session, historyString);
  }

  async function mrtz(session: Session) {
    const timestamp = session.timestamp;
    const gameInfo = await ctx.database.get("ciyi", {
      channelId: session.channelId,
    });
    const isNone = gameInfo.length === 0;
    if (!isNone) {
      if (isSameDayInChina(timestamp, gameInfo[0].lastStartTimestamp)) {
        return await sendMsg(session, "今日挑战早已开始！");
      }
      if (!gameInfo[0].isOver) {
        return await sendMsg(session, "存在未完成的挑战！");
      }
    }
    let answer = getNewUniqueAnswer(gameInfo[0].guessedWords);
    const rankList = (await fetchCiYi(answer))?.trim().split("\n");
    if (!rankList) {
      logger.warn(`获取词库 ${answer}.txt 失败`);
      return sendMsg(session, "开始新挑战失败：无法获取词库，请稍后再试。");
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
          guessedWords: [...gameInfo[0].guessedWords, `${answer}`],
          rankList: rankList,
          isOver: false,
          guessedHistoryInOneGame: [],
          history: [],
        }
      );
    }

    const msg = `每日词意挑战开始！

目标
    猜出系统选择的两字词语

反馈
    每次猜测后，获得相似度排名与相邻词提示

    例如: \`?好) 企业 (地? #467\`
        #467      → 相似度排名 (越小越近)
        ?好 / 地? → 相邻词提示 (? 为隐藏字)

周期
    每日一词，猜对则次日刷新
    系统记录猜对次数，可查排行`;
    return await sendMsg(session, msg);
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
