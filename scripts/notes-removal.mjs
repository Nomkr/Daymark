import { chromium } from "playwright-core";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server.js";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "daymark-notes-test-"));
const oldNote = {
  id: "old-note",
  title: "旧笔记",
  date: "2026-09-29",
  content: "需要继续保留的内容",
  mood: "平静",
};
await writeFile(
  path.join(dataDir, "planner.json"),
  JSON.stringify({ version: 1, tasks: [], notes: [oldNote], projects: [], events: [] }),
);

let server;
let browser;
try {
  ({ server } = await startServer({ port: 0, dataDir, production: true }));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
  });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(url, { waitUntil: "networkidle" });

  const nav = await page.locator(".main-nav .nav-item span").allTextContents();
  if (nav.join(",") !== "日历,任务,项目")
    throw new Error(`导航仍包含独立笔记: ${nav.join(",")}`);
  if (await page.getByText(oldNote.title).count())
    throw new Error("旧独立笔记仍显示在页面上");

  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("带笔记的任务");
  await page.getByLabel("任务笔记与收获").fill("任务笔记仍可使用");
  await page.getByRole("button", { name: "保存任务" }).click();
  await page.locator(".save-status").getByText("已保存到本机").waitFor();

  const saved = await fetch(`${url}api/data`).then((response) => response.json());
  if (JSON.stringify(saved.notes) !== JSON.stringify([oldNote]))
    throw new Error("保存任务后旧独立笔记发生变化");
  if (saved.tasks[0]?.note !== "任务笔记仍可使用")
    throw new Error("任务笔记未保存");

  await page.locator(".sidebar-bottom .settings-button").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据备份" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  if (JSON.stringify(backup.notes) !== JSON.stringify([oldNote]))
    throw new Error("JSON 备份中缺少旧独立笔记");
  console.log("独立笔记入口已移除；任务笔记、旧笔记持久化和备份正常");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
