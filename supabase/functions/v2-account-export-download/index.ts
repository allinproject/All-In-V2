/** ALL-251 temporary staging endpoint shell.
 * Transport-only and fail-closed: the canonical approved export worker, KMS,
 * session/request gate and complete inventory are NOT installed in staging.
 * Never enable this endpoint without a separately reviewed worker factory.
 */
import {handleAccountExportDownload} from './trainingExportDownloadHandler.mjs';

Deno.serve((request) => handleAccountExportDownload(request, {
  enabled: false,
}));
