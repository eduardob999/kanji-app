import { describe, expect, it } from 'vitest';
import { decodedSize, fitWithin, MAX_EDGE } from './image';

describe('preparing a background image', () => {
  it('leaves an image that is already small enough alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('caps the long edge and keeps the shape', () => {
    // A portrait phone photo: 3024x4032 is an iPhone's 12 megapixels.
    const fitted = fitWithin(3024, 4032);
    expect(fitted.height).toBe(MAX_EDGE);
    expect(fitted.width).toBe(Math.round((3024 / 4032) * MAX_EDGE));
  });

  it('caps the long edge of a landscape image too', () => {
    const fitted = fitWithin(4032, 3024);
    expect(fitted.width).toBe(MAX_EDGE);
  });

  it('measures a data URL by what it decodes to, not by its length', () => {
    // base64 costs a third on top, and Firestore's limit applies to the field
    // as stored — so guessing from string length would overstate by 33%.
    const dataUrl = `data:image/jpeg;base64,${Buffer.from('x'.repeat(300)).toString('base64')}`;
    expect(decodedSize(dataUrl)).toBe(300);
  });
});
