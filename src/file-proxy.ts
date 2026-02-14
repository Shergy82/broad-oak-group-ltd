/**
 * Browser-safe file proxy.
 *
 * Files are served via a Next.js API route,
 * NOT directly from Cloud Functions.
 *
 * This avoids CORS and internal-ingress violations.
 */

const APP_FILE_ENDPOINT = "/api/file";

/**
 * Open a file in a new tab (preview)
 */
export function previewFile(storagePath: string) {
  const url =
    `${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}`;

  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Force download of a file
 */
export function downloadFile(storagePath: string) {
  const url =
    `${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}&download=1`;

  window.location.assign(url);
}
