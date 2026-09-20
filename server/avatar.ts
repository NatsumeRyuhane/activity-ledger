import sharp from "sharp";
import { AppError } from "./service";

export const AVATAR_SIZE = 100;
const AVATAR_QUALITY = 82;
const MAX_DATA_URL_LENGTH = 300_000;

/** Normalizes any uploaded image into a square 100x100 WebP data URL. */
export async function toAvatarDataUrl(input: Buffer): Promise<string> {
  let output: Buffer;
  try {
    output = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: AVATAR_QUALITY })
      .toBuffer();
  } catch {
    throw new AppError(400, "invalid_image", "无法识别这张图片，请换一张试试");
  }

  const dataUrl = `data:image/webp;base64,${output.toString("base64")}`;
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new AppError(400, "image_too_large", "图片压缩后仍然过大，请换一张");
  }
  return dataUrl;
}
