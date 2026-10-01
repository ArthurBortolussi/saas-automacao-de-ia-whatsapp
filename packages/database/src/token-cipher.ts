import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * AES-256-GCM para tokens em repouso. O companyId entra como dado autenticado (AAD):
 * um ciphertext copiado para a linha de outra empresa não decifra.
 * Formato: v1.<iv>.<tag>.<ciphertext> (base64url). O prefixo de versão permite rotação futura da chave.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("A chave de criptografia precisa ter 32 bytes.");
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
  }

  decrypt(payload: string, aad: string): string {
    const [version, iv, tag, ciphertext] = payload.split(".");
    if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Token cifrado em formato desconhecido.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
}
