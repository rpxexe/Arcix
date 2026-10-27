// src/services/unattended.ts
// Unattended access: host stores a salted PBKDF2 hash; incoming password is verified locally.

const KEY = 'aerodesk_unattended_pbkdf2';

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256));
}

export async function saveUnattendedPassword(password: string) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await pbkdf2(password, salt) }));
  localStorage.removeItem('aerodesk_unattended_hash'); // legacy base64 value, never secure
}

export async function verifyUnattendedPassword(password: string): Promise<boolean> {
  if (!password || localStorage.getItem('aerodesk_unattended_enabled') !== 'true') return false;
  try {
    const { salt, hash } = JSON.parse(localStorage.getItem(KEY) || '');
    return (await pbkdf2(password, salt)) === hash;
  } catch {
    return false;
  }
}
