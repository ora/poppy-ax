import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand-mark";

// The icon iOS uses for a saved bookmark. Made once at build time.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={size.width} />, size);
}
