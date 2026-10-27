// "><(((º> sabusabu <º)))><"
// Upload multipart diretto su S3: SHA-256 a stream (hash-wasm), una parte alla volta in memoria,
// URL presigned vincolati al checksum della parte, ripresa dopo interruzione (localStorage).
import { createSHA256 } from "hash-wasm";
import { api } from "./api";

export interface InitiateResult {
  upload_id: string;
  identifier: string;
  filename: string;
  source_filename: string | null;
  part_size: number;
  part_count: number;
  current_revision: string | null;
  next_revision: string;
}

export interface UploadOptions {
  containerId: string;
  file: File;
  title?: string;
  description?: string;
  comment?: string;
  attributes?: Record<string, unknown>;
  expectedRevision?: string | null;
  /** Rinomina secondo la naming convention: valori dei campi scelti (progressivo assegnato dal server). */
  autoName?: Record<string, string>;
  onProgress?: (phase: "hash" | "upload", fraction: number) => void;
  signal?: AbortSignal;
}

const RESUME_KEY = "cde-upload-sessions";
const READ_CHUNK = 8 * 1024 * 1024;
const CONCURRENCY = 3;

function fingerprint(f: File) {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

function resumeStore(): Record<string, { uploadId: string; sha256: string; partSize: number; partCount: number }> {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveResume(fp: string, value: { uploadId: string; sha256: string; partSize: number; partCount: number } | null) {
  try {
    const all = resumeStore();
    if (value) all[fp] = value;
    else delete all[fp];
    localStorage.setItem(RESUME_KEY, JSON.stringify(all));
  } catch {
    /* storage non disponibile: niente ripresa, l'upload funziona comunque */
  }
}

export async function sha256File(file: File, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += READ_CHUNK) {
    signal?.throwIfAborted();
    hasher.update(new Uint8Array(await file.slice(offset, offset + READ_CHUNK).arrayBuffer()));
    onProgress?.(Math.min(1, (offset + READ_CHUNK) / file.size));
  }
  return hasher.digest("hex");
}

async function sha256Base64(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return btoa(String.fromCharCode(...digest));
}

function putWithProgress(url: string, body: ArrayBuffer, headers: Record<string, string>,
                         onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Errore di rete durante l'upload"));
    signal?.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("Annullato", "AbortError")); });
    xhr.send(body);
  });
}

/** Carica un file e restituisce la revisione creata. Riprende automaticamente una sessione interrotta. */
export async function uploadFile(opts: UploadOptions) {
  const { file, signal } = opts;
  const fp = fingerprint(file);
  let session = resumeStore()[fp];

  if (session) {
    const state = await api<{ status: string }>(`/uploads/${session.uploadId}`).catch(() => null);
    if (!state || state.status !== "OPEN") {
      saveResume(fp, null);
      session = undefined as never;
    }
  }

  if (!session) {
    const sha256 = await sha256File(file, (f) => opts.onProgress?.("hash", f), signal);
    const init = await api<InitiateResult>("/uploads/initiate", {
      method: "POST",
      json: {
        container_id: opts.containerId, filename: file.name, size_bytes: file.size, sha256,
        content_type: file.type || "application/octet-stream", title: opts.title || null,
        description: opts.description || null, comment: opts.comment || null, attributes: opts.attributes ?? {},
        ...(opts.expectedRevision !== undefined ? { expected_revision: opts.expectedRevision } : {}),
        ...(opts.autoName ? { auto_name: { fields: opts.autoName } } : {}),
      },
    });
    session = { uploadId: init.upload_id, sha256, partSize: init.part_size, partCount: init.part_count };
    saveResume(fp, session);
  }

  const state = await api<{ uploaded_parts: { part_number: number }[] }>(`/uploads/${session.uploadId}`);
  const done = new Set(state.uploaded_parts.map((p) => p.part_number));
  const loaded = new Map<number, number>();
  done.forEach((n) => loaded.set(n, Math.min(session.partSize, file.size - (n - 1) * session.partSize)));
  const report = () => opts.onProgress?.("upload", [...loaded.values()].reduce((a, b) => a + b, 0) / file.size);
  report();

  const queue = Array.from({ length: session.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      signal?.throwIfAborted();
      const data = await file.slice((n - 1) * session.partSize, n * session.partSize).arrayBuffer();
      const checksum = await sha256Base64(data);
      const { parts } = await api<{ parts: { url: string; headers: Record<string, string> }[] }>(
        `/uploads/${session.uploadId}/parts`, { method: "POST", json: { parts: [{ part_number: n, checksum_sha256: checksum }] } });
      const part = n;
      await putWithProgress(parts[0].url, data, parts[0].headers, (b) => { loaded.set(part, b); report(); }, signal);
      loaded.set(part, data.byteLength);
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

  const revision = await api<{ id: string; document_id: string; revision_code: string; original_filename: string }>(
    `/uploads/${session.uploadId}/complete`, { method: "POST" });
  saveResume(fp, null);
  return revision;
}

export async function abortUpload(file: File) {
  const session = resumeStore()[fingerprint(file)];
  if (session) {
    await api(`/uploads/${session.uploadId}/abort`, { method: "POST" }).catch(() => undefined);
    saveResume(fingerprint(file), null);
  }
}
