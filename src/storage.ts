// 데이터·사진 저장소.
// S3 호환 버킷 환경변수가 있으면 버킷에, 없으면 로컬 폴더(DATA_DIR, 기본 ./.data)에 저장한다.
import { S3Client } from "bun";

export interface Storage {
  kind: "bucket" | "local";
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  readBytes(key: string): Promise<Uint8Array | null>;
  writeBytes(key: string, value: Uint8Array, type: string): Promise<void>;
}

export function createStorage(env = Bun.env): Storage {
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    const s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION || "auto",
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      virtualHostedStyle: false,
    });
    return {
      kind: "bucket",
      async read(key) {
        const f = s3.file(key);
        return (await f.exists()) ? f.text() : null;
      },
      async write(key, value) {
        await s3.file(key).write(value, { type: "application/json" });
      },
      async readBytes(key) {
        const f = s3.file(key);
        return (await f.exists()) ? new Uint8Array(await f.arrayBuffer()) : null;
      },
      async writeBytes(key, value, type) {
        await s3.file(key).write(value, { type });
      },
    };
  }
  const dir = env.DATA_DIR || "./.data";
  return {
    kind: "local",
    async read(key) {
      const f = Bun.file(`${dir}/${key}`);
      return (await f.exists()) ? f.text() : null;
    },
    async write(key, value) {
      await Bun.write(`${dir}/${key}`, value);
    },
    async readBytes(key) {
      const f = Bun.file(`${dir}/${key}`);
      return (await f.exists()) ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    async writeBytes(key, value) {
      await Bun.write(`${dir}/${key}`, value);
    },
  };
}
