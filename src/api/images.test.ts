import { describe, expect, it } from 'vitest';
import { validateImageInput } from './images';
import { validatePng } from '../../supabase/functions/ticket-image/png';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAGklEQVR4nGNwaEggGzGMah7VPKp5VPPAagYAVZTCEFZXgBEAAAAASUVORK5CYII=', 'base64'));
describe('support image security boundary', () => {
  it.each([['a.jpg','image/jpeg'], ['a.jpeg','image/jpeg'], ['a.png','image/png'], ['a.webp','image/webp']])('accepts %s', (name, type) => {
    expect(() => validateImageInput({ name, type, size: 100 })).not.toThrow();
  });
  it.each([['a.svg','image/svg+xml',100], ['a.png','text/html',100], ['a.jpg','image/png',100], ['a.png','image/png',5242881], ['a.png','image/png',0]])('rejects %s %s %s', (name,type,size) => {
    expect(() => validateImageInput({ name,type,size })).toThrow();
  });
  it('accepts a valid bounded PNG', () => { expect(validatePng(png)).toEqual({ width: 20, height: 20 }); });
  it('rejects spoofed signatures and truncated content', () => {
    expect(() => validatePng(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toThrow();
    expect(() => validatePng(png.slice(0,25))).toThrow();
    const corrupt = png.slice(); corrupt[20] = 255;
    expect(() => validatePng(corrupt)).toThrow();
  });
});
