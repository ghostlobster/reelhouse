import React from 'react';
import {
  HardDrive,
  Download,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Folder,
  ShieldCheck,
  Server,
  Zap,
} from 'lucide-react';
import { StorageSource, ScanMetrics, StorageFile } from '../types';
import { formatBytes } from '../utils/formatters';

interface OnPremSyncManagerProps {
  source: StorageSource;
  metrics: ScanMetrics | null;
  onDownloadMissing: () => void;
  onTriggerScan: () => void;
  onPreviewFile: (file: StorageFile) => void;
}

export const OnPremSyncManager: React.FC<OnPremSyncManagerProps> = ({
  source,
  metrics,
  onDownloadMissing,
  onTriggerScan,
  onPreviewFile,
}) => {
  if (!metrics) {
    return (
      <div className="p-12 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
        <HardDrive className="w-10 h-10 mx-auto mb-3 text-slate-600 animate-pulse" />
        <p className="text-sm">Scan this source to see on-premise synchronization metrics.</p>
      </div>
    );
  }

  const sync = metrics.onPremSync;
  const freeSpace = sync.localDiskFreeSpace;

  return (
    <div className="space-y-6">
      {/* On-Prem Storage Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/30 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">On-Premise Box Mirroring Target</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  READY
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-cyan-300 break-all bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800/80 inline-block">
                {source.localPath || 'No local target configured'}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                All downloaded assets are mapped directly into this directory hierarchy on the local server.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onTriggerScan}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              <span>Verify Local Files</span>
            </button>

            <button
              onClick={onDownloadMissing}
              disabled={sync.missingLocalCount === 0}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Download All Missing ({sync.missingLocalCount} files)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sync Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1 flex items-center justify-between">
            <span>Sync Progress</span>
            <span className="text-emerald-400 font-bold">{sync.syncPercentage}%</span>
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {sync.syncedFilesCount} / {sync.totalRemoteFiles}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
            <div
              className="bg-emerald-500 h-1.5 rounded-full"
              style={{ width: `${Math.min(100, sync.syncPercentage)}%` }}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Downloaded Volume</div>
          <div className="text-2xl font-mono font-bold text-white">
            {formatBytes(sync.syncedSize)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Local copy on on-premise drive
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Pending Download</div>
          <div className="text-2xl font-mono font-bold text-amber-400">
            {formatBytes(sync.missingLocalSize)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {sync.missingLocalCount} remote files remaining
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">Local Disk Free Space</div>
          <div className="text-2xl font-mono font-bold text-cyan-300">
            {freeSpace !== undefined ? formatBytes(freeSpace) : 'Available'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Drive hosting {source.localPath}
          </div>
        </div>
      </div>

      {/* Safety & Protocol Guarantees */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Read-Only Remote Safety: Active</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Atomic Multi-part Disk Writes</span>
          </div>
        </div>
        <div>
          <span>Local directory is kept in exact mirror structure</span>
        </div>
      </div>
    </div>
  );
};
