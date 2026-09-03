import assert from "node:assert/strict";
import test from "node:test";
import { h, Session } from "koishi";
import {
  canHandleMiddlewareGuess,
  Ciyi,
  getMiddlewareGuess,
  resolveMiddlewareSwitch,
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

test("无参切换在「配置默认」与「临时相反」之间往返", () => {
  assert.deepEqual(resolveMiddlewareSwitch(true, undefined, undefined), {
    override: false,
    on: false,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(false, undefined, undefined), {
    override: true,
    on: true,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(true, false, undefined), {
    override: undefined,
    on: true,
    reverted: true,
  });
  assert.deepEqual(resolveMiddlewareSwitch(false, true, ""), {
    override: undefined,
    on: false,
    reverted: true,
  });
});

test("显式开/关与配置同值时回到配置，不留与配置相同的冗余覆盖", () => {
  assert.deepEqual(resolveMiddlewareSwitch(true, undefined, "开"), {
    override: undefined,
    on: true,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(true, false, "开启"), {
    override: undefined,
    on: true,
    reverted: true,
  });
  assert.deepEqual(resolveMiddlewareSwitch(false, undefined, "关"), {
    override: undefined,
    on: false,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(false, true, "关闭"), {
    override: undefined,
    on: false,
    reverted: true,
  });
  assert.deepEqual(resolveMiddlewareSwitch(true, undefined, "关"), {
    override: false,
    on: false,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(false, undefined, "开"), {
    override: true,
    on: true,
    reverted: false,
  });
});

test("状态查询只查不改，其余参数报用法错误", () => {
  assert.deepEqual(resolveMiddlewareSwitch(true, false, "状态"), {
    override: false,
    on: false,
    reverted: false,
  });
  assert.deepEqual(resolveMiddlewareSwitch(true, undefined, " 状态 "), {
    override: undefined,
    on: true,
    reverted: false,
  });
  for (const bad of ["切换", "on", "off", "山水"]) {
    const result = resolveMiddlewareSwitch(true, undefined, bad);
    assert.equal("error" in result, true, `参数「${bad}」应报错`);
  }
});
