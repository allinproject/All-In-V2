/** ALL-251: native JSON export file lifecycle, with injectable storage for tests.
 * Content must already be validated against the exact signed-in account.
 */
export type V2ExportFile = {
  readonly uri: string;
  readonly exists: boolean;
  create(): void;
  write(content: string): Promise<void>;
  preview(options: { title: string }): Promise<void>;
  delete(): void;
};

export function removeV2ExportFile(file: V2ExportFile | null): void {
  if (file?.exists) file.delete();
}

/** Create a temporary file, recheck current owner, and open native preview.
 * The caller owns the file and MUST purge it on completion/unmount/next entry.
 * Native preview can resolve before the external viewer closes; do not delete in finally.
 */
export async function previewV2AccountExport(
  json: string,
  file: V2ExportFile,
  stillAuthorized: () => Promise<boolean>,
): Promise<void> {
  if (!json || !file.uri.startsWith('file://')) {
    throw new Error('Native temporary file is unavailable.');
  }
  try {
    removeV2ExportFile(file);
    file.create();
    await file.write(json);
    if (!await stillAuthorized()) {
      throw new Error('Your signed-in account changed. Nothing was exported.');
    }
    await file.preview({ title: 'ALL IN 365 account export.json' });
  } catch (error) {
    removeV2ExportFile(file);
    throw error;
  }
}
