// Tauri's base64-wrapped Minisign format; cryptography is provided by Node/OpenSSL.
// Both the file signature and authenticated comment are verified, matching
// minisign-verify's PublicKey::verify implementation used by the native updater.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const decode = (value) => {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4) throw new Error("Invalid signature encoding");
  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.toString("base64") !== trimmed) throw new Error("Noncanonical signature encoding");
  return bytes;
};
export function verifyUpdateSignature(bytes, signatureText, publicKeyText) {
  const publicLines = decode(publicKeyText).toString("utf8").trimEnd().split(/\r?\n/);
  const signatureLines = decode(signatureText).toString("utf8").trimEnd().split(/\r?\n/);
  if (publicLines.length !== 2 || signatureLines.length !== 4 || !signatureLines[2].startsWith("trusted comment: ")) throw new Error("Invalid Minisign format");
  const key = decode(publicLines[1]);
  const signed = decode(signatureLines[1]);
  const globalSignature = decode(signatureLines[3]);
  if (key.length !== 42 || signed.length !== 74 || globalSignature.length !== 64 || key.subarray(0, 2).toString() !== "Ed" || !key.subarray(2, 10).equals(signed.subarray(2, 10))) throw new Error("Signature public key mismatch");
  const algorithm = signed.subarray(0, 2).toString();
  if (!["Ed", "ED"].includes(algorithm)) throw new Error("Unsupported signature algorithm");
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]), format: "der", type: "spki" });
  const message = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  const signature = signed.subarray(10);
  const comment = Buffer.from(signatureLines[2].slice("trusted comment: ".length));
  if (!verify(null, message, publicKey, signature) || !verify(null, Buffer.concat([signature, comment]), publicKey, globalSignature)) throw new Error("Updater signature verification failed");
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [config, asset, signature] = process.argv.slice(2);
  if (!config || !asset || !signature) throw new Error("Usage: node scripts/verify-update-signature.mjs <tauri.conf.json> <asset> <asset.sig>");
  verifyUpdateSignature(readFileSync(asset), readFileSync(signature, "utf8"), JSON.parse(readFileSync(config, "utf8")).plugins.updater.pubkey);
  console.log("Updater signature verified");
}
