/**
 * 前端图片压缩（tech-design-final.md §3.3③）：
 * canvas 长边 ≤1600px、WebP quality 0.8；服务端仍独立校验。
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.type === 'image/webp' && file.size <= 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.8),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp' });
  } catch {
    return file;
  }
}

export async function uploadOne(file: File): Promise<{ key: string; url: string }> {
  const compressed = await compressImage(file);
  const fd = new FormData();
  fd.append('file', compressed);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'include' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? '上传失败');
  return json.data as { key: string; url: string };
}
