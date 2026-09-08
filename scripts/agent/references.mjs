import { open, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Owner-provided visual references stay private, outside candidate source and its fingerprint.
export async function copyReferenceImages(paths, control, existing = []) {
  if (existing.length + paths.length > 4) throw new Error('Use at most four reference images per run');
  const images = [];
  for (const path of paths) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Reference image must be a regular file no larger than 20 MiB');
      data = await handle.readFile();
    } finally { await handle.close(); }
    const extension = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
      : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'jpg'
        : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!extension) throw new Error('Reference images must be PNG, JPEG or WebP');
    images.push({ data, extension, sha256: createHash('sha256').update(data).digest('hex') });
  }
  await mkdir(join(control, 'references'), { recursive: true, mode: 0o700 });
  const refs = [...existing];
  for (const image of images) {
    const file = 'references/image-' + (refs.length + 1) + '.' + image.extension;
    await writeFile(join(control, file), image.data, { mode: 0o600, flag: 'wx' });
    refs.push({ file, sha256: image.sha256 });
  }
  return refs;
}
