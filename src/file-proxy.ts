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
 * Open a file in a new tab (preview) using Blob approach for mobile stability
 */
export async function previewFile(storagePath: string) {
  try {
    const url = `${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("File fetch failed");
    
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    
    // Clean up blob URL after a short delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.error("Preview failed:", err);
    // Fallback to direct window.open if blob fails
    window.open(`${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}`, "_blank");
  }
}

/**
 * Force download of a file using Blob approach for mobile stability
 */
export async function downloadFile(storagePath: string) {
  try {
    const url = `${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}&download=1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("File fetch failed");

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = storagePath.split("/").pop() || "download";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.error("Download failed:", err);
    // Fallback to legacy location assignment
    window.location.assign(`${APP_FILE_ENDPOINT}?path=${encodeURIComponent(storagePath)}&download=1`);
  }
}
