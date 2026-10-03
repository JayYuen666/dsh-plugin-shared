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
}

/** 一条 `files` 模式归类后的形态。 */
interface PatternShape {
  /** 要列的目录（相对包根）。 */
  readonly dir: string;
  /** 只收这一种后缀；空串表示收全部。exact 为真时本字段是**完整文件名**。 */
  readonly extension: string;
  /** true = 该条目是精确文件名（带点号又无通配）；false = 目录或后缀模式。 */
  readonly exact: boolean;
}

/**
 * 把 `files` 的一条模式归类。本包实际用到的只有三种写法：裸文件名、目录名、`dir/*.ext`。
 *
 * `exact` 这一档不能省：带点号又无通配的条目是**文件名**（`README.zh.md`），不是后缀过滤。
 * 原实现把它当 `.md` 过滤，于是顶层每个 `.md` 都被算进「files 会发出去的集合」——实测把
 * 未列入 files 的 `CHANGELOG.md` 也算了进去（`tar tzf` 确认它并不随包发布）。集合虚高会让
 * 「入口都在 files 覆盖内」这道断言比 npm 真实语义更宽松：门禁自己放松了。
 *
 * @param entry - `files` 数组里的一项
 * @returns 该模式要列的目录与后缀过滤
 */
function shapeOf(entry: string): PatternShape {
  const dot = entry.lastIndexOf(".");
  const star = entry.indexOf("*");
  if (star !== -1) {
    return {
      dir: entry.slice(0, star).replace(/\/$/u, ""),
      extension: entry.slice(dot),
      exact: false,
    };
  }
  if (!entry.includes(".")) {
    return { dir: entry, extension: "", exact: false };
  }
  return { dir: ".", extension: entry.slice(dot), exact: true };
}

/**
 * 按 `files` 模式列出包内确实存在的文件（相对包根、`/` 分隔）。
 * @param shape - 见 {@link shapeOf}
 * @returns 命中的文件清单
 */
async function expand(shape: PatternShape): Promise<string[]> {
  const names = await readdir(path.join(pkgDir, shape.dir), { recursive: shape.dir !== "." });
  const wanted = shape.extension;
  return names
    .map((name) => name.split(path.sep).join("/"))
    .filter((name) => wanted === "" || (shape.exact ? name === wanted : name.endsWith(wanted)))
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
    const docs = ["README.md", "README.zh.md", "CHANGELOG.md"].filter((name) =>
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
