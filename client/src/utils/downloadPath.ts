/**
 * Replace characters that are unsafe in folder names (mirrors the server's sanitizer).
 */
export const sanitizeSourceName = (name: string): string =>
  (name.trim() || 'source').replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Ask the server for its OS-appropriate default download folder for a source,
 * falling back to a relative path (resolved against the server's working directory).
 */
export async function getSuggestedDownloadPath(sourceName: string): Promise<string> {
  const fallback = `./downloads/${sanitizeSourceName(sourceName)}`;
  try {
    const res = await fetch(
      `/api/system/default-download-path?sourceName=${encodeURIComponent(sourceName.trim() || 'source')}`
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.suggestedPath || fallback;
  } catch {
    return fallback;
  }
}
