const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffSeconds = Math.floor((now - date.getTime()) / 1000);

  if (diffSeconds < MINUTE) return "just now";
  if (diffSeconds < HOUR) {
    const mins = Math.floor(diffSeconds / MINUTE);
    return `${mins} min ago`;
  }
  if (diffSeconds < DAY) {
    const hours = Math.floor(diffSeconds / HOUR);
    return `${hours}h ago`;
  }
  if (diffSeconds < WEEK) {
    const days = Math.floor(diffSeconds / DAY);
    return `${days}d ago`;
  }
  if (diffSeconds < MONTH) {
    const weeks = Math.floor(diffSeconds / WEEK);
    return `${weeks}w ago`;
  }
  return date.toLocaleDateString();
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}
