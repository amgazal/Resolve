import { validatePng } from '../../supabase/functions/ticket-image/png';
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export interface SupportImage { file: File; width: number; height: number }
export function validateImageInput(file: Pick<File, 'name' | 'size' | 'type'>) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  if (!extension || !types[extension] || types[extension] !== file.type) throw new Error('Choose a JPEG, PNG, or WebP image with a matching file extension.');
  if (!file.size || file.size > IMAGE_LIMIT) throw new Error('Each image must be no larger than 5 MB.');
}
export async function normalizeImage(file: File): Promise<SupportImage> {
  validateImageInput(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (image.width * image.height > 48000000) throw new Error('This image is too large. Choose an image under 48 megapixels.');
    const scale = Math.min(1, 4096 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('This browser cannot prepare images.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare image')), 'image/png'));
    // Some browsers add color/metadata chunks. Keep only the pixel representation.
    const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
    const chunks = [bytes.slice(0, 8)]; let offset = 8;
    while (offset + 12 <= bytes.length) {
      const end = offset + view.getUint32(offset) + 12;
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (['IHDR','PLTE','tRNS','IDAT','IEND'].includes(kind)) chunks.push(bytes.slice(offset, end));
      offset = end;
    }
    const clean = new Blob(chunks, { type: 'image/png' });
    validatePng(new Uint8Array(await clean.arrayBuffer()));
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[\x00-\x1f\x7f/\\]/g, '').slice(0, 150) || 'support';
    return { file: new File([clean], `${name}.png`, { type: 'image/png' }), width: canvas.width, height: canvas.height };
  } finally { image.close(); }
}
