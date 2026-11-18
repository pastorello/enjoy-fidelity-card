// The only place of the export module that touches the DOM (SPEC-export, point 3): the CSV text becomes
// a Blob, a temporary `<a download>` is clicked, and the URL is revoked a little later. Revoking it in
// the same instant makes some browsers cancel the download.

/** Saves `content` as a file named `fileName` on the device. */
export type DownloadFile = (fileName: string, content: string) => void;

/** How long the Blob URL lives after the click. */
export const REVOKE_DELAY_MS = 1000;

export const downloadFile: DownloadFile = (fileName, content) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  // Firefox follows the click only on a link inside the document.
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS);
  }
};
