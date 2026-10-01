import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = await readFile(path.join(root, "public", "favicon.svg"));
const assets = path.join(root, "assets");
await mkdir(assets, { recursive: true });
const png = await sharp(svg).resize(512, 512).png().toBuffer();
await writeFile(path.join(assets, "daymark.png"), png);
const ico = await pngToIco([
  await sharp(svg).resize(256, 256).png().toBuffer(),
  await sharp(svg).resize(64, 64).png().toBuffer(),
  await sharp(svg).resize(32, 32).png().toBuffer(),
  await sharp(svg).resize(16, 16).png().toBuffer(),
]);
await writeFile(path.join(assets, "daymark.ico"), ico);
