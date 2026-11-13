import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { constants, closeSync, fsyncSync, openSync, readSync, writeSync, fstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

// Fixed, versioned parameters: the archive never chooses its own KDF cost.
const magic = Buffer.from('SMARCHAT-BACKUP\x01')
const headerBytes = magic.length + 16 + 12
const maxTotal = 64 * 1024 ** 3
const entry = z.object({ name: z.string().regex(/^(SmarChat\.db|blobs\/[a-f0-9-]{36})$/), size: z.number().int().min(0).max(8 * 1024 ** 3) }).strict()
export const manifestSchema = z.object({
  format: z.literal(1), appVersion: z.string().max(40), databaseVersion: z.number().int().min(1).max(3),
  createdAt: z.string().datetime(), masterKey: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z.object({ chats: z.number().int().nonnegative(), messages: z.number().int().nonnegative(), assets: z.number().int().nonnegative() }).strict(),
  files: z.array(entry).min(1).max(100_000)
}).strict().superRefine((m, ctx) => {
  const names = new Set(m.files.map(file => file.name))
  if (names.size !== m.files.length || !names.has('SmarChat.db') || m.files.reduce((sum, f) => sum + f.size, 0) > maxTotal || m.files.some(f => f.name.startsWith('blobs/') && f.size > 20 * 1024 ** 2 + 28))
    ctx.addIssue({ code: 'custom', message: '备份文件清单无效或超出限制' })
})
export type BackupManifest = z.infer<typeof manifestSchema>
export type Progress = (phase: string, done: number, total: number) => void
export function backupPassword(value: unknown): string {
  return z.string().min(8, '备份密码至少 8 个字符').max(256, '备份密码最多 256 个字符').parse(value)
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(backupPassword(password), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 }, (error, key) => error ? reject(error) : resolve(key)))
}
function write(fd: number, data: Buffer): void {
  let at = 0
  while (at < data.length) at += writeSync(fd, data, at, data.length - at)
}
async function* chunks(fd: number, start: number, length: number): AsyncGenerator<Buffer> {
  let at = 0
  while (at < length) {
    const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, length - at))
    const n = readSync(fd, buffer, 0, buffer.length, start + at)
    if (!n) throw new Error('文件读取不完整')
    at += n; yield buffer.subarray(0, n)
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}
export async function writeArchive(target: string, root: string, value: BackupManifest, password: string, progress: Progress = () => {}): Promise<void> {
  const manifest = manifestSchema.parse(value)
  const salt = randomBytes(16); const iv = randomBytes(12)
  const key = await derive(password, salt)
  const partial = join(dirname(target), `.SmarChat-${randomUUID()}.partial`)
  let fd: number | undefined
  try {
    fd = openSync(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    const header = Buffer.concat([magic, salt, iv])
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header)
    write(fd, header)
    const json = Buffer.from(JSON.stringify(manifest)); const length = Buffer.alloc(4); length.writeUInt32BE(json.length)
    if (json.length > 16 * 1024 ** 2) throw new Error('备份清单过大')
    write(fd, cipher.update(length)); write(fd, cipher.update(json))
    const total = manifest.files.reduce((sum, file) => sum + file.size, 0); let done = 0
    for (const file of manifest.files) {
      const input = openSync(join(root, file.name), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = fstatSync(input)
        if (!stat.isFile() || stat.size !== file.size) throw new Error('数据文件已变化，请重新备份')
        let bytes = 0
        for await (const chunk of chunks(input, 0, file.size)) {
          bytes += chunk.length; done += chunk.length
          if (bytes > file.size) throw new Error('数据文件已变化，请重新备份')
          write(fd, cipher.update(chunk as Buffer)); progress('正在加密备份', done, total)
        }
        if (bytes !== file.size || fstatSync(input).size !== file.size) throw new Error('数据文件已变化，请重新备份')
      } finally { closeSync(input) }
    }
    write(fd, cipher.final()); write(fd, cipher.getAuthTag()); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(partial, target)
  } finally { key.fill(0); if (fd !== undefined) closeSync(fd); rmSync(partial, { force: true }) }
}

class Bytes {
  private chunk: Buffer = Buffer.alloc(0)
  private at = 0
  constructor(private iterator: AsyncIterator<Buffer>) {}
  async take(size: number, consume: (data: Buffer) => void): Promise<void> {
    while (size > 0) {
      if (this.at === this.chunk.length) {
        const next = await this.iterator.next()
        if (next.done) throw new Error('备份文件不完整')
        this.chunk = next.value; this.at = 0
        if (!this.chunk.length) continue
      }
      const n = Math.min(size, this.chunk.length - this.at)
      consume(this.chunk.subarray(this.at, this.at + n)); this.at += n; size -= n
    }
  }
  async read(size: number): Promise<Buffer> {
    const result = Buffer.alloc(size); let at = 0
    await this.take(size, chunk => { chunk.copy(result, at); at += chunk.length }); return result
  }
  async finish(): Promise<void> {
    if (this.at !== this.chunk.length) throw new Error('备份包含多余数据')
    // Consume final() as well: no extracted file is trusted before the GCM tag passes.
    for (;;) { const next = await this.iterator.next(); if (next.done) return; if (next.value.length) throw new Error('备份包含多余数据') }
  }
}
export async function readArchive(source: string, stage: string, password: string, progress: Progress = () => {}): Promise<BackupManifest> {
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  let key: Buffer | undefined
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size < headerBytes + 20 || stat.size > maxTotal + 20 * 1024 ** 2) throw new Error('备份文件大小无效')
    const header = Buffer.alloc(headerBytes); readSync(fd, header, 0, header.length, 0)
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('不是支持的 SmarChat 备份版本')
    key = await derive(password, header.subarray(magic.length, magic.length + 16))
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(-12)); decipher.setAAD(header)
    const tag = Buffer.alloc(16); readSync(fd, tag, 0, 16, stat.size - 16); decipher.setAuthTag(tag)
    async function* decrypted(): AsyncGenerator<Buffer> {
      for await (const chunk of chunks(fd, headerBytes, stat.size - headerBytes - 16)) yield decipher.update(chunk)
      yield decipher.final()
    }
    const bytes = new Bytes(decrypted())
    const length = (await bytes.read(4)).readUInt32BE()
    if (length < 2 || length > 16 * 1024 ** 2) throw new Error('密码错误或备份文件损坏')
    const manifest = manifestSchema.parse(JSON.parse((await bytes.read(length)).toString('utf8')))
    // stage must be a fresh, private directory supplied by the main process.
    mkdirSync(join(stage, 'blobs'), { mode: 0o700 })
    const total = manifest.files.reduce((sum, file) => sum + file.size, 0); let done = 0
    for (const file of manifest.files) {
      const output = openSync(join(stage, file.name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try {
        await bytes.take(file.size, chunk => { write(output, chunk); done += chunk.length; progress('正在解密校验', done, total) })
        fsyncSync(output)
      } finally { closeSync(output) }
    }
    await bytes.finish()
    return manifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw new Error('磁盘空间不足，未更改当前工作区')
    throw new Error('密码错误、备份损坏或版本不兼容；当前工作区未更改')
  } finally { key?.fill(0); closeSync(fd) }
}
