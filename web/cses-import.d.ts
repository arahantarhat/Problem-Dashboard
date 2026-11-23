import type { ImportFile } from './types';

export const csesTasksUrl: string;
export const csesImportHash: string;
export function csesBookmark(appUrl: string): string;
export function readCsesBookmark(hash: string): ImportFile;
export function readCsesFile(file: File): Promise<ImportFile>;
