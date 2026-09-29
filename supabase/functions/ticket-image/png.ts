/** Accept only metadata-free, bounded PNG output from the image normalizer.
 * Byte structure and CRCs are checked on the server, independently of browser MIME.
 */
export function validatePng(bytes: Uint8Array): { width: number; height: number } {
  const fail = () => { throw new Error('This image is too large or could not be prepared. Choose a smaller image.'); };
  if (bytes.length < 45 || bytes.length > 5 * 1024 * 1024 ||
    ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, data = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + size + 12;
    if (end > bytes.length) return fail();
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!['IHDR','PLTE','tRNS','IDAT','IEND'].includes(kind)) return fail();
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return fail();
    if (offset === 8 && kind !== 'IHDR') return fail();
    if (kind === 'IHDR') {
      if (offset !== 8 || size !== 13) return fail();
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      if (!width || !height || width > 4096 || height > 4096 || width * height > 16777216) return fail();
    }
    if (kind === 'IDAT') data = true;
    if (kind === 'IEND') { if (size || end !== bytes.length || !data) return fail(); ended = true; }
    offset = end;
  }
  if (!ended || offset !== bytes.length) return fail();
  return { width, height };
}
