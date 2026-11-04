/** base64url without padding: the Credential envelope and the cursor token both use it. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
}
