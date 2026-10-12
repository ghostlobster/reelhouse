import React from 'react';
import {
  Cloud,
  HardDrive,
  RefreshCw,
  Plus,
  Download,
  Activity,
  BarChart3,
  FolderTree,
  Sliders,
  Sparkles,
  Calendar,
  History,
} from 'lucide-react';
import { StorageSource, DownloadTask } from '../types';
import { getProviderBadge, formatBytes } from '../utils/formatters';

interface HeaderProps {
  sources: StorageSource[];
  activeSource: StorageSource | null;
  onSelectSource: (source: StorageSource) => void;
  onOpenAddModal: () => void;
  onOpenDownloadsDrawer: () => void;
  onOpenDateRangeModal: () => void;
  onTriggerScan: () => void;
  onDownloadMissing: () => void;
  onSeedDemo: () => void;
  isScanning: boolean;
  scanProgress?: { scannedFiles: number; totalVideoDuration: number; currentKey?: string };
  activeTab: 'metrics' | 'files' | 'sync' | 'history' | 'settings';
  setActiveTab: (tab: 'metrics' | 'files' | 'sync' | 'history' | 'settings') => void;
  activeDownloads: DownloadTask[];
}

export const Header: React.FC<HeaderProps> = ({
  sources,
  activeSource,
  onSelectSource,
  onOpenAddModal,
  onOpenDownloadsDrawer,
  onOpenDateRangeModal,
  onTriggerScan,
  onDownloadMissing,
  onSeedDemo,
  isScanning,
  scanProgress,
  activeTab,
  setActiveTab,
  activeDownloads,
}) => {
  const badge = activeSource ? getProviderBadge(activeSource.provider) : null;
  const downloadingCount = activeDownloads.filter(
    (d) => d.status === 'downloading' || d.status === 'queued'
  ).length;

  return (
    <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between min-h-[4.25rem] py-2.5 gap-4">
          {/* Logo & Source Switcher */}
          <div className="flex items-center gap-4 lg:gap-6 min-w-0">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/30 shrink-0">
                <Cloud className="w-5 h-5 text-white" />
              </div>
              <div className="shrink-0 flex flex-col justify-center">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent inline-block leading-tight">
                    Reelhouse
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 whitespace-nowrap">
                    HYBRID
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-1 font-medium whitespace-nowrap leading-none mt-1">
                  <HardDrive className="w-3 h-3 text-slate-500 shrink-0" /> CDN &amp; On-Premise Asset Hub
                </div>
              </div>
            </div>

            {/* Source Dropdown */}
            <div className="hidden md:flex items-center gap-2 pl-4 border-l border-slate-800 min-w-0">
              <span className="text-xs text-slate-400 font-medium whitespace-nowrap shrink-0">Active Source:</span>
              <div className="relative min-w-0">
                <select
                  value={activeSource?.id || ''}
                  onChange={(e) => {
                    const found = sources.find((s) => s.id === e.target.value);
                    if (found) onSelectSource(found);
                  }}
                  className="bg-slate-800/90 hover:bg-slate-800 text-slate-100 text-xs sm:text-sm font-medium rounded-xl px-3 py-1.5 border border-slate-700/80 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 outline-none pr-8 cursor-pointer transition-colors max-w-[200px] lg:max-w-[320px] truncate"
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.provider.toUpperCase()} • {s.totalFiles} files)
                    </option>
                  ))}
                </select>
              </div>

              {badge && (
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full border font-medium whitespace-nowrap shrink-0 ${badge.bg} ${badge.text}`}
                >
                  {badge.label}
                </span>
              )}

              <button
                onClick={onOpenAddModal}
                title="Add New Storage Source"
                className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 lg:gap-3 shrink-0">
            {sources.length === 0 && (
              <button
                onClick={onSeedDemo}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-all shadow-sm whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Load Demo CDN Library</span>
              </button>
            )}

            {/* Scan Action */}
            <button
              onClick={onTriggerScan}
              disabled={isScanning || !activeSource}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all border whitespace-nowrap shrink-0 ${
                isScanning
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700/80 hover:border-slate-600'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-amber-400' : 'text-slate-400'}`} />
              {isScanning ? (
                <span>Scanning {scanProgress?.scannedFiles ? `(${scanProgress.scannedFiles})` : '...'}</span>
              ) : (
                <span>Scan Source</span>
              )}
            </button>

            {/* Download by Date Range Action */}
            <button
              onClick={onOpenDateRangeModal}
              disabled={!activeSource}
              title="Download files filtered by date range or since last checkpoint"
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-all shadow-sm whitespace-nowrap shrink-0"
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span>Date Range Download</span>
            </button>

            {/* Download Missing Action */}
            <button
              onClick={onDownloadMissing}
              disabled={!activeSource}
              title="Download all missing files to local on-premise storage"
              className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-500/30 transition-all shadow-sm whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Sync Missing to Box</span>
            </button>

            {/* Downloads Drawer Button */}
            <button
              onClick={onOpenDownloadsDrawer}
              className="relative p-2 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-xl border border-slate-700/80 transition-colors shrink-0"
              title="View Downloads & Transfer Queue"
            >
              <Activity className="w-4 h-4 text-cyan-400" />
              {downloadingCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-4.5 px-1 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black flex items-center justify-center animate-bounce shadow-md">
                  {downloadingCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 -mb-px pt-1 overflow-x-auto border-t border-slate-800/40">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'metrics'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Metrics &amp; Video Play Time</span>
          </button>

          <button
            onClick={() => setActiveTab('files')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'files'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <FolderTree className="w-4 h-4" />
            <span>File Browser &amp; Previews</span>
            {activeSource && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {activeSource.totalFiles}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('sync')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'sync'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>On-Premise Sync Status</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Action History &amp; Checkpoints</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'settings'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Source Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
};
