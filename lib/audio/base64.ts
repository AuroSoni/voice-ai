type WithToBase64 = Uint8Array & { toBase64?: () => string };

/** Works in browsers and Node; chunked so large buffers don't overflow the argument limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as WithToBase64).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
