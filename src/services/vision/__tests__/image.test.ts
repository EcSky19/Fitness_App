import {
  assertImageSize,
  estimateBase64Bytes,
  formatBytes,
  imageUriToBase64,
  MAX_IMAGE_BYTES,
  mimeTypeFromUri,
} from '../image';
import { VisionError } from '../types';

const mockRead = jest.fn<Promise<string>, []>();

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    base64(): Promise<string> {
      return mockRead();
    }
  },
}));

describe('mimeTypeFromUri', () => {
  it.each([
    ['file:///photos/meal.jpg', 'image/jpeg'],
    ['file:///photos/meal.JPEG', 'image/jpeg'],
    ['file:///photos/label.png', 'image/png'],
    ['file:///photos/label.webp', 'image/webp'],
    ['file:///photos/label.heic', 'image/heic'],
    ['file:///photos/no-extension', 'image/jpeg'],
    ['file:///photos/meal.jpg?width=100', 'image/jpeg'],
    ['data:image/png;base64,AAAA', 'image/png'],
  ])('maps %s to %s', (uri, expected) => {
    expect(mimeTypeFromUri(uri)).toBe(expected);
  });
});

describe('estimateBase64Bytes', () => {
  it('estimates decoded size', () => {
    expect(estimateBase64Bytes('')).toBe(0);
    expect(estimateBase64Bytes('AAAA')).toBe(3);
    expect(estimateBase64Bytes('AAA=')).toBe(2);
    expect(estimateBase64Bytes('AA==')).toBe(1);
  });

  it('ignores a data URL prefix', () => {
    expect(estimateBase64Bytes('data:image/jpeg;base64,AAAA')).toBe(3);
  });
});

describe('assertImageSize', () => {
  it('accepts a normal photo', () => {
    expect(() => assertImageSize('A'.repeat(4000))).not.toThrow();
  });

  it('rejects payloads above the ceiling', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024);

    expect(() => assertImageSize(oversized)).toThrow(VisionError);
    expect(() => assertImageSize(oversized)).toThrow(/too large/i);
  });
});

describe('formatBytes', () => {
  it('formats readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('imageUriToBase64', () => {
  beforeEach(() => {
    mockRead.mockReset();
  });

  it('reads a file URI with the SDK 54 File API', async () => {
    mockRead.mockResolvedValueOnce('QUJDRA==');

    const result = await imageUriToBase64('file:///photos/meal.png');

    expect(result).toEqual({ base64: 'QUJDRA==', mimeType: 'image/png' });
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('strips a data URL prefix returned by the reader', async () => {
    mockRead.mockResolvedValueOnce('data:image/jpeg;base64,QUJDRA==');

    const result = await imageUriToBase64('file:///photos/meal.jpg');

    expect(result.base64).toBe('QUJDRA==');
  });

  it('handles data URIs without touching the file system', async () => {
    const result = await imageUriToBase64('data:image/webp;base64,QUJDRA==');

    expect(result).toEqual({ base64: 'QUJDRA==', mimeType: 'image/webp' });
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('rejects an empty uri', async () => {
    await expect(imageUriToBase64('')).rejects.toThrow(VisionError);
    await expect(imageUriToBase64('   ')).rejects.toThrow(/no photo/i);
  });

  it('rejects an oversized photo', async () => {
    mockRead.mockResolvedValueOnce('A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024));

    await expect(imageUriToBase64('file:///photos/huge.jpg')).rejects.toThrow(/too large/i);
  });

  it('reports an unreadable file with a user-facing message', async () => {
    mockRead.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(imageUriToBase64('file:///photos/missing.jpg')).rejects.toThrow(
      /couldn't read the photo/i
    );
  });
});
