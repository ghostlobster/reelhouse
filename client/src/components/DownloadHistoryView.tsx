import React, { useState, useEffect } from 'react';
import {
  History,
  BookmarkCheck,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  HardDrive,
  Download,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FolderTree,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { StorageSource, DownloadBatch, DownloadTask } from '../types';
import { formatBytes, formatDate } from '../utils/formatters';

interface DownloadHistoryViewProps {
  source: StorageSource;
  onOpenDateRangeModal: () => void;
  onUpdateCheckpoint: (timestamp: number | null) => Promise<void>;
}

export const DownloadHistoryView: React.FC<DownloadHistoryViewProps> = ({
  source,
  onOpenDateRangeModal,
  onUpdateCheckpoint,
}) => {
  const [viewMode, setViewMode] = useState<'batches' | 'tasks'>('batches');
  const [batches, setBatches] = useState<DownloadBatch[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<Record<string, DownloadTask[]>>({});

  // Flat tasks history
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  // Fetch batches
  const fetchBatches = async () => {
    try {
      const res = await fetch(`/api/history/batches?sourceId=${source.id}`);
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
      }
    } catch {}
  };

  // Fetch flat tasks
  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sourceId: source.id,
        search: searchQuery,
        status: statusFilter === 'all' ? '' : statusFilter,
        limit: '100',
      });
      const res = await fetch(`/api/history/tasks?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks);
        setTotalTasks(data.total);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
    fetchTasks();
  }, [source]);

  useEffect(() => {
    if (viewMode === 'tasks') {
      fetchTasks();
    }
  }, [searchQuery, statusFilter, viewMode]);

  const toggleExpandBatch = async (batchId: string) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(batchId);
    if (!batchTasks[batchId]) {
      try {
        const res = await fetch(`/api/history/batches/${batchId}`);
        if (res.ok) {
          const data = await res.json();
          setBatchTasks((prev) => ({ ...prev, [batchId]: data.tasks }));
        }
      } catch {}
    }
  };

  return (
    <div className="space-y-6">
      {/* Checkpoint & Date Range Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
              <BookmarkCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Download Date Checkpoint</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  AUTO-TRACKING
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-slate-400">Current Checkpoint:</span>
                <span className="font-mono text-xs font-bold text-cyan-300 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                  {source.lastCheckpointMtime
                    ? formatDate(source.lastCheckpointMtime)
                    : 'No checkpoint set yet'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                When you initiate a date-range download, only new or modified assets after this checkpoint will be fetched next time.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onUpdateCheckpoint(Date.now())}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Update Checkpoint to Now</span>
            </button>

            {source.lastCheckpointMtime && (
              <button
                onClick={() => onUpdateCheckpoint(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/30 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}

            <button
              onClick={onOpenDateRangeModal}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all"
            >
              <Calendar className="w-4 h-4" />
              <span>Download by Date Range</span>
            </button>
          </div>
        </div>
      </div>

      {/* View Mode & Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('batches')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'batches'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            Download Sessions ({batches.length})
          </button>
          <button
            onClick={() => setViewMode('tasks')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'tasks'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Downloaded Files ({totalTasks})
          </button>
        </div>

        {viewMode === 'tasks' && (
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search file path..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="downloading">In Progress</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        )}
      </div>

      {/* =========================================================================
          BATCH SESSIONS VIEW
          ========================================================================= */}
      {viewMode === 'batches' && (
        <div className="space-y-3">
          {batches.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
              <History className="w-10 h-10 mx-auto mb-3 text-slate-600" />
              <p className="text-sm">No download sessions recorded yet.</p>
              <p className="text-xs text-slate-600 mt-1">
                Start a date-range download or missing files sync to begin tracking.
              </p>
            </div>
          ) : (
            batches.map((batch) => {
              const isExpanded = expandedBatchId === batch.id;
              const childTasks = batchTasks[batch.id] || [];

              return (
                <div
                  key={batch.id}
                  className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-lg transition-all"
                >
                  <div
                    onClick={() => toggleExpandBatch(batch.id)}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/40 transition-colors select-none"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-slate-800 border border-slate-700/80 text-cyan-400">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">
                            {batch.type === 'date_range' && '📅 Date Range Download'}
                            {batch.type === 'sync_all' && '⚡ Sync All Missing'}
                            {batch.type === 'manual_batch' && '📦 Manual Batch'}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              batch.status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : batch.status === 'downloading'
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 animate-pulse'
                                : batch.status === 'partial'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}
                          >
                            {batch.status.toUpperCase()}
                          </span>
                          {batch.checkpointApplied && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                              <BookmarkCheck className="w-3 h-3" /> Checkpoint Saved
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                          <span>
                            {batch.filesCount} files ({formatBytes(batch.totalSize)})
                          </span>
                          <span>•</span>
                          <span>Started: {formatDate(batch.createdAt)}</span>
                          {batch.startDate && batch.endDate && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[11px] text-slate-300">
                                Range: {formatDate(batch.startDate)} → {formatDate(batch.endDate)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right text-xs">
                      <div className="font-mono font-bold text-slate-200">
                        {formatBytes(batch.bytesDownloaded)} / {formatBytes(batch.totalSize)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {batch.completedAt
                          ? `Finished in ${Math.round((batch.completedAt - batch.createdAt) / 1000)}s`
                          : 'In progress...'}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Batch Files Table */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-slate-950/60 p-4 animate-in fade-in">
                      <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <FolderTree className="w-4 h-4 text-cyan-400" />
                        <span>Preserved Directory Mapping &amp; Files in this Session</span>
                      </div>

                      {childTasks.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-500">
                          Loading session items...
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                                <th className="py-2 px-3">File Key</th>
                                <th className="py-2 px-3">Size</th>
                                <th className="py-2 px-3">Local Destination Path</th>
                                <th className="py-2 px-3">Status</th>
                                <th className="py-2 px-3 text-right">Completed</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40">
                              {childTasks.map((t) => (
                                <tr key={t.id} className="hover:bg-slate-900/60 transition-colors">
                                  <td className="py-2 px-3 font-mono text-slate-200 truncate max-w-xs" title={t.fileKey}>
                                    {t.fileKey}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-300">
                                    {formatBytes(t.size)}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-400 text-[11px] truncate max-w-sm" title={t.destinationPath}>
                                    {t.destinationPath}
                                  </td>
                                  <td className="py-2 px-3">
                                    {t.status === 'completed' && (
                                      <span className="text-emerald-400 font-medium flex items-center gap-1 text-[11px]">
                                        <CheckCircle2 className="w-3 h-3" /> Completed
                                      </span>
                                    )}
                                    {t.status === 'failed' && (
                                      <span className="text-rose-400 font-medium flex items-center gap-1 text-[11px]">
                                        <AlertCircle className="w-3 h-3" /> Failed
                                      </span>
                                    )}
                                    {t.status === 'downloading' && (
                                      <span className="text-cyan-400 font-medium text-[11px]">
                                        Downloading...
                                      </span>
                                    )}
                                    {t.status === 'queued' && (
                                      <span className="text-slate-400 font-medium text-[11px]">
                                        Queued
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right text-slate-400 text-[11px]">
                                    {t.completedAt ? formatDate(t.completedAt) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* =========================================================================
          ALL DOWNLOADED FILES FLAT LOG VIEW
          ========================================================================= */}
      {viewMode === 'tasks' && (
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">File Key</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Local Preserved Folder Destination</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Date Downloaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">
                      No matching download task logs found.
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-slate-200 truncate max-w-sm" title={task.fileKey}>
                        {task.fileKey}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-200 font-semibold whitespace-nowrap">
                        {formatBytes(task.size)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px] truncate max-w-md" title={task.destinationPath}>
                        {task.destinationPath}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {task.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                          </span>
                        )}
                        {task.status === 'downloading' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 animate-pulse">
                            <Clock className="w-3 h-3" /> In Progress
                          </span>
                        )}
                        {task.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                            <AlertCircle className="w-3 h-3" /> Failed
                          </span>
                        )}
                        {task.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                            Cancelled
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400 text-[11px] whitespace-nowrap">
                        {task.completedAt ? formatDate(task.completedAt) : formatDate(task.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
