import {invoke} from '@tauri-apps/api/core';

export type FontImportResult = {imported:number;duplicates:number;skipped:number;errors:string[]};
export type FontDrop = (File | FileSystemEntry)[];
const fontName = /\.(?:ttf|otf|bx)$/i;
const maxEntries = 20_000;
const maxFonts = 2_000;

export function captureFontDrop(transfer: DataTransfer): FontDrop {
  // The browser exposes drop entries only during the drop event itself.
  const entries = Array.from(transfer.items ?? []).flatMap(item => {
    if (item.kind !== 'file') return [];
    const entry = item.webkitGetAsEntry?.() ?? item.getAsFile();
    return entry ? [entry] : [];
  });
  return entries.length ? entries : Array.from(transfer.files);
}

export function isFontDrop(drop: FontDrop) {
  return drop.some(entry => ('isDirectory' in entry && entry.isDirectory) || fontName.test(entry.name));
}

async function* walk(entries: FontDrop, budget: {visited:number}, errors: string[]): AsyncGenerator<File | null> {
  for (const entry of entries) {
    if (++budget.visited > maxEntries) return;
    try {
      if ('isDirectory' in entry && entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        // Each read can return a partial batch, typically up to 100 entries.
        while (budget.visited < maxEntries) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!batch.length) break;
          yield* walk(batch, budget, errors);
        }
      } else if (!fontName.test(entry.name)) {
        yield null;
      } else if ('isFile' in entry) {
        if (entry.isFile) yield await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        else yield null;
      } else {
        yield entry;
      }
    } catch (error) {
      errors.push(`${entry.name}: ${String(error)}`);
    }
  }
}

export async function importFontDrop(entries: FontDrop): Promise<FontImportResult> {
  const summary: FontImportResult = {imported:0,duplicates:0,skipped:0,errors:[]};
  const budget = {visited:0};
  let fonts = 0;
  for await (const file of walk(entries, budget, summary.errors)) {
    if (!file || !file.size || file.size > 50_000_000) {
      summary.skipped++;
      continue;
    }
    if (++fonts > maxFonts) break;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await invoke<FontImportResult>('import_dropped_font', {name:file.name, bytes});
      summary.imported += result.imported;
      summary.duplicates += result.duplicates;
      summary.skipped += result.skipped;
      summary.errors.push(...result.errors);
    } catch (error) {
      summary.errors.push(`${file.name}: ${String(error)}`);
    }
  }
  if (budget.visited >= maxEntries || fonts > maxFonts) {
    summary.errors.push('This drop reached the scan limit. Use Scan a folder or import smaller batches for the rest.');
  }
  return summary;
}
