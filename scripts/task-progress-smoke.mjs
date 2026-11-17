import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startServer } from "../server.js";

const root = process.cwd();
const dataDir = await mkdtemp(path.join(root, "data-smoke-progress-"));
assert.ok(dataDir.startsWith(path.join(root, "data-smoke-progress-")));
const { server, url } = await startServer({ port: 0, dataDir, production: true });
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
let browser;
try {
  const legacy = { version: 1, notes: [], projects: [{ id: "p", name: "测试项目", status: "active" }], events: [], tasks: [
    { id: "a", title: "学习 · 阅读第一章", expectedAt: `${today}T18:00` },
    { id: "hidden", title: "整理资料" },
    { id: "b", title: "学习 · 完成练习", expectedAt: "2027-01-01T18:00" },
    { id: "done", title: "已完成的阅读", completed: true, completedAt: today },
    { id: "p1", title: "子任务一", projectId: "p" },
    { id: "p2", title: "子任务二", projectId: "p" },
  ] };
  const put = await fetch(`${url}api/data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacy) });
  assert.ok(put.ok);
  browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const tasksTab = () => page.locator(".main-nav .nav-item").filter({ hasText: "任务" }).click();
  await tasksTab();
  const row = id => page.locator(`[data-task-id="${id}"]`);
  const order = () => page.locator(".task-row").evaluateAll(rows => rows.map(row => row.dataset.taskId));
  const saved = () => fetch(`${url}api/data`).then(r => r.json());
  async function waitSaved(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate(await saved())) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Expected data was not persisted");
  }
  await row("a").waitFor();
  assert.deepEqual(await order(), ["a", "hidden", "b"]);
  await row("b").locator(".task-drag-handle").dragTo(row("a"), { targetPosition: { x: 70, y: 4 } });
  assert.deepEqual(await order(), ["b", "a", "hidden"]);
  await waitSaved(data => data.tasks[0].id === "b");
  await page.reload(); await tasksTab(); await row("b").waitFor();
  assert.deepEqual(await order(), ["b", "a", "hidden"]);
  await page.getByRole("button", { name: "下移 学习 · 阅读第一章", exact: true }).click();
  assert.deepEqual(await order(), ["b", "hidden", "a"]);
  await page.getByLabel("搜索任务").fill("学习");
  await row("a").locator(".task-drag-handle").press("ArrowUp");
  assert.deepEqual(await order(), ["a", "b"]);
  assert.equal(await row("a").locator(".task-drag-handle").evaluate(el => document.activeElement === el), true);
  await page.getByLabel("搜索任务").fill("");
  assert.deepEqual(await order(), ["a", "hidden", "b"]);
  await page.getByLabel("任务排序").selectOption("date");
  await page.getByRole("heading", { name: `预计 ${today} 完成` }).waitFor();
  assert.equal(await page.locator(".task-drag-handle").count(), 0);
  await page.getByLabel("任务排序").selectOption("priority");
  assert.deepEqual(await order(), ["a", "hidden", "b"]);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "记录学习进展", exact: true }).click();
  await page.getByText("今天学习 5 次", { exact: true }).waitFor();
  await waitSaved(data => data.taskActivity[today] === 5);
  let data = await saved();
  assert.equal(data.tasks.filter(t => t.completed).length, 1);
  assert.ok(await page.getByRole("button", { name: `${today} 完成 1 项任务，学习进展 5 次`, exact: true }).evaluate(el => el.classList.contains("level-5")));
  await page.getByRole("button", { name: "撤销今天一次学习进展" }).click();
  await waitSaved(data => data.taskActivity[today] === 4);
  await page.reload(); await tasksTab();
  await page.getByText("今天学习 4 次", { exact: true }).waitFor();
  await page.getByRole("button", { name: `${today} 完成 1 项任务，学习进展 4 次`, exact: true }).click();
  assert.deepEqual(await order(), ["done"]);
  await page.getByRole("button", { name: "标记为未完成", exact: true }).click();
  await page.getByRole("button", { name: `${today} 完成 0 项任务，学习进展 4 次`, exact: true }).waitFor();
  await page.getByText(`${today} 学习进展 4 次，没有符合筛选条件的已完成任务。`, { exact: true }).waitFor();
  await page.getByRole("button", { name: "清除日期筛选" }).click();
  await page.getByRole("button", { name: "待完成", exact: true }).click();
  await page.screenshot({ path: "task-progress-desktop-check.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "task-progress-mobile-check.png", fullPage: true });
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "撤销今天一次学习进展" }).click();
  assert.equal(await page.getByRole("button", { name: "撤销今天一次学习进展" }).isDisabled(), true);
  await waitSaved(data => !data.taskActivity[today]);
  await page.getByRole("button", { name: "记录学习进展", exact: true }).click();
  await waitSaved(data => data.taskActivity[today] === 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await row("p2").locator(".task-drag-handle").dragTo(row("p1"), { targetPosition: { x: 70, y: 2 } });
  assert.deepEqual(await order(), ["p2", "p1"]);
  await page.screenshot({ path: "task-progress-projects-check.png", fullPage: true });
  await waitSaved(data => data.tasks.findIndex(t => t.id === "p2") < data.tasks.findIndex(t => t.id === "p1"));
  await page.getByRole("button", { name: "数据与导入", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出.*备份/ }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(backup.taskActivity[today], 1);
  assert.deepEqual(backup.tasks.map(t => t.id), ["a", "hidden", "b", "done", "p2", "p1"]);
  page.on("dialog", dialog => dialog.accept());
  await page.locator('input[accept^=".json"]').setInputFiles({
    name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByText("备份已恢复", { exact: true }).waitFor();
  await tasksTab();
  await page.getByText("今天学习 1 次", { exact: true }).waitFor();
  assert.deepEqual(await order(), ["a", "hidden", "b", "done"]);
  assert.deepEqual(errors, []);
  console.log("PASS: legacy data, mouse drag across dates, arrows/keyboard focus, filtered ordering, reload, date groups, learning/undo, combined heatmap, mobile layout, project subtasks, JSON backup");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
