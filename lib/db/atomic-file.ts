import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Atomic file replacement: the target either keeps its previous complete contents or receives the
 * new complete contents — a reader (or a crash, or a concurrent lambda) never observes a truncated
 * JSON document.
 *
 * Sequence: write a uniquely named temporary file in the same directory → fsync it → rename it over
 * the target. `rename` within one directory is atomic on POSIX filesystems (and on the Linux /tmp
 * used on Vercel). The temporary name carries the pid and random bytes so two writers never share
 * one temporary file.
 */
export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(temporary, 'w');
    fs.writeFileSync(fd, data, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is already unusable; the original error is what matters.
      }
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best-effort cleanup of the temporary file.
    }
    throw error;
  }
}
