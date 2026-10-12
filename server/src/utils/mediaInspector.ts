import * as mm from 'music-metadata';
import fs from 'node:fs';

export interface ExtractedMediaInfo {
  duration?: number; // In seconds
  width?: number;
  height?: number;
  codec?: string;
  bitrate?: number;
}

/**
 * Fast in-buffer MP4 Atom / Box parser for timescale, duration, and track dimensions
 */
function parseMp4Buffer(buffer: Buffer): ExtractedMediaInfo | null {
  try {
    let offset = 0;
    while (offset + 8 <= buffer.length) {
      let boxSize = buffer.readUInt32BE(offset);
      const boxType = buffer.toString('ascii', offset + 4, offset + 8);

      if (boxSize === 0) {
        boxSize = buffer.length - offset;
      } else if (boxSize === 1) {
        // 64-bit size
        if (offset + 16 > buffer.length) break;
        boxSize = Number(buffer.readBigUInt64BE(offset + 8));
      }

      if (boxSize < 8) break;

      if (boxType === 'moov') {
        return parseMoovBox(buffer.subarray(offset + 8, Math.min(offset + boxSize, buffer.length)));
      }

      offset += boxSize;
    }
  } catch (err) {
    // Ignore buffer parse errors
  }
  return null;
}

function parseMoovBox(moovBuf: Buffer): ExtractedMediaInfo {
  const result: ExtractedMediaInfo = {};
  let offset = 0;

  while (offset + 8 <= moovBuf.length) {
    let boxSize = moovBuf.readUInt32BE(offset);
    const boxType = moovBuf.toString('ascii', offset + 4, offset + 8);

    if (boxSize === 0 || boxSize > moovBuf.length - offset) {
      boxSize = moovBuf.length - offset;
    }

    if (boxType === 'mvhd') {
      const mvhdBuf = moovBuf.subarray(offset + 8, offset + boxSize);
      if (mvhdBuf.length >= 24) {
        const version = mvhdBuf[0];
        let timescale = 0;
        let duration = 0;

        if (version === 0) {
          timescale = mvhdBuf.readUInt32BE(12);
          duration = mvhdBuf.readUInt32BE(16);
        } else if (version === 1 && mvhdBuf.length >= 32) {
          timescale = mvhdBuf.readUInt32BE(20);
          duration = Number(mvhdBuf.readBigUInt64BE(24));
        }

        if (timescale > 0 && duration > 0) {
          result.duration = duration / timescale;
        }
      }
    } else if (boxType === 'trak') {
      // Check for video track dimensions
      const trakBuf = moovBuf.subarray(offset + 8, offset + boxSize);
      const dim = parseTrakForDimensions(trakBuf);
      if (dim.width && dim.height && !result.width) {
        result.width = dim.width;
        result.height = dim.height;
      }
    }

    offset += boxSize;
  }

  return result;
}

function parseTrakForDimensions(trakBuf: Buffer): { width?: number; height?: number } {
  let offset = 0;
  while (offset + 8 <= trakBuf.length) {
    let boxSize = trakBuf.readUInt32BE(offset);
    const boxType = trakBuf.toString('ascii', offset + 4, offset + 8);
    if (boxSize <= 0 || boxSize > trakBuf.length - offset) boxSize = trakBuf.length - offset;

    if (boxType === 'tkhd') {
      const tkhdBuf = trakBuf.subarray(offset + 8, offset + boxSize);
      if (tkhdBuf.length >= 84) {
        const version = tkhdBuf[0];
        const widthOffset = version === 0 ? 76 : 88;
        if (tkhdBuf.length >= widthOffset + 8) {
          const widthFixed = tkhdBuf.readUInt32BE(widthOffset);
          const heightFixed = tkhdBuf.readUInt32BE(widthOffset + 4);
          const width = Math.round(widthFixed / 65536);
          const height = Math.round(heightFixed / 65536);
          if (width > 0 && height > 0) {
            return { width, height };
          }
        }
      }
    }
    offset += boxSize;
  }
  return {};
}

/**
 * Inspect local media file on disk
 */
export async function inspectLocalMediaFile(filePath: string): Promise<ExtractedMediaInfo> {
  try {
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    return {
      duration: metadata.format.duration,
      bitrate: metadata.format.bitrate,
      codec: metadata.format.codec,
      // For video dimensions, check if any native tags or track info exist
      width: (metadata as any).video?.width,
      height: (metadata as any).video?.height,
    };
  } catch (err) {
    // Fallback to quick buffer read for mp4
    try {
      const buffer = Buffer.alloc(512 * 1024);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);
      const mp4Info = parseMp4Buffer(buffer.subarray(0, bytesRead));
      if (mp4Info && mp4Info.duration) return mp4Info;
    } catch {}
    return {};
  }
}

/**
 * Inspect remote buffer (chunk fetched via Range request or stream)
 */
export async function inspectMediaBuffer(
  buffer: Buffer,
  mimeType?: string,
  totalFileSize?: number
): Promise<ExtractedMediaInfo> {
  const result: ExtractedMediaInfo = {};

  // First try direct MP4 parser (handles mp4, mov, m4v)
  const mp4Info = parseMp4Buffer(buffer);
  if (mp4Info) {
    if (mp4Info.duration) result.duration = mp4Info.duration;
    if (mp4Info.width) result.width = mp4Info.width;
    if (mp4Info.height) result.height = mp4Info.height;
    result.codec = 'h264';
  }

  // Next try music-metadata parser on the buffer
  if (!result.duration) {
    try {
      const metadata = await mm.parseBuffer(buffer, mimeType ? { mimeType } : undefined, {
        duration: true,
        skipCovers: true,
      });
      if (metadata.format.duration) {
        result.duration = metadata.format.duration;
      }
      if (metadata.format.bitrate) {
        result.bitrate = metadata.format.bitrate;
      }
      if (metadata.format.codec) {
        result.codec = metadata.format.codec;
      }
    } catch {
      // Buffer may be partial or truncated
    }
  }

  // If we have totalFileSize and a detected bitrate, estimate duration
  if (!result.duration && result.bitrate && totalFileSize && result.bitrate > 0) {
    result.duration = (totalFileSize * 8) / result.bitrate;
  }

  return result;
}
