export async function documentIdentity(data: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
