// test/publish-manifest.test.ts —— 发布形态门禁：入口面必须**与发布器无关**地可解析。
//
// 为什么值得一条测试：其余门禁都在源码侧（内存构建 vs 磁盘 dist），而真实故障都发生在装出去
// 之后。两类坑都在那一侧：入口指向没随包发出去的文件；入口覆盖写在 `publishConfig` 里——
// pnpm 发布时把它合并到顶层，npm 不合并，同一个仓库换个发布器就发出一个 import 必失败的包，
// 而构建全绿、测试全绿。这里不模仿任何发布器的实现，而是把不变式钉成断言：**顶层入口自己就
// 完整可解析，且 publishConfig 不再承载入口字段**，于是两套发布器语义的差恒为空。
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkgDir = path.join(import.meta.dirname, "..");

/**
 * 两个平面都禁的指涉：日期、只在"这一轮/下一轮"语境里成立的措辞、绝对路径、家目录。
 * 这些在任何读者那里都是噪音。
 */
const FORBIDDEN_EVERYWHERE: readonly RegExp[] = [
  /\/Users\/\S+/u,
  /~\/\.dsh/u,
  /\b20\d\d-\d\d-\d\d\b/u,
  /四轮|本轮未|第\s?\d\s?轮|已作废/u,
];

/**
 * 只在**发布产物**里禁的：兄弟包标识符。源码注释里列"哪些卡片已用这个 helper"是有用的
 * 消费方清单；但产物会被装进只装了 shared 的消费方，留下那些名字等于暗示一个并不存在的依赖。
 * 构建时注释被剥掉，所以这条本来就只在产物面有意义。
 */
const FORBIDDEN_IN_ARTIFACTS: readonly RegExp[] = [
  ...FORBIDDEN_EVERYWHERE,
  /\b(?:quality-gate|danger-guard|zvec-grep|ocr-review|lesson-loop|session-rescue|ctx-observe|dir-prep|memory-insight|plugin-hot-reload)\b/u,
];

/** `publishConfig` 里唯一允许出现的字段：可见性与源，都不是入口面。 */
const ALLOWED_PUBLISH_CONFIG = new Set(["access", "registry"]);

/** package.json 里与入口面有关的那部分形状；其余字段本测试不关心。 */
interface Manifest {
  readonly main?: string;
  readonly types?: string;
  readonly exports?: Record<string, unknown>;
  readonly files?: readonly string[];
  readonly publishConfig?: Record<string, unknown>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/** 一条 `files` 模式归类后的两种形态。 */
type PatternShape =
  /** 目录或后缀模式：列该目录（可递归）下以 `extension` 结尾的文件。 */
  | { readonly kind: "glob"; readonly dir: string; readonly extension: string }
  /** 精确文件名：带点号又无通配的条目是**文件名**（`README.zh-CN.md`），不是后缀过滤。 */
  | { readonly kind: "exact"; readonly file: string };

/**
 * 把 `files` 的一条模式归类。本包实际用到的只有三种写法：裸文件名、目录名、`dir/*.ext`。
 *
 * 「精确文件名」这一档不能和后缀过滤混为一谈，而且必须是**判别联合**而不是一个布尔开关：
 * 开关方案下两种形态挤在同一个 `extension` 字段里 —— 精确形态要存的是完整文件名，
 * 后缀形态要存的是 `.svg`，一个字段装不下两者，于是实现只能二选一。旧实现选了后缀，
 * 于是 `icon.svg` 被读成「收所有 `.svg` 的文件」：精确条目因此**完全失效**，
 * `expand` 一条文件都没返回。
 *
 * 集合虚高或虚低都会让「入口都在 files 覆盖内」这道断言失真。实测两种方向都踩过：
 * 虚高时未列入 files 的 `CHANGELOG.md` 也被算进去（`tar tzf` 确认它并不随包发布）；
 * 虚低时同一套门禁复制到兄弟包，第一版就把 `main: "host.js"` 误报成「不在 files 覆盖内」，
 * 而那个包的文件确实随包发布。判别联合让两者在类型上就分得开，不必靠注释提醒。
 *
 * @param entry - `files` 数组里的一项
 * @returns 该模式要列的目录与后缀过滤，或一个精确文件名
 */
function shapeOf(entry: string): PatternShape {
  const dot = entry.lastIndexOf(".");
  const star = entry.indexOf("*");
  if (star !== -1) {
    return {
      kind: "glob",
      dir: entry.slice(0, star).replace(/\/$/u, ""),
      extension: entry.slice(dot),
    };
  }
  if (!entry.includes(".")) {
    return { kind: "glob", dir: entry, extension: "" };
  }
  return { kind: "exact", file: entry };
}

/**
 * 按 `files` 模式列出包内确实存在的文件（相对包根、`/` 分隔）。
 * @param shape - 见 {@link shapeOf}
 * @returns 命中的文件清单
 */
async function expand(shape: PatternShape): Promise<string[]> {
  if (shape.kind === "exact") {
    return existsSync(path.join(pkgDir, shape.file)) ? [shape.file] : [];
  }
  const names = await readdir(path.join(pkgDir, shape.dir), { recursive: shape.dir !== "." });
  return names
    .map((name) => name.split(path.sep).join("/"))
    .filter((name) => shape.extension === "" || name.endsWith(shape.extension))
    .map((name) => path.posix.join(shape.dir, name));
}

/**
 * 递归收集一条 `exports` 值里的具体目标文件。通配条目（值含 `*`）没有可验证的固定文件，跳过。
 * @param value - `exports` 里某一键的值（字符串或条件对象）
 * @returns 该条目要求存在的包内路径
 */
function filesOf(value: unknown): string[] {
  if (typeof value === "string") {
    return value.includes("*") ? [] : [value];
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap((nested) => filesOf(nested));
  }
  return [];
}

/** 入口目标的相对形态（去掉 `./` 前缀）。 */
function asRelative(target: string): string {
  return target.replace(/^\.\//u, "");
}

/**
 * 入口目标允许落定的三种形态。dist 是编译产物；`config/*.json` 是给消费方 `extends` 用的
 * 数据件（tsconfig 基线），本来就该按原样发；`package.json` 是宿主读展示元数据要的出口。
 * 除此之外都算源码形态泄漏。
 * @param file - 入口目标的原始串
 * @returns 该目标是否属于允许的形态
 */
function isArtifactForm(file: string): boolean {
  return (
    file.startsWith("./dist/") ||
    (file.startsWith("./config/") && file.endsWith(".json")) ||
    file === "./package.json"
  );
}

/**
 * manifest 里全部需要落地的入口文件：main、types 与每个 exports 具体目标。
 * @param manifest - 解析后的 package.json
 * @returns 目标清单，每项带来源标签以便失败时点名
 */
function entryFiles(manifest: Manifest): readonly { label: string; file: string }[] {
  const flat = Object.entries(manifest.exports ?? {}).flatMap(([specifier, value]) =>
    filesOf(value).map((file) => ({ label: specifier, file })),
  );
  const scalars = [
    ...(typeof manifest.main === "string" ? [{ label: "main", file: manifest.main }] : []),
    ...(typeof manifest.types === "string" ? [{ label: "types", file: manifest.types }] : []),
  ];
  return [...scalars, ...flat];
}

/**
 * 发布器无条件附带的文件：这三件不受 `files` 约束（README/LICENSE 是法定附带，package.json
 * 是包身份本身）。门禁要按真实语义建，而不是把这三件塞进 `files` 去迁就断言。
 */
const ALWAYS_SHIPPED = ["package.json", "README.md", "LICENSE"];

/**
 * 读 manifest 与它应当发出去的文件清单。
 * @returns manifest 本体与 `files` 展开后的集合（含发布器无条件附带的三件）
 */
async function readSurface(): Promise<{ manifest: Manifest; shipped: Set<string> }> {
  const manifest = JSON.parse(
    await readFile(path.join(pkgDir, "package.json"), "utf8"),
  ) as unknown as Manifest;
  const groups = await Promise.all((manifest.files ?? []).map((entry) => expand(shapeOf(entry))));
  return { manifest, shipped: new Set([...groups.flat(), ...ALWAYS_SHIPPED]) };
}

describe("发布形态", () => {
  it("files 覆盖全部入口目标（换个发布器也不会发出悬空入口）", async () => {
    const { manifest, shipped } = await readSurface();
    const targets = entryFiles(manifest);
    expect(targets.length, "入口面不该是空的").toBeGreaterThan(0);
    for (const target of targets) {
      expect(
        shipped.has(asRelative(target.file)),
        `${target.label} 指向 ${target.file}，但它不在 files 覆盖范围内`,
      ).toBe(true);
    }
  });

  it("入口一律指向构建产物，源码目录不参与发布", async () => {
    const { manifest } = await readSurface();
    for (const target of entryFiles(manifest)) {
      expect(target.file, `${target.label} 不该指源码`).not.toMatch(/(?<lead>^|\/)lib\//u);
      expect(isArtifactForm(target.file), `${target.label} 形态不对：${target.file}`).toBe(true);
    }
  });

  it("files 里的精确文件名条目确实被算进发布集合（shapeOf/expand 的回归防线）", async () => {
    // 单独钉住这两件事，因为它们坏掉时**上面那道入口覆盖断言不会响**：
    //   · 精确条目没被算进来 → 集合虚低 → 入口一旦靠精确条目承载就会误报；
    //   · 精确条目被当成后缀过滤 → 集合虚高 → 门禁对自己的约束放松。
    // 旧实现正是后者：`icon.svg` 被读成「收所有 .svg」，于是把未列入 files 的
    // `CHANGELOG.md` 之类的文件也算进去，而上面那道断言照样全绿。
    const { manifest, shipped } = await readSurface();
    const exact = (manifest.files ?? []).filter(
      (entry) => !entry.includes("*") && entry.includes("."),
    );
    expect(exact.length, "本包的 files 里应当有精确文件名条目可供验证").toBeGreaterThan(0);
    for (const entry of exact) {
      // 一条断言同时钉住 kind 与 file：精确形态必须携带完整文件名。这是旧实现唯一失效的
      // 那一位，而上面那道「入口覆盖」断言对它毫无反应。
      expect(shapeOf(entry), `${entry} 应归类为精确文件名并携带完整文件名`).toStrictEqual({
        kind: "exact",
        file: entry,
      });
      expect(shipped.has(entry), `${entry} 是精确条目，却没被算进发布集合`).toBe(true);
    }
  });

  it("publishConfig 只留可见性与源，不留入口覆盖", async () => {
    const { manifest } = await readSurface();
    for (const key of Object.keys(manifest.publishConfig ?? {})) {
      expect(ALLOWED_PUBLISH_CONFIG.has(key), `publishConfig.${key} 会被 npm 忽略`).toBe(true);
    }
  });

  it("dist 里没有内部指涉（绝对路径、家目录、日期、兄弟包名）", async () => {
    const { shipped } = await readSurface();
    const artifacts = [...shipped].filter(
      (file) => file.endsWith(".js") || file.endsWith(".d.ts") || file.endsWith(".json"),
    );
    expect(artifacts.length, "至少要扫到产物文件").toBeGreaterThan(0);
    const texts = await Promise.all(
      artifacts.map(async (file) => ({
        file,
        text: await readFile(path.join(pkgDir, file), "utf8"),
      })),
    );
    for (const artifact of texts) {
      for (const pattern of FORBIDDEN_IN_ARTIFACTS) {
        expect(pattern.test(artifact.text), `${artifact.file} 命中内部指涉 ${pattern}`).toBe(false);
      }
    }
  });

  it("源码面同样没有内部指涉——产物面看不见注释里的编号与日期", async () => {
    // 产物面那条门只读 dist，而 rolldown 构建时会剥掉注释：源文件里写着的工单号、日期、
    // "下一轮"这类只在协作当时有意义、对任何读者都是噪音的措辞，会整条漏过产物门。
    // 同一组判据必须再扫一遍源码与文档，否则"清理"只是一次性动作，没有回归保护。
    const listed = await readdir(path.join(pkgDir, "lib"), { recursive: true });
    const libSources = listed
      .filter((name): name is string => typeof name === "string" && name.endsWith(".ts"))
      .map((name) => path.join("lib", name));
    const configNames = await readdir(path.join(pkgDir, "config"));
    const configSources = configNames
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.join("config", name));
    const docs = ["README.md", "README.zh-CN.md", "CHANGELOG.md"].filter((name) =>
      existsSync(path.join(pkgDir, name)),
    );
    const sources = [...libSources, ...configSources, ...docs];
    expect(sources.length, "至少要扫到源码文件").toBeGreaterThan(0);
    const texts = await Promise.all(
      sources.map(async (file) => ({
        file,
        text: await readFile(path.join(pkgDir, file), "utf8"),
      })),
    );
    for (const source of texts) {
      for (const pattern of FORBIDDEN_EVERYWHERE) {
        expect(pattern.test(source.text), `${source.file} 命中内部指涉 ${pattern}`).toBe(false);
      }
    }
  });
});

/**
 * 宿主包在 peer 与 dev 两张表里的并集。`dependencies` 是禁区（见下面那条门禁）：peer 记录
 * 「运行期由宿主提供」，dev 记录「本包编译与测试要用它」，两者都不会被消费方的 profile 安装。
 * 同名键以 peer 表为准，那才是消费方环境里真正提供的那一枚。
 * @param manifest - 解析后的 package.json
 * @returns 宿主包名到版本区间
 */
function hostRanges(manifest: Manifest): Record<string, string> {
  return { ...manifest.devDependencies, ...manifest.peerDependencies };
}

describe("宿主依赖的版本形状（升级防线）", () => {
  it("@deepseek-ai/* 一律不进 dependencies：装出去会在宿主进程里物化第二份", async () => {
    // 钉的是「全绿但宿主瘫痪」这一类坑。本包只要被消费方声明成普通依赖，profile 的 hoisted
    // 安装就会把这批 @deepseek-ai/* 落成**真实目录**，与宿主进程里已有的那份并存在一起。
    // 而 `@deepseek-ai/dsh-tools` 的 TOOL_RUNTIME_SCHEDULER 是普通 Symbol（不是 Symbol.for），
    // 符号身份按模块实例计算：宿主 dsh-agent-loop 用自己那份的 Symbol 去读由副本挂载出来的
    // ToolRuntime，得到 undefined，于是每一次原生工具调用都抛
    // "Cannot read properties of undefined (reading 'prepare')"，整个 profile 的工具一起失效。
    // 构建、类型检查与本包测试在此之前全部照绿，判据只能落在 manifest 面上。
    const { manifest } = await readSurface();
    const leaked = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith("@deepseek-ai/"),
    );
    expect(leaked, "这些宿主包会随消费方装进 profile，物化出第二份实例").toStrictEqual([]);
  });

  it("dsh-* 家族一律精确钉，不留任何范围算子", async () => {
    // registry 上的 dist-tag 是这轮实测出来的陷阱：
    //   @deepseek-ai/dsh-session 的 `latest` → 0.0.1-rc.1
    //   `next` → 0.2.0-rc.2（实际在用的），`alpha` → 0.2.1-alpha.1
    // 也就是说 `latest` 指向的是一个**远早于宿主 ABI** 的版本。精确钉是让「不带版本地
    // `pnpm add @deepseek-ai/dsh-session` 装成远古版本」这件事不可能发生的最小条件；
    // 一旦放宽成 `^`/`~`，宿主某天发 0.3.0 就会自动跟上去，而插件与宿主 ABI 耦合，
    // 那等于让消费方在没有测试的情况下换掉宿主类型面。
    const { manifest } = await readSurface();
    const dshDeps = Object.entries(hostRanges(manifest)).filter(([name]) =>
      name.startsWith("@deepseek-ai/dsh-"),
    );
    expect(dshDeps.length, "至少要钉住一个 dsh-* 依赖").toBeGreaterThan(0);
    for (const [name, range] of dshDeps) {
      expect(range, `${name} 必须是精确版本，实际 ${range}`).toMatch(/^\d+\.\d+\.\d+-/u);
    }
  });

  it("dsh-* 全部与 peer 的 dsh 同版本（不许装出第二份宿主类型）", async () => {
    // 宿主类型面被这些包以 type-only 方式消费；同一个会话里出现两个 dsh-session 的
    // 拷贝，nominal 类型（品牌串、投影状态）会开始互相不认，而那不报编译错、只报运行期
    // 「认不出这个 callId」。同版本是让这件事不发生的最小条件。
    const { manifest } = await readSurface();
    const peer = manifest.peerDependencies?.["@deepseek-ai/dsh"];
    expect(peer, "peer 依赖缺失：宿主版本就失去基准了").toBeDefined();
    const hostVersion = (peer ?? "").replace(/^[\^~]/u, "");
    const drifted = Object.entries(hostRanges(manifest)).filter(
      ([name, range]) => name.startsWith("@deepseek-ai/dsh-") && range !== hostVersion,
    );
    expect(drifted, "这些 dsh-* 与宿主 dsh 不同版本").toStrictEqual([]);
  });
});

describe("切面与 exports 的 parity（新增/改名切面时的静默失败面）", () => {
  it("每个 lib/*.ts 切面都有对应的 exports 子路径", async () => {
    // 消费方一律按裸包子路径引 shared（`@jayyuen66/dsh-plugin-shared/lib/xxx`），所以切面
    // 少了 exports 条目 = 这个切面对 9 个消费包**不可 import**，而门禁全绿：build 走的是
    // build-host.mjs 自己的 entries 数组，根本不看 manifest；publish-manifest 的既有断言
    // 只验「已声明的 exports 都能落到真实文件」，验不出「该声明的没声明」。
    const { manifest } = await readSurface();
    const libNames = await readdir(path.join(pkgDir, "lib"));
    const facets = libNames
      .filter((name) => name.endsWith(".ts") && name !== "index.ts")
      .map((name) => `./lib/${name.replace(/\.ts$/u, "")}`);
    expect(facets.length, "至少要扫到切面").toBeGreaterThan(0);
    for (const facet of facets) {
      expect(manifest.exports, `${facet} 缺 exports 条目`).toHaveProperty(facet);
    }
  });

  it("exports 里没有指向已删切面的悬空子路径", async () => {
    // 反方向同样要钉：切面改名或合并后忘了删 exports 条目，发布出去的是一个 import 即抛的
    // 子路径，而包自身一切正常。
    const { manifest } = await readSurface();
    const libNames = await readdir(path.join(pkgDir, "lib"));
    const onDisk = new Set(
      libNames
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `./lib/${name.replace(/\.ts$/u, "")}`),
    );
    // 只看 lib 子路径（./config/* 与 "." 不在这个集合里，那三枚各有各的落点）。
    const libSubpaths = Object.keys(manifest.exports ?? {}).filter((key) =>
      key.startsWith("./lib/"),
    );
    for (const key of libSubpaths) {
      expect(onDisk.has(key), `exports 里的 ${key} 在 lib/ 下没有对应源文件`).toBe(true);
    }
  });

  it("canonicalize-region-paths 在 exports 里却不在 barrel：这条 parity 是承重的", async () => {
    // 单独点出来，因为 lib/canonicalize-region-paths.ts 的文件头曾经写着「不进出 exports」，
    // 而那是**错的**：9 个兄弟包的 build-*.mjs 正靠这条子路径引它。照着错注释去「清理」
    // exports，会一次性打断全部 9 个包的构建，而本包自己的门禁一声不响。
    const { manifest } = await readSurface();
    const barrel = await readFile(path.join(pkgDir, "lib", "index.ts"), "utf8");
    const subpath = "./lib/canonicalize-region-paths";
    expect(manifest.exports).toHaveProperty(subpath);
    // 不在 barrel：进了根导入面，每个运行期消费方都要为它付一次导入。
    expect(barrel).not.toContain("canonicalize");
  });
});
