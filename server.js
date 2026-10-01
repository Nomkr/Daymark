import express from "express";
import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_DATA_VERSION = 1;
const emptyData = {
  version: CURRENT_DATA_VERSION,
  tasks: [],
  notes: [],
  quickNote: "",
  projects: [],
  events: [],
};
function migrateData(value) {
  if (!value || typeof value !== "object" || value.version !== CURRENT_DATA_VERSION)
    return null;
  const collections = ["tasks", "notes", "projects", "events"];
  if (!collections.every((key) => Array.isArray(value[key]) && value[key].length <= 100000))
    return null;
  if (typeof value.quickNote !== "undefined" && typeof value.quickNote !== "string")
    return null;
  return {
    ...emptyData,
    ...value,
    version: CURRENT_DATA_VERSION,
    quickNote: typeof value.quickNote === "string" ? value.quickNote : "",
  };
}

async function loadData(dataFile, backupFile) {
  let foundFile = false;
  for (const file of [dataFile, backupFile]) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      foundFile = true;
      const migrated = migrateData(parsed);
      if (migrated) return migrated;
    } catch (error) {
      if (error.code !== "ENOENT") foundFile = true;
    }
  }
  if (foundFile)
    throw new Error("数据文件和备份均无法读取，请检查 data 文件夹");
  return emptyData;
}

export async function startServer({
  port = Number(process.env.PORT || 5173),
  dataDir = process.env.DAYMARK_DATA_DIR
    ? path.resolve(process.env.DAYMARK_DATA_DIR)
    : path.join(root, "data"),
  production = process.argv.includes("--production") || process.env.NODE_ENV === "production",
} = {}) {
  const dataFile = path.join(dataDir, "planner.json");
  const backupFile = path.join(dataDir, "planner.backup.json");
  const app = express();
  let writeQueue = Promise.resolve();

  app.use(express.json({ limit: "5mb" }));
  app.disable("x-powered-by");

  app.get("/api/data", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await loadData(dataFile, backupFile));
    } catch (error) {
      console.error(error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/data", (req, res) => {
    const nextData = migrateData(req.body);
    if (!nextData)
      return res.status(400).json({ error: "数据格式无效" });
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(dataDir, { recursive: true });
        const tempFile = path.join(
          dataDir,
          `planner.${process.pid}.${Date.now()}.tmp`,
        );
        await writeFile(tempFile, JSON.stringify(nextData, null, 2), "utf8");
        if (existsSync(dataFile)) await copyFile(dataFile, backupFile);
        await rename(tempFile, dataFile);
      });
    writeQueue
      .then(() => res.json({ ok: true }))
      .catch((error) => {
        console.error("保存失败:", error);
        res.status(500).json({ error: "保存失败" });
      });
  });

  if (production) {
    app.use(express.static(path.join(root, "dist")));
    app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer();
  console.log(`Daymark 已启动: ${url}`);
}
