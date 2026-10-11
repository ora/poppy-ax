import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand-mark";

// The browser tab icon. Made once at build time.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandMark size={size.width} />, size);
}
