import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, BCRYPT_ROUNDS, (err, hash) => {
      if (err) {
        reject(err);
      } else {
        resolve(hash);
      }
    });
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (err, same) => {
      if (err) {
        reject(err);
      } else {
        resolve(Boolean(same));
      }
    });
  });
}

export async function signSession(
  { sub }: { sub: string },
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<{ sub: string }> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Invalid session token");
  }
  return { sub };
}
