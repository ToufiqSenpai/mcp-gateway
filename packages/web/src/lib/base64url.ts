/** base64url without padding: the Credential envelope and the cursor token both use it. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  return stripPadding(btoa(binary).replaceAll("+", "-").replaceAll("/", "_"))
}

function stripPadding(value: string): string {
  let end = value.length
  while (value[end - 1] === "=") end -= 1
  return value.slice(0, end)
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
  return Uint8Array.from(atob(padded), char => char.codePointAt(0)!)
}
