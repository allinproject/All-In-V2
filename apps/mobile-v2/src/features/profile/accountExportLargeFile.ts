/**
 * ALL-251 staging contract: the existing Profile export owns native file release.
 * A trusted adapter downloads INCREMENTALLY to a temporary cache file, and a
 * platform-specific verifier checks the final SHA-256 and terminal receipt
 * before the user can preview or share it.
 * No endpoint or native downloader is enabled by this helper.
 */
export type V2LargeExportFile = {
  readonly uri: string;
  readonly exists: boolean;
  remove(): Promise<void>;
  preview(options: {title: string}): Promise<void>;
};
export type V2LargeExportVerified = {
  verified: true;
  ownerId: string;
  complete: true;
  sha256: string;
  bytes: number;
};
export async function previewVerifiedLargeAccountExport({
  ownerId, file, downloadToTemporaryFile, verifyFile, stillAuthorized,
}: {
  ownerId: string;
  file: V2LargeExportFile;
  downloadToTemporaryFile: (file: V2LargeExportFile) => Promise<void>;
  verifyFile: (file: V2LargeExportFile, owner: string) => Promise<V2LargeExportVerified>;
  stillAuthorized: () => Promise<boolean>;
}): Promise<V2LargeExportVerified> {
  if (!ownerId || !file.uri.startsWith('file://')) {
    throw new Error('Private account export cache unavailable');
  }
  // Errors must propagate: uncertain cleanup cannot be presented as success.
  const purge = async () => { if (file.exists) await file.remove(); };
  await purge();
  try {
    if (!await stillAuthorized()) throw new Error('Export account changed');
    await downloadToTemporaryFile(file);
    if (!file.exists) throw new Error('Export download missing');
    const receipt = await verifyFile(file,ownerId);
    if (receipt?.verified !== true || receipt.complete !== true
      || receipt.ownerId !== ownerId || !/^[a-f0-9]{64}$/.test(receipt.sha256)
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) {
      throw new Error('Downloaded account export was not verified');
    }
    if (!await stillAuthorized()) throw new Error('Export account changed');
    await file.preview({title:'ALL IN 365 account export.ndjson'});
    // The native viewer can outlive the awaited preview operation. If the
    // account changed while preview was being invoked, purge this cache and
    // refuse to claim a verified delivery. The mounted owner screen must
    // also purge on unmount/background; this helper cannot prove that alone.
    if (!await stillAuthorized()) throw new Error('Export account changed during preview');
    return receipt;
  } catch(error) {
    try { await purge(); }
    catch { throw new Error('Private account export cleanup requires manual attention',{cause:error}); }
    throw error;
  }
}
