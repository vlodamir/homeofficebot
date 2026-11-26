import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const avatarMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const maxAvatars = 128;
const maxImageBytes = 512_000;
const maxCacheBytes = Math.ceil(maxImageBytes / 3) * 4 + 32;
const avatarFilename = /^[a-f0-9]{64}\.avatar$/;
const avatarDataUrl = /^data:image\/(?:jpeg|png|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export class VacationAvatarCache {
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private writes = Promise.resolve();

  constructor(private readonly directory?: string) {}

  async get(url?: string): Promise<string | undefined> {
    if (!url) return;
    let source: URL;
    try {
      source = new URL(url);
    } catch {
      return;
    }
    if (source.protocol !== "https:" || source.host !== "avatars.slack-edge.com" || source.username || source.password) return;

    const key = createHash("sha256").update(source.href).digest("hex");
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const result = this.readOrDownload(source, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, result);
    return result;
  }

  private async readOrDownload(source: URL, key: string): Promise<string | undefined> {
    const path = this.directory && join(this.directory, `${key}.avatar`);
    if (path) {
      const cached = await this.read(path);
      if (cached) return cached;
    }

    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(1500), redirect: "error" });
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (!response.ok || !mediaType || !["image/jpeg", "image/png", "image/gif"].includes(mediaType)) return;
      const input = Buffer.from(await response.arrayBuffer());
      if (input.length === 0 || input.length > maxImageBytes) return;
      const avatar = `data:${mediaType};base64,${input.toString("base64")}`;
      if (this.directory && path) await this.save(this.directory, path, avatar);
      return avatar;
    } catch {
      return;
    }
  }

  private async read(path: string): Promise<string | undefined> {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > maxCacheBytes || Date.now() - info.mtimeMs >= avatarMaxAgeMs) return;
      const avatar = await readFile(path, "utf8");
      if (avatarDataUrl.test(avatar)) return avatar;
    } catch {
      return;
    }
  }

  private async save(directory: string, path: string, avatar: string): Promise<void> {
    // Serialize writes and eviction so concurrent downloads share the same disk limit.
    const write = this.writes.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${path}.tmp`;
      try {
        await writeFile(temporary, avatar, { mode: 0o600 });
        await rename(temporary, path);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      await this.prune(directory);
    });
    this.writes = write.catch(() => {});
    await this.writes;
  }

  private async prune(directory: string): Promise<void> {
    const names = (await readdir(directory)).filter((name) => avatarFilename.test(name));
    if (names.length <= maxAvatars) return;

    const files = await Promise.all(names.map(async (name) => {
      const path = join(directory, name);
      return { path, modified: (await stat(path)).mtimeMs };
    }));
    files.sort((left, right) => right.modified - left.modified);
    await Promise.all(files.slice(maxAvatars).map(({ path }) => unlink(path).catch(() => {})));
  }
}
