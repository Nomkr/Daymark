import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const userDir = await mkdtemp(path.join(root, 'data-smoke-folders-'));
const folder = path.join(userDir, '项目 with spaces');
await mkdir(folder);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await electron.launch({
    executablePath: path.join(root, 'release/win-unpacked/Daymark.exe'),
    args: [`--user-data-dir=${userDir}`, '--disable-gpu', '--no-sandbox'], env,
  });
  const page = await desktop.firstWindow();
  await page.waitForURL('http://127.0.0.1:*/');
  await page.getByRole('button', { name: '新建任务' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.daymarkDesktop.chooseFolder), 'function');
  await desktop.evaluate(({ dialog, shell }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    globalThis.openedFolders = [];
    shell.openPath = async p => { globalThis.openedFolders.push(p); return ''; };
  }, folder);
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称' }).fill('Folder smoke');
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.getByText(folder, { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  const card = page.locator('.project-card').filter({ hasText: 'Folder smoke' });
  await card.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  assert.deepEqual(await desktop.evaluate(() => globalThis.openedFolders), [folder]);
  const saved = JSON.parse(await readFile(path.join(userDir, 'data/planner.json'), 'utf8'));
  assert.equal(saved.projects.find(p => p.name === 'Folder smoke').folderPath, folder);
  for (const invalid of ['relative', path.join(userDir, 'missing'), path.join(userDir, 'data/planner.json')]) {
    const results = await page.evaluate(async p => [await window.daymarkDesktop.openFolder(p), await window.daymarkDesktop.openVscode(p)], invalid);
    assert.ok(results.every(r => r.includes('文件夹不存在')));
  }
  const code = path.join(userDir, 'Programs', 'Microsoft VS Code', 'Code.exe');
  await mkdir(path.dirname(code), { recursive: true });
  await writeFile(code, 'test executable placeholder; never executed');
  await desktop.evaluate(async ({ dialog }, userDir) => {
    const cp = process.getBuiltinModule('child_process');
    const { EventEmitter } = process.getBuiltinModule('events');
    const { syncBuiltinESMExports } = process.getBuiltinModule('module');
    globalThis.launches = [];
    cp.spawn = (exe, args, options) => {
      globalThis.launches.push({ exe, args, shell: options.shell });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    };
    syncBuiltinESMExports();
    process.env.LOCALAPPDATA = userDir;
    dialog.showOpenDialog = async () => { throw new Error('Auto detection should not prompt'); };
  }, userDir);
  await card.getByRole('button', { name: '用 VS Code 打开', exact: true }).click();
  const launches = await desktop.evaluate(() => globalThis.launches);
  assert.deepEqual(launches, [{ exe: code, args: ['--new-window', folder], shell: false }]);
  await desktop.evaluate(async ({ dialog }, { userDir, code }) => {
    process.env.LOCALAPPDATA = `${userDir}/missing`;
    process.env.ProgramFiles = `${userDir}/missing`;
    process.env['ProgramFiles(x86)'] = `${userDir}/missing`;
    process.env.PATH = '';
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [code] });
  }, { userDir, code });
  assert.equal(await page.evaluate(p => window.daymarkDesktop.openVscode(p), folder), '');
  assert.equal(JSON.parse(await readFile(path.join(userDir, 'editor.json'), 'utf8')).path, code);
  await card.getByRole('button', { name: '编辑项目', exact: true }).click();
  await page.getByRole('button', { name: '清除文件夹', exact: true }).click();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  assert.equal(await card.getByRole('button', { name: '打开项目文件夹', exact: true }).count(), 0);
  console.log('PASS: desktop bridge, folder persistence, Explorer routing, invalid paths, VS Code detection/spawn arguments/manual preference, clear association');
} finally {
  await desktop?.close();
  await rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
