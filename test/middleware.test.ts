import assert from "node:assert/strict";
import test from "node:test";
import { h, Session } from "koishi";
import {
  canHandleMiddlewareGuess,
  Ciyi,
  getMiddlewareGuess,
} from "../src";

function session(
  elements: h[],
  options: { quote?: boolean; isBot?: boolean } = {}
): Session {
  return {
    event: {
      user: { isBot: options.isBot },
      message: {
        elements,
        quote: options.quote ? { id: "quoted" } : undefined,
      },
    },
  } as unknown as Session;
}

function game(overrides: Partial<Ciyi> = {}): Ciyi {
  return {
    id: 1,
    channelId: "channel",
    answer: "山水",
    lastStartTimestamp: new Date("2026-09-01T00:00:00+08:00"),
    guessedWords: ["山水"],
    guessedHistoryInOneGame: [],
    rankList: ["山水", "天地", "风景"],
    history: [],
    isOver: false,
    ...overrides,
  };
}

test("只接受一条无修饰的两字中文词语", () => {
  assert.equal(getMiddlewareGuess(session([h.text("山水")])), "山水");

  for (const elements of [
    [h.text(" 山水")],
    [h.text("山水 ")],
    [h.text("山\n水")],
    [h.text("山")],
    [h.text("山水间")],
    [h.text("ab")],
    [h.text("饿饿")],
    [h.text("山水"), h.text("天地")],
    [h("at", { id: "bot" }), h.text("山水")],
    [h("image", { url: "https://example.com/image.png" })],
    [h("b", {}, "山水")],
  ]) {
    assert.equal(getMiddlewareGuess(session(elements)), null);
  }
});

test("引用消息和机器人消息不会触发裸词猜测", () => {
  assert.equal(
    getMiddlewareGuess(session([h.text("山水")], { quote: true })),
    null
  );
  assert.equal(
    getMiddlewareGuess(session([h.text("山水")], { isBot: true })),
    null
  );
});

test("没有已开始的游戏时，裸词不能开题", () => {
  assert.equal(canHandleMiddlewareGuess(undefined, "山水"), false);
  assert.equal(canHandleMiddlewareGuess(null, "山水"), false);
});

test("已封题后始终忽略裸词，跨日开题也必须使用完整指令", () => {
  const ended = game({ isOver: true });
  assert.equal(canHandleMiddlewareGuess(ended, "天地"), false);

  ended.lastStartTimestamp = new Date("2020-01-01T00:00:00+08:00");
  assert.equal(canHandleMiddlewareGuess(ended, "天地"), false);
});

test("未结束的旧题仍可继续，但重复词与榜外词不触发", () => {
  const active = game({
    lastStartTimestamp: new Date("2020-01-01T00:00:00+08:00"),
    guessedHistoryInOneGame: ["天地"],
  });

  assert.equal(canHandleMiddlewareGuess(active, "山水"), true);
  assert.equal(canHandleMiddlewareGuess(active, "天地"), false);
  assert.equal(canHandleMiddlewareGuess(active, "企业"), false);
  assert.equal(canHandleMiddlewareGuess(game({ rankList: [] }), "天地"), false);
});
