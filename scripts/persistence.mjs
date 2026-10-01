import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = await mkdtemp(path.join(root, "data-smoke-"));
const port = 5174;
const server = spawn(process.execPath, ["server.js", "--production"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DAYMARK_DATA_DIR: dataDir },
  stdio: "pipe",
});
let serverOutput = "";
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/data`);
      if (response.ok) return;
    } catch {
      /* server is starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`测试服务未启动: ${serverOutput}`);
}

try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("冒烟测试任务");
  await page.getByRole("button", { name: "保存任务" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("冒烟测试任务", { exact: true }).first().waitFor();

  await page.getByRole("button", { name: "数据与导入" }).click();
  const ics =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:smoke-test-event\r\nDTSTART:20260930T090000\r\nDTEND:20260930T100000\r\nSUMMARY:测试课程\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  await page.locator('input[accept^=".ics"]').setInputFiles({
    name: "course.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(ics),
  });
  const importToast = page.locator(".toast").filter({
    hasText: "已导入",
  });
  await importToast.waitFor({ timeout: 5000 });
  const feedback = await importToast.textContent();
  if (!feedback.includes("已导入 1 条日程"))
    throw new Error(`日历导入数量错误: ${feedback}`);
  const saved = await fetch(`http://127.0.0.1:${port}/api/data`).then(
    (response) => response.json(),
  );
  if (
    !saved.tasks.some((task) => task.title === "冒烟测试任务") ||
    !saved.events.some((event) => event.title === "测试课程")
  ) {
    throw new Error("任务或日历导入未写入本地数据");
  }
  console.log("任务持久化与 .ics 导入正常");

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const orderedData = {
    ...saved,
    events: [
      ...saved.events,
      {
        id: "late",
        title: "晚课",
        date: today,
        time: "14:00",
        source: "manual",
      },
      {
        id: "early",
        title: "早课",
        date: today,
        time: "08:20",
        source: "manual",
      },
    ],
  };
  const update = await fetch(`http://127.0.0.1:${port}/api/data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderedData),
  });
  if (!update.ok) throw new Error("无法设置日历排序测试数据");
  await page.reload({ waitUntil: "networkidle" });
  const monthOrder = await page
    .locator(".day-cell.today .calendar-event")
    .allTextContents();
  const detailOrder = await page
    .locator(".day-panel .event-row strong")
    .allTextContents();
  if (
    !monthOrder[0]?.includes("早课") ||
    !monthOrder[1]?.includes("晚课") ||
    detailOrder[0] !== "早课" ||
    detailOrder[1] !== "晚课"
  ) {
    throw new Error(
      `课程排序错误: 月历=${monthOrder.join(",")}; 详情=${detailOrder.join(",")}`,
    );
  }
  const [calendarNow, detailNow] = await page.evaluate(() => [
    document.querySelector(".day-cell.today .calendar-now-marker time")
      ?.textContent,
    document.querySelector(".day-panel .now-marker span")?.textContent,
  ]);
  if (calendarNow !== detailNow)
    throw new Error(
      `月历与当天详情的当前时间不一致: ${calendarNow}, ${detailNow}`,
    );
  if (await page.locator(".day-cell:not(.today) .calendar-now-marker").count())
    throw new Error("当前时间线显示在非当天日期");
  console.log("月历与当天详情均按开始时间排序，当前时间线一致");

  await page.locator(".main-nav .nav-item").filter({ hasText: "任务" }).click();
  await page.getByRole("heading", { name: "任务清单" }).waitFor();
  await page.getByRole("button", { name: "添加任务", exact: true }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("新功能验证任务");
  await page.getByLabel("日期", { exact: true }).fill(today);
  await page.getByLabel("截止日期").fill(today);
  await page.getByLabel("预计完成时间").fill(`${today}T20:00`);
  await page
    .getByLabel("任务笔记与收获")
    .fill("记录验证结果，并确认笔记可以保存。");
  await page.getByRole("button", { name: "保存任务" }).click();
  const newTask = page.locator(".task-row").filter({
    hasText: "新功能验证任务",
  });
  await newTask.getByText("今天截止").waitFor();
  await newTask.getByText("预计今天 20:00").waitFor();
  await newTask.getByText("记录验证结果，并确认笔记可以保存。").waitFor();
  await page
    .locator(".task-group")
    .filter({ hasText: `预计 ${today} 完成` })
    .waitFor();

  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await page.getByText("没有符合条件的任务").waitFor();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page
    .locator(".task-group")
    .filter({ hasText: `预计 ${today} 完成` })
    .waitFor();
  await page.screenshot({ path: "tasks-check.png", fullPage: true });
  await page.getByText("过去一年完成 0 项").waitFor();
  await newTask.getByRole("button", { name: "标记为完成" }).click();
  await page.getByText("过去一年完成 1 项").waitFor();
  await page.screenshot({
    path: "contributions-desktop-check.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "contributions-mobile-check.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: `${today} 完成 1 项任务` }).click();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await page
    .locator(".task-group")
    .filter({ hasText: `预计 ${today} 完成` })
    .waitFor();
  await page.reload({ waitUntil: "networkidle" });
  const updated = await fetch(`http://127.0.0.1:${port}/api/data`).then(
    (response) => response.json(),
  );
  const created = updated.tasks.find((task) => task.title === "新功能验证任务");
  if (
    !created ||
    created.deadline !== today ||
    created.expectedAt !== `${today}T20:00` ||
    !created.note.includes("记录验证结果") ||
    !created.completed ||
    created.completedAt !== today
  ) {
    throw new Error("任务截止日期、预计完成时间、笔记或完成状态未持久化");
  }
  console.log("任务截止倒计时、预计完成日期分组、笔记和状态筛选正常");

  await page.locator(".main-nav .nav-item").filter({ hasText: "任务" }).click();
  await page.getByText("过去一年完成 1 项").waitFor();
  await page.getByRole("button", { name: "已完成", exact: true }).click();
  await page
    .locator(".task-row")
    .filter({ hasText: "新功能验证任务" })
    .getByRole("button", { name: "标记为未完成" })
    .click();
  await page.getByText("过去一年完成 0 项").waitFor();
  await page.getByRole("button", { name: "待完成", exact: true }).click();
  await page
    .locator(".task-row")
    .filter({ hasText: "新功能验证任务" })
    .getByRole("button", { name: "标记为完成" })
    .click();
  await page.getByText("过去一年完成 1 项").waitFor();
  for (let index = 2; index <= 4; index++) {
    await page.getByRole("button", { name: "添加任务", exact: true }).click();
    await page
      .getByRole("textbox", { name: "标题" })
      .fill(`热力图测试任务 ${index}`);
    await page.getByRole("button", { name: "保存任务" }).click();
    await page
      .locator(".task-row")
      .filter({ hasText: `热力图测试任务 ${index}` })
      .getByRole("button", { name: "标记为完成" })
      .click();
    await page.getByText(`过去一年完成 ${index} 项`).waitFor();
    const day = page.getByRole("button", {
      name: `${today} 完成 ${index} 项任务`,
    });
    if (
      !(await day.evaluate(
        (element, level) => element.classList.contains(`level-${level}`),
        index,
      ))
    )
      throw new Error(`热力图没有显示 ${index} 项任务的颜色档位`);
  }
  console.log("热力图完成日期、颜色档位、日期筛选与取消完成后的统计正常");

  await page.locator(".main-nav .nav-item").filter({ hasText: "日历" }).click();
  await page.locator(".day-cell.today .day-item-column").nth(0).waitFor();
  const columnCount = await page
    .locator(".day-cell.today .day-item-column")
    .count();
  if (columnCount !== 2)
    throw new Error(`月历没有分为日程和任务两栏: ${columnCount}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "desktop-check.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "mobile-check.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const originalMonth = await page.locator(".month-heading").textContent();
  const wheelWasNotCancelled = await page
    .locator(".month-grid")
    .evaluate((element) =>
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 100,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  if (!wheelWasNotCancelled) throw new Error("月历仍拦截鼠标滚轮");
  if ((await page.locator(".month-heading").textContent()) !== originalMonth)
    throw new Error("鼠标滚轮仍会切换月份");
  await page.getByRole("button", { name: "下个月" }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".month-heading")?.textContent !== previous,
    originalMonth,
  );
  console.log("日历双栏显示、滚轮正常滚动和按钮切月正常");
  await page.close();
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && server.signalCode === null) {
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  }
  await rm(dataDir, { recursive: true, force: true });
}
