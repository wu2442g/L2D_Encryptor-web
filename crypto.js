/** L2DE v1 — 與 Python crypto_common 一致 */
const MAGIC = new TextEncoder().encode("L2DE");
const VERSION = 1;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const PBKDF2_ITERATIONS = 200000;

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptAssetBytes(plain, password) {
  const data = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await deriveKey(password, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    data
  );
  return concatBytes(
    MAGIC,
    new Uint8Array([VERSION]),
    salt,
    nonce,
    new Uint8Array(cipherBuf)
  );
}

window.L2DCrypto = { encryptAssetBytes };