declare global {
  interface Window { GuanExport?: { postMessage: (message: string) => void } }
}

/** Android asks the user for a destination; browsers retain normal downloads. */
export function downloadTextFile(name: string, content: string, type: string): void {
  if (window.GuanExport && location.origin === 'https://appassets.androidplatform.net') {
    window.GuanExport.postMessage(JSON.stringify({ name, content, type: type.split(';')[0] }));
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
