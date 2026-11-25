import { invoke } from '@tauri-apps/api/core';

export type LibraryImportSource = 'files' | 'folder' | 'zip';
type ArchiveReport = { imported: number; duplicates: number; skipped: number };

export async function importToLibrary(source: LibraryImportSource): Promise<string | null> {
  if (source === 'zip') {
    const result = await invoke<ArchiveReport | null>('import_design_archive');
    if (!result) return null;
    if (!result.imported && !result.duplicates) return 'No supported embroidery files found in this ZIP.';
    const summary = [`${result.imported} imported`];
    if (result.duplicates) summary.push(`${result.duplicates} already in library`);
    if (result.skipped) summary.push(`${result.skipped} other ${result.skipped === 1 ? 'file' : 'files'} skipped`);
    return summary.join(' · ');
  }
  const count = await invoke<number>('import_personal_designs', { folder: source === 'folder' });
  return count ? `Imported ${count} ${count === 1 ? 'design' : 'designs'}.` : 'No new designs imported.';
}
