import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Detects if text is primarily RTL (Arabic, Hebrew, etc.) */
const RTL_REGEX = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/;
export function getTextDir(text: string): "rtl" | "ltr" {
  // Check first 200 chars of meaningful text (skip markdown syntax)
  const sample = text.replace(/[#*_`\[\]()!>\-|\\]/g, "").slice(0, 200);
  return RTL_REGEX.test(sample) ? "rtl" : "ltr";
}
