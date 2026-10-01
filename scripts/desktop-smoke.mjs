import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const userDir = await mkdtemp(path.join(root, "data-smoke-desktop-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const freePort = server.address().port;
    server.close(() => resolve(freePort));
  });
});
const executablePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "release", "win-unpacked", "Daymark.exe");
const child = spawn(
  executablePath,
  [
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--no-sandbox",
  ],
  { cwd: root, env, stdio: "pipe", windowsHide: true },
);
const childExited = new Promise((resolve) => child.once("exit", resolve));
const startedAt = new Date(Date.now() - 2000).toISOString();
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
let browser;

try {
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      if (child.exitCode !== null) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`桌面程序未启动: ${output}`);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = await Promise.race([
    context.waitForEvent("page", {
      predicate: (item) => item.url().startsWith("http://127.0.0.1:"),
      timeout: 10000,
    }).catch(() => null),
    new Promise((resolve) =>
      setTimeout(
        () => resolve(context.pages().find((item) => item.url().startsWith("http://127.0.0.1:"))),
        1500,
      ),
    ),
  ]);
  if (!page) throw new Error(`桌面程序没有打开窗口: ${output}`);
  if ((await page.title()) !== "Daymark · 日程与项目")
    throw new Error(`页面标题不正确: ${await page.title()}`);
  await page.getByRole("heading", { name: /\d+年 \d+月/ }).waitFor();
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByRole("textbox", { name: "标题" }).fill("桌面版测试任务");
  await page.getByRole("button", { name: "保存任务" }).click();
  await page.reload();
  await page.locator(".task-row").getByText("桌面版测试任务").waitFor();

  const saved = JSON.parse(
    await readFile(path.join(userDir, "data", "planner.json"), "utf8"),
  );
  if (!saved.tasks.some((task) => task.title === "桌面版测试任务"))
    throw new Error("桌面版未写入独立数据目录");
  console.log("桌面版启动、页面显示和独立数据目录持久化正常");
} finally {
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  const stopScript = `Get-Process Daymark -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${executablePath.replaceAll("'", "''")}' -and $_.StartTime.ToUniversalTime() -ge [datetime]'${startedAt}' } | Stop-Process -Force`;
  spawnSync("powershell.exe", ["-NoProfile", "-Command", stopScript], {
    stdio: "ignore",
  });
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.race([
    childExited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
