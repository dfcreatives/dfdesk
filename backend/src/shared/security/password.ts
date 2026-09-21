import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const scrypt = (
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
  });
  return `scrypt:v1:16384:8:1:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [
    algorithm,
    version,
    cost,
    blockSize,
    parallelization,
    saltValue,
    expectedValue,
  ] = encoded.split(":");
  if (
    algorithm === "scrypt" &&
    version &&
    cost &&
    !blockSize &&
    !parallelization
  ) {
    const expected = Buffer.from(cost, "hex");
    const actual = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(version),
      expected.length,
      { N: 16_384, r: 8, p: 1 },
    );
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  if (
    algorithm !== "scrypt" ||
    version !== "v1" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !saltValue ||
    !expectedValue
  )
    return false;
  const expected = Buffer.from(expectedValue, "base64url");
  const actual = await scrypt(
    password.normalize("NFKC"),
    Buffer.from(saltValue, "base64url"),
    expected.length,
    {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
