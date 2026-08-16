/**
 * 调本地 IOPaint HTTP：POST /api/v1/inpaint（Sanster/IOPaint；PyPI 包名 iopaint，旧名 lama-cleaner）
 */
function stripDataUrlToBase64(dataUrl: string): string {
  const t = dataUrl.trim();
  const i = t.indexOf('base64,');
  return i >= 0 ? t.slice(i + 7) : t;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read'));
    r.readAsDataURL(blob);
  });
}

export async function inpaintViaLamaCleaner(baseUrl: string, imageDataUrl: string, maskPngDataUrl: string): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/inpaint`;
  const body = JSON.stringify({
    image: stripDataUrlToBase64(imageDataUrl),
    mask: stripDataUrlToBase64(maskPngDataUrl),
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'image/*,*/*' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `inpaint HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return blobToDataUrl(blob);
}
