import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

/** Asks where to save, then writes the bytes. Returns false if cancelled. */
export async function saveFile(defaultName: string, bytes: Uint8Array, filter: { name: string; extensions: string[] }): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [filter] });
  if (!path) return false;
  await invoke("file_write", { path, bytes: Array.from(bytes) });
  return true;
}

export async function loadExcel() {
  const mod = await import("exceljs");
  return (mod as unknown as { default?: typeof mod }).default ?? mod;
}
