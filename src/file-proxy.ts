const FILE_PROXY =
  "https://us-central1-the-final-project-5e248.cloudfunctions.net/serveFile";

export function previewFile(storagePath: string) {
  window.open(
    `${FILE_PROXY}?path=${encodeURIComponent(storagePath)}`,
    "_blank"
  );
}

export function downloadFile(storagePath: string) {
  window.location.href =
    `${FILE_PROXY}?path=${encodeURIComponent(storagePath)}&download=1`;
}
