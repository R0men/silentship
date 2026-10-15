import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Private git repository holding every version of every CDN file we have seen.
 * Never published: it contains Microsoft's code (see docs/architecture/data.md).
 *
 *   blobs/ab/<sha256>                 raw content, content-addressed (shared by channels and regions)
 *   surfaces/<key>.json               reflected API surface, cached by content (+ loader for host files)
 *   <channel>/<region>/formatted/<f>  prettier-formatted newest version, so `git log -p` reads as a changelog
 */
export class GitArchive {
  constructor(dir) {
    this.dir = dir;
  }

  git(...args) {
    return exec("git", args, { cwd: this.dir, maxBuffer: 64 * 1024 * 1024 });
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    if (!existsSync(path.join(this.dir, ".git"))) {
      await this.git("init", "-q");
      await this.git("config", "user.name", "silentship");
      await this.git("config", "user.email", "archive@silentship.dev");
      await this.git("config", "core.autocrlf", "false");
    }
  }

  resolve(rel) {
    const full = path.resolve(this.dir, rel);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error(`Path escapes archive: ${rel}`);
    return full;
  }

  async write(rel, content) {
    const full = this.resolve(rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  async read(rel) {
    try {
      return await readFile(this.resolve(rel));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async remove(rel) {
    await rm(this.resolve(rel), { force: true });
  }

  blobRel(sha) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(`Not a sha256: ${sha}`);
    return `blobs/${sha.slice(0, 2)}/${sha}`;
  }

  /** Absolute path of a stored blob (handed to the sandboxed surface worker). */
  blobPath(sha) {
    return this.resolve(this.blobRel(sha));
  }

  hasBlob(sha) {
    return existsSync(this.blobPath(sha));
  }

  /** Stores content under its sha256; a no-op when already present. Returns true if written. */
  async putBlob(sha, body) {
    if (this.hasBlob(sha)) return false;
    await this.write(this.blobRel(sha), body);
    return true;
  }

  readBlob(sha) {
    return this.read(this.blobRel(sha));
  }

  /** Stages everything and commits; returns the commit sha, or null if there was nothing to commit. */
  async commit(message) {
    await this.git("add", "-A");
    const { stdout } = await this.git("status", "--porcelain");
    if (!stdout.trim()) return null;
    await this.git("commit", "-q", "-m", message);
    const { stdout: sha } = await this.git("rev-parse", "HEAD");
    return sha.trim();
  }
}

export const formattedRel = (channel, region, file) => `${channel}/${region}/formatted/${file}`;
