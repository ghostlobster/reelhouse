import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  Download,
  FolderTree,
  CheckCircle,
  AlertCircle,
  BookmarkCheck,
  Zap,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { StorageSource, StorageFile } from '../types';
import { formatBytes, formatDate } from '../utils/formatters';
import { DateTimeRangePicker } from './DateTimeRangePicker';

interface DateRangeDownloadModalProps {
  isOpen: boolean;
  source: StorageSource;
  onClose: () => void;
  onStartDownload: (params: {
    startDate?: number;
    endDate?: number;
    onlyMissing: boolean;
    updateCheckpoint: boolean;
  }) => Promise<void>;
}

export const DateRangeDownloadModal: React.FC<DateRangeDownloadModalProps> = ({
  isOpen,
  source,
  onClose,
  onStartDownload,
}) => {
  const [activePreset, setActivePreset] = useState<string>('checkpoint');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [updateCheckpoint, setUpdateCheckpoint] = useState(true);
  const [showManualInputs, setShowManualInputs] = useState(false);

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    count: number;
    totalSize: number;
    files: StorageFile[];
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Initialize dates based on preset
  useEffect(() => {
    if (!isOpen) return;

    const now = new Date();
    setEndDate(now);

    if (source.lastCheckpointMtime) {
      setActivePreset('checkpoint');
      setStartDate(new Date(source.lastCheckpointMtime));
    } else {
      setActivePreset('7d');
      setStartDate(new Date(Date.now() - 7 * 86400000));
    }
  }, [isOpen, source]);

  const applyPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    const now = new Date();
    setEndDate(now);

    let start = new Date();
    switch (presetKey) {
      case 'checkpoint':
        if (source.lastCheckpointMtime) {
          start = new Date(source.lastCheckpointMtime);
        } else {
          start = new Date(Date.now() - 7 * 86400000);
        }
        break;
      case '24h':
        start = new Date(Date.now() - 24 * 3600000);
        break;
      case '7d':
        start = new Date(Date.now() - 7 * 86400000);
        break;
      case '30d':
        start = new Date(Date.now() - 30 * 86400000);
        break;
      case '90d':
        start = new Date(Date.now() - 90 * 86400000);
        break;
      case 'all':
        start = new Date(0);
        break;
      default:
        break;
    }
    setStartDate(start);
  };

  const handlePickerChange = (newStart: Date, newEnd: Date) => {
    setStartDate(newStart);
    setEndDate(newEnd);
    setActivePreset('custom');
  };

  // Fetch preview matching files count and size whenever dates or onlyMissing changes
  useEffect(() => {
    if (!isOpen || !source) return;

    const startMs = startDate ? startDate.getTime() : undefined;
    const endMs = endDate ? endDate.getTime() : undefined;

    setPreviewLoading(true);
    const params = new URLSearchParams();
    if (startMs !== undefined) params.append('startDate', startMs.toString());
    if (endMs !== undefined) params.append('endDate', endMs.toString());
    params.append('onlyMissing', onlyMissing ? 'true' : 'false');

    const timer = setTimeout(() => {
      fetch(`/api/sources/${source.id}/date-range-preview?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          setPreviewData(data);
          setPreviewLoading(false);
        })
        .catch(() => setPreviewLoading(false));
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, source, startDate, endDate, onlyMissing]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const startMs = startDate ? startDate.getTime() : undefined;
      const endMs = endDate ? endDate.getTime() : undefined;

      onClose();
      await onStartDownload({
        startDate: startMs,
        endDate: endMs,
        onlyMissing,
        updateCheckpoint,
      });
    } catch (err: any) {
      alert(err.message || 'Download failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Download by Date Range</h2>
              <p className="text-[11px] text-slate-400">
                Filter files by last modified timestamp and update download checkpoints
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Time Range Presets
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset('checkpoint')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activePreset === 'checkpoint'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 ring-2 ring-cyan-500/20'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Since Last Checkpoint</span>
                {source.lastCheckpointMtime && (
                  <span className="text-[10px] text-cyan-400/80 font-mono">
                    ({formatDate(source.lastCheckpointMtime)})
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => applyPreset('24h')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activePreset === '24h'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                Past 24 Hours
              </button>

              <button
                type="button"
                onClick={() => applyPreset('7d')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activePreset === '7d'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                Past 7 Days
              </button>

              <button
                type="button"
                onClick={() => applyPreset('30d')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activePreset === '30d'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                Past 30 Days
              </button>

              <button
                type="button"
                onClick={() => applyPreset('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activePreset === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                }`}
              >
                All Time
              </button>
            </div>
          </div>

          {/* Interactive Date & Time Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                Select Date &amp; Time Range
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                Click start date, then click end date
              </span>
            </label>

            <DateTimeRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={handlePickerChange}
              checkpointTimestamp={source.lastCheckpointMtime}
            />
          </div>

          {/* Optional manual override toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowManualInputs(!showManualInputs)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
            >
              {showManualInputs ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>{showManualInputs ? 'Hide manual timestamp fields' : 'Manual ISO datetime override'}</span>
            </button>

            {showManualInputs && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2.5 p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    Start Datetime (ISO)
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate ? new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setStartDate(new Date(e.target.value));
                        setActivePreset('custom');
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    End Datetime (ISO)
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate ? new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setEndDate(new Date(e.target.value));
                        setActivePreset('custom');
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Options: Checkpoint & Missing Filter */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 select-none">
              <input
                type="checkbox"
                checked={updateCheckpoint}
                onChange={(e) => setUpdateCheckpoint(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
              <div>
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <BookmarkCheck className="w-3.5 h-3.5 text-cyan-400" />
                  Save as new checkpoint timestamp
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Next time you click "Since Last Checkpoint", it will resume directly from this date.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 select-none">
              <input
                type="checkbox"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
              <div>
                <span className="font-semibold text-white">
                  Only download missing files
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Skips files that already exist on the on-premise box with matching size.
                </span>
              </div>
            </label>
          </div>

          {/* Folder Structure Preservation Banner */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/90 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-cyan-300">
              <FolderTree className="w-4 h-4 text-cyan-400" />
              <span>Exact Folder Structure Preservation Guaranteed</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
              Target: <span className={source.localPath?.trim() ? 'text-slate-300' : 'text-amber-400 font-sans'}>{source.localPath?.trim() || '(Location confirmation will popup on submit)'}</span>/&lt;path&gt;/&lt;filename&gt;
            </p>
          </div>

          {/* Range Match Preview Card */}
          <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 uppercase font-bold tracking-wider block">
                Matching Files in Range
              </span>
              <div className="text-lg font-extrabold text-white font-mono mt-0.5">
                {previewLoading ? (
                  <span className="text-sm text-cyan-400">Calculating...</span>
                ) : (
                  <>
                    <span>{previewData?.count || 0} files</span>
                    <span className="text-xs text-slate-400 font-sans font-normal ml-2">
                      ({formatBytes(previewData?.totalSize || 0)})
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="text-right text-[11px] text-slate-400">
              {source.lastCheckpointMtime && (
                <div>Current checkpoint: {formatDate(source.lastCheckpointMtime)}</div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting || (previewData?.count === 0 && !previewLoading)}
              className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>
                {submitting
                  ? 'Queueing...'
                  : `Start Range Download (${previewData?.count || 0} files)`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
