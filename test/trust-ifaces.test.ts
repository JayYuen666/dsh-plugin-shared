// test/trust-ifaces.test.ts —— 把 `os` 打桩，验 `requestTrust` 缺省地址面那条回落支路。
//
// 为什么要单开一份：`lib/trust.ts` 不注入 `localInterfaceAddresses` 时读 `os.networkInterfaces()`，
// 而真实机器的网卡表**逐台不同**——用真值做断言的测试会在别的机器上改结论。这里给一张写死的表，
// 顺带覆盖两形：某个接口名映射到 `undefined`（Node 的类型允许，真实 macOS 给不出），
// 以及 IPv6 址要按 `[地址]` 的形态才与 `URL.hostname` 对得上。
import type { NetworkInterfaceInfo } from "node:os";
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";

/** 当前这份桩网卡表（hoisted 才能在 vi.mock 的工厂里被引用）。 */
// 桩网卡表按 `os.networkInterfaces()` 的真实返回类型声明（`Dict<NetworkInterfaceInfo[]>`），
// 而不是松松的 `Record<string, unknown>`：`vi.mock(import("node:os"), ...)` 会把工厂按真模块面校验，
// 用 unknown 索引签名会在此处直接不兼容（实测 TS2769 就是这个根因）。
const stub = vi.hoisted(() => ({ current: {} as NodeJS.Dict<NetworkInterfaceInfo[]> }));

// 以真模块为底、只替换 networkInterfaces：早先的写法把整个 `node:os` 换成了只含
// networkInterfaces 的对象，其余 os API 在被测路径上一经调用就是 undefined（vitest 的类型
// 也是这么要求的：`default` 必须是完整的 `typeof import("node:os")`）。
vi.mock(import("node:os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, networkInterfaces: () => stub.current },
    networkInterfaces: () => stub.current,
  };
});

const { requestTrust } = await import("../lib/trust.ts");

/** 手搓 IncomingMessage（与 test/trust.test.ts 同口径）。 */
function fakeReq(headers: Record<string, unknown>): Parameters<typeof requestTrust>[0] {
  return { headers, url: "/" } as unknown as Parameters<typeof requestTrust>[0];
}

describe("requestTrust 的缺省地址面（os 打桩）", () => {
  it("接口名映射到 undefined 时不许炸，按「没有这台地址」处理", () => {
    stub.current = { en0: undefined };
    assert.equal(
      requestTrust(fakeReq({ host: "10.1.2.3:8787" }), { servingNonLoopback: true }),
      "untrusted-host",
    );
  });

  it("IPv4 与 IPv6 实装址都算本机权威（IPv6 必须折成 [址] 才比得上）", () => {
    stub.current = {
      // 字段按 `NetworkInterfaceInfoIPv4/IPv6` 写全：`trust.ts` 只读 address，
      // 但桩数据必须是真形状，否则下一位读 mac/internal 的代码会在桩上拿到 undefined。
      en0: [
        {
          address: "10.1.2.3",
          family: "IPv4",
          netmask: "255.255.255.0",
          mac: "aa:bb:cc:dd:ee:01",
          internal: false,
          cidr: "10.1.2.3/24",
        },
      ],
      en1: [
        {
          address: "fd00::9",
          family: "IPv6",
          netmask: "ffff:ffff::",
          scopeid: 0,
          mac: "aa:bb:cc:dd:ee:02",
          internal: false,
          cidr: "fd00::9/64",
        },
      ],
    };
    assert.equal(
      requestTrust(fakeReq({ host: "10.1.2.3:8787" }), { servingNonLoopback: true }),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ host: "[fd00::9]:8787" }), { servingNonLoopback: true }),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ host: "fd00::9:8787" }), { servingNonLoopback: true }),
      "untrusted-host",
      "不带方括号的 IPv6 不是合法 authority 形态",
    );
  });
});
