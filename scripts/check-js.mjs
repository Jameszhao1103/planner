import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["public", "server/app", "scripts", "tests"];
const extensions = new Set([".js", ".mjs"]);
const ignoredDirectories = new Set([".git", "node_modules"]);

const files = [];
for (const root of roots) {
  await collectJavaScriptFiles(root, files);
}

const uniqueFiles = [...new Set(files)].sort();
let failed = false;

for (const file of uniqueFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Checked ${uniqueFiles.length} JavaScript files.`);
}

async function collectJavaScriptFiles(directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScriptFiles(path, output);
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      const target = await stat(path);
      if (!target.isFile()) {
        continue;
      }
    }

    if (extensions.has(extname(entry.name))) {
      output.push(path);
    }
  }
}
