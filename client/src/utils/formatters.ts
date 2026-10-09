export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return '0s';
  const sec = Math.floor(totalSeconds);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSeconds = sec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

export function formatClockTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const sec = Math.floor(seconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainingSecs)}`;
  }
  return `${pad(minutes)}:${pad(remainingSecs)}`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getProviderBadge(provider: string): { label: string; bg: string; text: string } {
  switch (provider) {
    case 'aws':
      return { label: 'AWS S3', bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400' };
    case 'r2':
      return { label: 'Cloudflare R2', bg: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-400' };
    case 'minio':
      return { label: 'MinIO Self-Hosted', bg: 'bg-rose-500/10 border-rose-500/30', text: 'text-rose-400' };
    case 'keycdn':
      return { label: 'KeyCDN', bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' };
    case 'wasabi':
      return { label: 'Wasabi', bg: 'bg-lime-500/10 border-lime-500/30', text: 'text-lime-400' };
    case 'b2':
      return { label: 'Backblaze B2', bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400' };
    default:
      return { label: 'S3-Compatible', bg: 'bg-cyan-500/10 border-cyan-500/30', text: 'text-cyan-400' };
  }
}
