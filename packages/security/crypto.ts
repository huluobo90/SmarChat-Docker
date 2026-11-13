import {
  randomBytes,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export function secret(name: string) {
  return readFileSync(
    `${process.env.SECRET_DIR || "/run/secrets"}/${name}`,
    "utf8",
  ).trim();
}
export function masterKey() {
  const b = Buffer.from(secret("master_key"), "hex");
  if (b.length !== 32) throw Error("Invalid master key");
  return b;
}
export function seal(data: Buffer | string, key = masterKey()): Buffer {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([
    Buffer.from("SC01"),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}
export function unseal(data: Buffer, key = masterKey()): Buffer {
  if (data.subarray(0, 4).toString() !== "SC01")
    throw Error("Invalid encrypted object");
  const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  cipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([cipher.update(data.subarray(32)), cipher.final()]);
}
export const encryptText = (s: string) => seal(s).toString("base64");
export const decryptText = (s: string) =>
  unseal(Buffer.from(s, "base64")).toString();
export async function hashPassword(s: string) {
  const salt = randomBytes(16).toString("hex");
  const h = (await scrypt(s, salt, 64)) as Buffer;
  return `${salt}:${h.toString("hex")}`;
}
export async function verifyPassword(s: string, h: string) {
  const [salt, hex] = h.split(":");
  if (!salt || !hex) return false;
  const b = (await scrypt(s, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return b.length === expected.length && timingSafeEqual(b, expected);
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  return Array.from(randomBytes(32), (x) => alphabet[x % 32]).join("");
}
function decodeBase32(s: string) {
  let bits = "";
  for (const c of s) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((x) => parseInt(x, 2)));
}
export function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decodeBase32(secret)).update(b).digest();
  const o = h[19] & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, previous = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(Date.now() / 30000);
  for (const n of [step - 1, step, step + 1])
    if (
      n > previous &&
      timingSafeEqual(Buffer.from(totp(secret, n)), Buffer.from(code))
    )
      return n;
  return null;
}
export async function backupKey(password: string, salt: Buffer) {
  if (password.length < 12) throw Error("备份密码至少 12 个字符");
  return (await scrypt(password, salt, 32)) as Buffer;
}
