// test/http.test.ts —— HTTP 样板单测（sendJson/isCrossOrigin/queryParam/checkCsrf/readBody/guardBody）。

import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson,
  isCrossOrigin,
  queryParam,
  checkCsrf,
  readBody,
  guardBody,
} from "../lib/http.ts";

interface ResShape {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  headersSent: boolean;
  writableEnded: boolean;
  writeHead: (status: number, headers: Record<string, unknown>) => void;
  end: (body: string) => void;
}

function fakeRes(): ResShape & ServerResponse {
  // 只验证 writeHead/end 累积结果，不真发网络。headersSent/writableEnded 跟随
  // 真实 ServerResponse 的语义置位，才能覆盖 sendJson 的重复写保护。
  const res: ResShape = {
    status: 0,
    headers: {},
    body: "",
    headersSent: false,
    writableEnded: false,
    writeHead(status: number, headers: Record<string, unknown>): void {
      this.status = status;
      this.headers = headers as Record<string, string | string[] | undefined>;
      this.headersSent = true;
    },
    end(body: string): void {
      this.body = body;
      this.writableEnded = true;
    },
  };
  return res as unknown as ResShape & ServerResponse;
}

function fakeReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { headers: {}, url: "/", ...overrides } as unknown as IncomingMessage;
}

function bodyStream(text: string): IncomingMessage {
  return Readable.from([text]) as unknown as IncomingMessage;
}

/** 带 body 流且可附加 header 的请求（CSRF + body 组合场景）。 */
function fakeReqWithBody(text: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([text]) as unknown as IncomingMessage & {
    headers: Record<string, string>;
  };
  stream.headers = headers;
  return stream;
}

describe("sendJson", () => {
  it("写 JSON + no-store 头", () => {
    const res = fakeRes();
    sendJson(res, 200, { ok: true, count: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true,"count":1}');
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("重复写同一响应静默跳过（不发第二份头 → 不抛 ERR_HTTP_HEADERS_SENT）", () => {
    const res = fakeRes();
    sendJson(res, 200, { ok: true });
    expect(() => {
      sendJson(res, 500, { ok: false, error: "late failure" });
    }).not.toThrow();
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("只结束未发头时也跳过", () => {
    const res = fakeRes();
    res.writableEnded = true;
    sendJson(res, 200, { ok: true });
    expect(res.status).toBe(0);
  });
});

describe("isCrossOrigin", () => {
  it("空头放行（CLI/curl 本地调用面）", () => {
    expect(isCrossOrigin(fakeReq())).toBe(false);
  });

  it("same-origin / none 放行", () => {
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "same-origin" } }))).toBe(false);
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "none" } }))).toBe(false);
  });

  it("cross-site 拒绝", () => {
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "cross-site" } }))).toBe(true);
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "https://evil.example" } }))).toBe(
      true,
    );
  });
});

describe("queryParam", () => {
  it("读取 + 解码（+ 转空格）", () => {
    expect(queryParam(fakeReq({ url: "/x?a=b+c&d=%E4%B8%AD" }), "a")).toBe("b c");
    expect(queryParam(fakeReq({ url: "/x?a=b+c&d=%E4%B8%AD" }), "d")).toBe("中");
    expect(queryParam(fakeReq({ url: "/x?a=b" }), "missing")).toBeNull();
  });

  it("非法 url 返回 null", () => {
    expect(queryParam(fakeReq({ url: "http://[" }), "a")).toBeNull();
  });

  it("url 缺失（undefined/空串）按空路径解析，参数取不到但不抛", () => {
    expect(queryParam(fakeReq({ url: undefined }), "a")).toBeNull();
    expect(queryParam(fakeReq({ url: "/x?a=b" }), "a")).toBe("b");
  });
});

describe("checkCsrf", () => {
  it("header 命中且非空通过；不匹配/缺失拒绝", () => {
    const token = "t-123";
    expect(checkCsrf(fakeReq({ headers: { "x-test": token } }), token, "x-test")).toBe(true);
    expect(checkCsrf(fakeReq({ headers: { "x-test": "wrong" } }), token, "x-test")).toBe(false);
    expect(checkCsrf(fakeReq(), token, "x-test")).toBe(false);
    expect(checkCsrf(fakeReq({ headers: { "x-test": "" } }), token, "x-test")).toBe(false);
  });

  it("数组 header 取首项", () => {
    const token = "t-1";
    expect(checkCsrf(fakeReq({ headers: { "x-test": ["bad", token] } }), token, "x-test")).toBe(
      false,
    );
    expect(checkCsrf(fakeReq({ headers: { "x-test": [token] } }), token, "x-test")).toBe(true);
  });
});

describe("readBody", () => {
  it("完整读回字符串块（超限/中断各自回报原因）", async () => {
    await expect(readBody(bodyStream("hello"), 100)).resolves.toStrictEqual({
      ok: true,
      text: "hello",
    });
    await expect(readBody(bodyStream("hello"), 4)).resolves.toStrictEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("多字节字符跨 chunk 边界不被解码成 U+FFFD", async () => {
    // 逐块 String(chunk) 的回归：中文按 UTF-8 占 3 字节，chunk 落在字符中间时
    // 会得到替换字符且仍是合法 JSON —— 静默写坏用户数据。
    const buf = Buffer.from('{"k":"中文整理测试"}', "utf8");
    const cutPoints: number[] = [];
    for (let cut = 1; cut < buf.length; cut += 1) {
      cutPoints.push(cut);
    }
    const reads = await Promise.all(
      cutPoints.map(async (cut) => {
        const stream = Readable.from([buf.subarray(0, cut), buf.subarray(cut)]);
        return readBody(stream as unknown as IncomingMessage, 1_000_000);
      }),
    );
    const wanted = { ok: true, text: buf.toString("utf8") };
    expect(reads).toStrictEqual(cutPoints.map(() => wanted));
  });

  it("Buffer 块与 string 块混排一致", async () => {
    const mixed = Readable.from([Buffer.from("a中"), "b", Buffer.from("c")]);
    await expect(readBody(mixed as unknown as IncomingMessage, 100)).resolves.toStrictEqual({
      ok: true,
      text: "a中bc",
    });
  });

  it("content-length 超限时不读流（大 body 不占内存）", async () => {
    let pulled = false;
    const src = new Readable({
      read(): void {
        pulled = true;
        this.push("x".repeat(10));
        this.push(null);
      },
    });
    const req = Object.assign(src, {
      headers: { "content-length": "999999" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 10)).resolves.toStrictEqual({ ok: false, reason: "too-large" });
    expect(pulled).toBe(false);
  });

  it("content-length 合法时照常读取", async () => {
    const req = Object.assign(Readable.from(["ok"]), {
      headers: { "content-length": "2" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 10)).resolves.toStrictEqual({ ok: true, text: "ok" });
  });

  it("content-length 非数字（分块传输）不参与判定", async () => {
    const req = Object.assign(Readable.from(["chunked"]), {
      headers: { "content-length": "abc" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 100)).resolves.toStrictEqual({ ok: true, text: "chunked" });
  });

  it("流错误返回 aborted（不抛）", async () => {
    const errStream = new Readable({
      read(): void {
        this.destroy(new Error("boom"));
      },
    }) as unknown as IncomingMessage;
    await expect(readBody(errStream, 100)).resolves.toStrictEqual({ ok: false, reason: "aborted" });
  });
});

describe("guardBody", () => {
  it("跨域 403", async () => {
    const res = fakeRes();
    const out = await guardBody(fakeReq({ headers: { "sec-fetch-site": "cross-site" } }), res, {
      maxBytes: 100,
    });
    expect(out).toBeNull();
    expect(res.status).toBe(403);
  });

  it("CSRF 错 403；正确则回 body", async () => {
    const res = fakeRes();
    const token = "t";
    const denied = await guardBody(fakeReq({ headers: { "x-c": "bad" } }), res, {
      maxBytes: 100,
      csrf: { token, headerName: "x-c" },
    });
    expect(denied).toBeNull();
    expect(res.status).toBe(403);
    const ok = await guardBody(fakeReqWithBody("payload", { "x-c": token }), fakeRes(), {
      maxBytes: 100,
      csrf: { token, headerName: "x-c" },
    });
    expect(ok).toBe("payload");
  });

  it("body 超限 413", async () => {
    const res = fakeRes();
    const out = await guardBody(bodyStream("12345"), res, { maxBytes: 2 });
    expect(out).toBeNull();
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, error: "request body too large" });
  });

  it("流中断报 400 而不是冒充 413", async () => {
    const res = fakeRes();
    const errStream = new Readable({
      read(): void {
        this.destroy(new Error("client hung up"));
      },
    }) as unknown as IncomingMessage;
    await expect(guardBody(errStream, res, { maxBytes: 100 })).resolves.toBeNull();
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, error: "request body unreadable" });
  });
});
