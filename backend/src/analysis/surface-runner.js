import { spawn } from "node:child_process";
import { config } from "../config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("./surface-worker.js", import.meta.url));
const BACKEND_SRC = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The worker executes code downloaded from the CDN inside node:vm, which is not a security boundary:
 * a script can reach the worker's real `process` through outer-realm objects. So the worker runs as a
 * locked-down process:
 *  - empty environment — no MONGODB_URI, BREVO_API_KEY or other secrets to read;
 *  - Node permission model — may only read its own code, node_modules and the files it analyzes;
 *    no writes, no child processes, no worker threads, no native addons.
 */
function workerArgs(files, maxOldSpaceMb) {
  const readable = [
    path.join(BACKEND_SRC, "*"),
    path.join(REPO_ROOT, "node_modules", "*"),
    path.join(REPO_ROOT, "backend", "node_modules", "*"),
    path.join(REPO_ROOT, "package.json"),
    path.join(REPO_ROOT, "backend", "package.json"),
    ...files,
  ];
  return [
    "--permission",
    ...readable.map((p) => `--allow-fs-read=${p}`),
    "--disable-warning=ExperimentalWarning",
    `--max-old-space-size=${maxOldSpaceMb}`,
    WORKER,
  ];
}

/**
 * Run surface extraction in a child process with a memory cap and wall-clock timeout.
 * `target` is a script path, or a host file to execute after the loader.
 */
export function extractSurfaceIsolated(target, { timeoutMs = 90_000, maxOldSpaceMb = config.workerMaxMb } = {}) {
  return new Promise((resolve, reject) => {
    // execArgv is deliberately not inherited: `node --watch` would make the worker watch files and never exit.
    const targetArgs = typeof target === "string" ? [target] : ["--host", target.loader, target.host];
    const files = typeof target === "string" ? [target] : [target.loader, target.host];
    const child = spawn(process.execPath, [...workerArgs(files, maxOldSpaceMb), ...targetArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      // Windows needs SystemRoot for the C runtime to start; it holds no secrets.
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {},
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const reason = signal ? `killed by ${signal} (timeout ${timeoutMs}ms?)` : `exit code ${code}`;
        reject(new Error(`surface worker failed: ${reason}: ${Buffer.concat(err).toString().slice(0, 1000)}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
      } catch (e) {
        reject(new Error(`surface worker produced invalid JSON: ${String(e)}`));
      }
    });
  });
}
