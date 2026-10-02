// Writes latest.json, the file installed copies of Eva read to find an update
// (tauri-plugin-updater "static JSON" format), from the built installer and
// its signature. Usage: node update-manifest.mjs <tag> [notes] > latest.json
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [tag, notes = "تحسينات وإصلاحات."] = process.argv.slice(2);
const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const dir = new URL("../src-tauri/target/release/bundle/nsis/", import.meta.url);
const exe = readdirSync(dir).find((f) => f.endsWith("-setup.exe") && f.includes(`_${conf.version}_`));
if (!exe) throw new Error("installer not found");
const signature = readFileSync(join(dir.pathname.replace(/^\/([A-Za-z]:)/, "$1"), `${exe}.sig`), "utf8").trim();
// GitHub turns spaces in asset names into dots.
const asset = exe.replace(/ /g, ".");

process.stdout.write(
  JSON.stringify(
    {
      version: conf.version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": { signature, url: `https://github.com/pystat-1/EvaRepo/releases/download/${tag}/${asset}` },
      },
    },
    null,
    2
  )
);
