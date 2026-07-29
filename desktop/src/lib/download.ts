import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export interface SaveBlobOptions {
  title?: string;
  filterName?: string;
  extensions?: string[];
}

export interface SaveBlobResult {
  saved: boolean;
  path?: string;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveBlob(
  blob: Blob,
  fileName: string,
  options: SaveBlobOptions = {},
): Promise<SaveBlobResult> {
  if (!isTauri()) {
    downloadBlob(blob, fileName);
    return { saved: true };
  }

  const path = await save({
    title: options.title,
    defaultPath: fileName,
    filters: options.extensions?.length
      ? [{ name: options.filterName ?? "SingRight file", extensions: options.extensions }]
      : undefined,
    canCreateDirectories: true,
  });
  if (!path) return { saved: false };

  const contents = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("write_binary_file", { path, contents });
  return { saved: true, path };
}
