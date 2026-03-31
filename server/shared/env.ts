import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadWorkspaceEnv(
  baseEnv: Record<string, string | undefined> = readProcessEnv(),
  cwd = process.cwd()
): Record<string, string | undefined> {
  return {
    ...parseEnvFile(resolve(cwd, ".env")),
    ...parseEnvFile(resolve(cwd, ".env.local")),
    ...baseEnv,
  };
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, "utf8");
  const entries: Record<string, string> = {};

  content.split(/\r?\n/u).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex < 0) {
      return;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) {
      return;
    }

    let value = normalized.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value.replace(/\\n/g, "\n");
  });

  return entries;
}

function readProcessEnv(): Record<string, string | undefined> {
  const maybeGlobal = globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return maybeGlobal.process?.env ?? {};
}
