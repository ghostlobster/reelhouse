import React, { useState, useEffect } from 'react';
import {
  FolderDown,
  HardDrive,
  FolderTree,
  Check,
  AlertTriangle,
  X,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { StorageSource } from '../types';
import { formatBytes } from '../utils/formatters';

interface DownloadLocationModalProps {
  isOpen: boolean;
  source: StorageSource;
  actionTitle?: string;
  itemDetails?: string;
  fileCount?: number;
  totalSize?: number;
  onConfirm: (destinationDir: string, saveAsDefault: boolean) => Promise<void>;
  onClose: () => void;
}

export const DownloadLocationModal: React.FC<DownloadLocationModalProps> = ({
  isOpen,
  source,
  actionTitle = 'Confirm Download Location',
  itemDetails,
  fileCount,
  totalSize,
  onConfirm,
  onClose,
}) => {
  const [destinationPath, setDestinationPath] = useState('');
  const [defaultSuggestedPath, setDefaultSuggestedPath] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch suggested default system path whenever modal opens for this source
  useEffect(() => {
    if (!isOpen || !source) return;

    setError(null);
    setSaveAsDefault(true);

    // If source already has a localPath (e.g. from previous edit), use it
    if (source.localPath && source.localPath.trim()) {
      setDestinationPath(source.localPath.trim());
      setDefaultSuggestedPath(source.localPath.trim());
      return;
    }

    // Otherwise query backend for OS-appropriate suggested path
    fetch(`/api/system/default-download-path?sourceName=${encodeURIComponent(source.name)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.suggestedPath) {
          setDefaultSuggestedPath(data.suggestedPath);
          setDestinationPath(data.suggestedPath);
        }
      })
      .catch(() => {
        const fallback = `./downloads/${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        setDefaultSuggestedPath(fallback);
        setDestinationPath(fallback);
      });
  }, [isOpen, source]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = destinationPath.trim();
    if (!trimmed) {
      setError('Please provide a valid destination folder path.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed, saveAsDefault);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to initiate download.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div
        className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
              <FolderDown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Confirm Local Download Location</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  LOCATION REQUIRED
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                No default location was set up in advance for <span className="text-white font-medium">{source.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Action Context Box */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-cyan-300">{actionTitle}</span>
              {fileCount !== undefined && fileCount > 0 && (
                <span className="text-slate-400 font-mono text-[11px]">
                  {fileCount} {fileCount === 1 ? 'file' : 'files'}
                  {totalSize !== undefined && totalSize > 0 && ` • ${formatBytes(totalSize)}`}
                </span>
              )}
            </div>
            {itemDetails && (
              <p className="text-xs text-slate-400 font-mono truncate" title={itemDetails}>
                {itemDetails}
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Specify where this on-premise server should write downloaded assets.
            </p>
          </div>

          {/* Directory Path Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                Local Server Target Directory
              </label>
              {defaultSuggestedPath && (
                <button
                  type="button"
                  onClick={() => setDestinationPath(defaultSuggestedPath)}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                  title="Reset to recommended default folder"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Use Recommended Default</span>
                </button>
              )}
            </div>

            <input
              type="text"
              value={destinationPath}
              onChange={(e) => {
                setDestinationPath(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. E:\Downloads\cdn-mirror or /var/storage/cdn"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              autoFocus
            />

            {error && (
              <div className="flex items-center gap-1.5 text-rose-400 text-xs mt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Folder Hierarchy Preservation Guarantee */}
          <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <FolderTree className="w-4 h-4 text-cyan-400" />
              <span>Exact Folder Hierarchy Preservation</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Files will be mirrored with their full directory path preserved inside this folder:
            </p>
            <div className="p-2 rounded-lg bg-slate-950/80 font-mono text-[11px] text-slate-400 border border-slate-800 overflow-x-auto truncate">
              <span className="text-emerald-400 font-semibold">{destinationPath || '&lt;local-dir&gt;'}</span>
              <span className="text-cyan-400">/&lt;remote-folder&gt;</span>
              <span className="text-slate-200">/&lt;filename&gt;</span>
            </div>
          </div>

          {/* Save As Default Checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 select-none p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 hover:bg-slate-950 transition-colors">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
            />
            <div>
              <span className="font-semibold text-white block">
                Save as default location for source &ldquo;{source.name}&rdquo;
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Subsequent single, batch, or date range downloads for this source will automatically save here without prompting. You can change this anytime in Source Settings.
              </span>
            </div>
          </label>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting || !destinationPath.trim()}
              className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
            >
              {submitting ? (
                <span>Starting Download...</span>
              ) : (
                <>
                  <FolderDown className="w-4 h-4" />
                  <span>Confirm &amp; Start Download</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
