/**
 * Format utilities for displaying data
 */

/**
 * Format a number with locale-specific separators or K/M suffix
 * Always returns non-negative values
 */
export function formatNumber(num: number): string {
  // Ensure value is never negative
  const safeNum = Math.max(0, num);
  if (safeNum >= 1_000_000) {
    return `${(safeNum / 1_000_000).toFixed(1)}M`;
  }
  if (safeNum >= 10_000) {
    return `${(safeNum / 1_000).toFixed(1)}K`;
  }
  return safeNum.toLocaleString();
}

/**
 * Format a number with compact notation (K/M/B)
 * Always uses suffix for numbers >= 1000
 * Example: 74617 -> "74.6K", 2300000 -> "2.3M"
 */
export function formatCompact(num: number, decimals = 1): string {
  const safeNum = Math.max(0, num);
  if (safeNum >= 1_000_000_000) {
    return `${(safeNum / 1_000_000_000).toFixed(decimals)}B`;
  }
  if (safeNum >= 1_000_000) {
    return `${(safeNum / 1_000_000).toFixed(decimals)}M`;
  }
  if (safeNum >= 1_000) {
    return `${(safeNum / 1_000).toFixed(decimals)}K`;
  }
  return safeNum.toFixed(decimals === 0 ? 0 : decimals);
}

/**
 * Format bytes to human-readable size
 * Always returns non-negative values
 */
export function formatBytes(bytes: number): string {
  // Ensure value is never negative
  const safeBytes = Math.max(0, bytes);
  if (safeBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(safeBytes) / Math.log(k));
  return `${parseFloat((safeBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format milliseconds to human-readable duration
 * Always returns non-negative values
 */
export function formatDuration(ms: number): string {
  // Ensure value is never negative
  const safeMs = Math.max(0, ms);
  if (safeMs < 1000) return `${safeMs}ms`;
  if (safeMs < 60000) return `${(safeMs / 1000).toFixed(1)}s`;
  if (safeMs < 3600000) {
    const mins = Math.floor(safeMs / 60000);
    const secs = Math.floor((safeMs % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(safeMs / 3600000);
  const mins = Math.floor((safeMs % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/**
 * Format seconds to HH:MM:SS
 * Always returns non-negative values
 */
export function formatUptime(seconds: number): string {
  // Ensure value is never negative
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(timestamp: number | string | undefined | null): string {
  if (timestamp === undefined || timestamp === null) return '-';

  const now = Date.now();
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;

  // Handle invalid timestamps
  if (isNaN(ts) || ts <= 0) return '-';

  const diff = now - ts;

  if (diff < 0) {
    // Future time
    const absDiff = Math.abs(diff);
    if (absDiff < 1000) return 'in a moment';
    if (absDiff < 60000) return `in ${Math.floor(absDiff / 1000)}s`;
    if (absDiff < 3600000) return `in ${Math.floor(absDiff / 60000)}m`;
    if (absDiff < 86400000) return `in ${Math.floor(absDiff / 3600000)}h`;
    return `in ${Math.floor(absDiff / 86400000)}d`;
  }

  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Format timestamp to locale date string
 */
export function formatDateTime(timestamp: number | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Escape HTML characters for safe rendering
 */
export function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}
