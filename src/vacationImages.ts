import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { webApi } from "@slack/bolt";
import { logger } from "./logger";
import { VacationMonth } from "./vacationMonth";
import { VACATION_TIMELINE_VERSION, VacationProfile } from "./vacationTimeline";

const CACHE_CAPACITY = 24;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function vacationImageKey(
  workspace: string,
  uploader: string,
  month: VacationMonth,
  profiles: ReadonlyMap<string, VacationProfile>,
): string {
  return createHash("sha256").update(JSON.stringify([
    VACATION_TIMELINE_VERSION, "private", workspace, uploader, month.month, month.today,
    month.vacations.map(({ userId, startDate, endDate }) => [userId, startDate, endDate]),
    [...profiles].sort(([left], [right]) => left.localeCompare(right)),
  ])).digest("hex");
}

function slackErrorData(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || !error || !("data" in error)) return;
  const data = error.data;
  if (typeof data === "object" && data) return data as Record<string, unknown>;
}

export function slackErrorCode(error: unknown): string | undefined {
  const code = slackErrorData(error)?.error;
  return typeof code === "string" ? code : undefined;
}

export function isSlackFileReferenceRejected(error: unknown): boolean {
  const data = slackErrorData(error);
  if (data?.error !== "invalid_arguments" && data?.error !== "invalid_blocks") return false;
  const metadata = data.response_metadata;
  if (typeof metadata !== "object" || !metadata || !("messages" in metadata)) return false;
  return Array.isArray(metadata.messages) && metadata.messages.some((message: unknown) =>
    typeof message === "string" && /\b(?:invalid slack file|file not found)\b/i.test(message),
  );
}

export interface VacationSlackImage {
  id: string;
  privateUrl?: string;
}

interface VacationImageFiles {
  getReference(fileId: string): Promise<VacationSlackImage | undefined>;
  upload(month: string, png: Buffer): Promise<string>;
  remove(fileId: string): Promise<void>;
}

type SlackFiles = Pick<webApi.WebClient["files"], "getUploadURLExternal" | "completeUploadExternal" | "info" | "delete">;

export function slackVacationImageFiles(files: SlackFiles, uploadBytes = fetch): VacationImageFiles {
  async function remove(fileId: string): Promise<void> {
    try {
      await files.delete({ file: fileId });
    } catch (error) {
      if (!["file_not_found", "access_denied", "cant_delete_file", "not_allowed"].includes(slackErrorCode(error) ?? "")) throw error;
    }
  }

  return {
    remove,
    async getReference(fileId) {
      try {
        const { file } = await files.info({ file: fileId });
        if (file?.id !== fileId || file.is_public || file.public_url_shared || file.is_external) return;
        return { id: fileId, privateUrl: file.url_private };
      } catch (error) {
        if (["file_not_found", "access_denied", "not_allowed"].includes(slackErrorCode(error) ?? "")) return;
        throw error;
      }
    },
    async upload(month, png) {
      const title = `Vacation timeline ${month}`;
      const { file_id: fileId, upload_url: uploadUrl } = await files.getUploadURLExternal({
        filename: `vacation-timeline-${month}.png`,
        length: png.byteLength,
      });
      if (!fileId || !uploadUrl) throw new Error("Slack did not return an upload URL and file ID");

      const response = await uploadBytes(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(png),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel().catch(() => {});
      if (response.status !== 200) throw new Error(`Slack rejected the PNG upload (HTTP ${response.status})`);

      try {
        // Omitting the destination keeps the file private to the uploading app.
        const { files: completed } = await files.completeUploadExternal({ files: [{ id: fileId, title }] });
        if (!completed?.some((file) => file.id === fileId)) throw new Error("Slack did not finalize the uploaded PNG");
      } catch (error) {
        await remove(fileId).catch(() => logger.warn("Could not clean up an incomplete vacation image upload"));
        throw error;
      }
      return fileId;
    },
  };
}

interface CachedImage {
  fileId: string;
  expiresAt: number;
}

export class VacationImageCache {
  private entries = new Map<string, CachedImage>();
  private loaded = false;
  private queue = Promise.resolve();

  constructor(
    private readonly files: VacationImageFiles,
    private readonly path?: string,
    private readonly now = Date.now,
  ) {}

  get(key: string, month: string, render: () => Promise<Buffer>): Promise<VacationSlackImage> {
    // Serialize cache changes so concurrent requests for the same image only upload once.
    const result = this.queue.then(() => this.getFile(key, month, render));
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    if (this.path) {
      try {
        const entries = JSON.parse(await readFile(this.path, "utf8")) as Record<string, CachedImage>;
        this.entries = new Map(Object.entries(entries));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }

  private async remove(key: string, image: CachedImage): Promise<void> {
    await this.files.remove(image.fileId);
    this.entries.delete(key);
    await this.save();
  }

  private async getFile(key: string, month: string, render: () => Promise<Buffer>): Promise<VacationSlackImage> {
    await this.load();
    for (const [expiredKey, image] of this.entries) {
      if (image.expiresAt > this.now()) continue;
      await this.remove(expiredKey, image).catch(() => logger.warn("Could not remove an expired vacation image"));
    }

    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      const reference = await this.files.getReference(cached.fileId);
      if (reference) return reference;
    }
    if (cached) await this.remove(key, cached);
    while (this.entries.size >= CACHE_CAPACITY) {
      const oldest = this.entries.entries().next().value;
      if (oldest) await this.remove(...oldest);
    }

    const preparationStartedAt = performance.now();
    const png = await render();
    const uploadStartedAt = performance.now();
    const fileId = await this.files.upload(month, png);
    const uploadFinishedAt = performance.now();
    this.entries.set(key, { fileId, expiresAt: this.now() + CACHE_TTL_MS });
    try {
      await this.save();
    } catch (error) {
      await this.remove(key, { fileId, expiresAt: 0 }).catch(() => logger.warn("Could not clean up an unrecorded vacation image"));
      throw error;
    }
    // Slack may not return the full file metadata immediately after completion.
    const lookupStartedAt = performance.now();
    const reference = await this.files.getReference(fileId);
    logger.info("Vacation timeline image timings", {
      month,
      pngBytes: png.byteLength,
      prepareMs: Math.round(uploadStartedAt - preparationStartedAt),
      slackUploadMs: Math.round(uploadFinishedAt - uploadStartedAt),
      slackFileLookupMs: Math.round(performance.now() - lookupStartedAt),
    });
    return reference ?? { id: fileId };
  }
}
