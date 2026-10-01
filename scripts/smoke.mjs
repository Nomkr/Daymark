import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});

try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto("http://127.0.0.1:5173/", {
      waitUntil: "networkidle",
    });
    console.log(
      `${name}: HTTP ${response.status()}, title=${await page.title()}`,
    );
    if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
    await page
      .getByRole("heading", { name: /\d+年 \d+月/ })
      .waitFor({ timeout: 5000 });
    const originalMonth = await page.locator(".month-heading").textContent();
    await page.getByRole("button", { name: "下个月" }).click();
    if (name === "desktop") {
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.monthDirection === "next" &&
          document.getAnimations().some((animation) => animation.playState === "running"),
        null,
        { timeout: 1000 },
      );
    }
    await page.waitForFunction(
      (previous) =>
        document.querySelector(".month-heading")?.textContent !== previous,
      originalMonth,
    );
    const nextMonth = await page.locator(".month-heading").textContent();
    if (nextMonth === originalMonth) throw new Error(`${name}: 月份未切换`);
    await page.getByRole("button", { name: "上个月" }).click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".month-heading")?.textContent === expected,
      originalMonth,
    );
    await page.getByRole("button", { name: "下个月" }).click();
    await page.getByRole("button", { name: "下个月" }).click();
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".month-heading")?.textContent === expected,
      originalMonth,
    );
    await page.waitForFunction(
      () => !document.documentElement.dataset.monthDirection,
    );
    const [year, monthNumber] = originalMonth.match(/\d+/g).map(Number);
    const jumpMonth = `${year + 1}-${String(monthNumber).padStart(2, "0")}`;
    await page.getByLabel("跳转到月份").fill(jumpMonth);
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector(".month-heading")
          ?.textContent?.startsWith(expected),
      String(year + 1),
    );
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".month-heading")?.textContent === expected,
      originalMonth,
    );
    await page.waitForFunction(
      () => !document.documentElement.dataset.monthDirection,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${name}-check.png`, fullPage: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "下个月" }).click();
    await page.waitForFunction(
      (previous) =>
        document.querySelector(".month-heading")?.textContent !== previous,
      originalMonth,
    );
    if (
      await page.evaluate(() =>
        Boolean(document.documentElement.dataset.monthDirection),
      )
    ) {
      throw new Error(`${name}: 减少动态效果时仍启动了月份过渡`);
    }
    await page.getByRole("button", { name: "今天", exact: true }).click();
    if (name === "mobile") {
      await page.getByRole("button", { name: "数据与导入" }).click();
      await page.getByRole("button", { name: "导入 .ics 日历" }).waitFor();
    }
    await page.getByRole("button", { name: "任务", exact: true }).click();
    await page.getByRole("heading", { name: "任务清单" }).waitFor();
    await page.getByRole("button", { name: "新建任务" }).click();
    await page.getByRole("heading", { name: "添加任务" }).waitFor();
    if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
    console.log(`${name}: 月份导航、减少动态效果、页面和任务弹窗正常`);
    await page.close();
  }
} finally {
  await browser.close();
}
