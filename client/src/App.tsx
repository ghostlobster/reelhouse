import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { MetricsDashboard } from './components/MetricsDashboard';
import { FileBrowser } from './components/FileBrowser';
import { FilePreviewModal } from './components/FilePreviewModal';
import { SourceConfigModal } from './components/SourceConfigModal';
import { DownloadsDrawer } from './components/DownloadsDrawer';
import { OnPremSyncManager } from './components/OnPremSyncManager';
import { SourceSettings } from './components/SourceSettings';
import { DateRangeDownloadModal } from './components/DateRangeDownloadModal';
import { DownloadHistoryView } from './components/DownloadHistoryView';
import { DownloadLocationModal } from './components/DownloadLocationModal';
import { StorageSource, StorageFile, ScanMetrics, DownloadTask } from './types';
import { Sparkles, PlusCircle } from 'lucide-react';

interface DownloadAction {
  actionTitle: string;
  itemDetails?: string;
  fileCount?: number;
  totalSize?: number;
  execute: (destinationDir: string) => Promise<void>;
}

interface PendingDownload extends DownloadAction {
  /** Resolves the promise returned by ensureDownloadLocation; only the first call counts */
  settle: (started: boolean) => void;
}

export const App: React.FC = () => {
  const [sources, setSources] = useState<StorageSource[]>([]);
  const [activeSource, setActiveSource] = useState<StorageSource | null>(null);
  const [activeTab, setActiveTab] = useState<'metrics' | 'files' | 'sync' | 'history' | 'settings'>('metrics');

  // Metrics
  const [metrics, setMetrics] = useState<ScanMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Files
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('key');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Browse Datetime Filter
  const [browseStartDate, setBrowseStartDate] = useState<Date | null>(null);
  const [browseEndDate, setBrowseEndDate] = useState<Date | null>(null);

  // Active Downloads & Scans
  const [activeDownloads, setActiveDownloads] = useState<DownloadTask[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    scannedFiles: number;
    totalVideoDuration: number;
    currentKey?: string;
  }>();

  // Modals
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);
  const [isDownloadsDrawerOpen, setIsDownloadsDrawerOpen] = useState(false);
  const [isDateRangeModalOpen, setIsDateRangeModalOpen] = useState(false);

  // Local Download Location Confirmation Modal (open while a download awaits a location)
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);

  // Load Sources
  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data: StorageSource[] = await res.json();
      setSources(data);
      if (data.length > 0) {
        if (!activeSource || !data.some((s) => s.id === activeSource.id)) {
          setActiveSource(data[0]);
        } else {
          const current = data.find((s) => s.id === activeSource.id);
          if (current) setActiveSource(current);
        }
      } else {
        setActiveSource(null);
      }
    } catch (err) {
      console.error('Failed to fetch sources:', err);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  // Fetch Metrics for active source
  const fetchMetrics = async (sourceId: string) => {
    setLoadingMetrics(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/metrics`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      } else {
        setMetrics(null);
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
      setMetrics(null);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Fetch Files for active source
  const fetchFiles = async (sourceId: string) => {
    try {
      const params = new URLSearchParams({
        category: categoryFilter,
        search: searchQuery,
        sortBy,
        sortOrder,
        limit: pageSize.toString(),
        offset: ((currentPage - 1) * pageSize).toString(),
      });
      if (browseStartDate) params.append('startDate', browseStartDate.getTime().toString());
      if (browseEndDate) params.append('endDate', browseEndDate.getTime().toString());

      const res = await fetch(`/api/sources/${sourceId}/files?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
        setTotalFiles(data.total);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  };

  // Fetch Downloads
  const fetchDownloads = async () => {
    try {
      const res = await fetch('/api/downloads');
      if (res.ok) {
        const data = await res.json();
        setActiveDownloads(data);
      }
    } catch {}
  };

  useEffect(() => {
    if (activeSource) {
      fetchMetrics(activeSource.id);
      fetchFiles(activeSource.id);
    } else {
      setMetrics(null);
      setFiles([]);
      setTotalFiles(0);
    }
  }, [activeSource]);

  useEffect(() => {
    if (activeSource) {
      fetchFiles(activeSource.id);
    }
  }, [categoryFilter, searchQuery, sortBy, sortOrder, currentPage, browseStartDate, browseEndDate]);

  useEffect(() => {
    fetchDownloads();
  }, []);

  // WebSocket for Real-time Scanner & Download events
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'scan:progress') {
            const data = payload.data;
            if (data.status === 'scanning') {
              setIsScanning(true);
              setScanProgress({
                scannedFiles: data.scannedFiles,
                totalVideoDuration: data.totalVideoDuration,
                currentKey: data.currentKey,
              });
            } else if (data.status === 'completed' || data.status === 'failed') {
              setIsScanning(false);
              fetchSources();
              if (activeSource && activeSource.id === data.sourceId) {
                fetchMetrics(data.sourceId);
                fetchFiles(data.sourceId);
              }
            }
          } else if (payload.type === 'download:progress') {
            const d = payload.data;
            setActiveDownloads((prev) => {
              const idx = prev.findIndex((t) => t.id === d.taskId);
              if (idx !== -1) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  bytesDownloaded: d.bytesDownloaded,
                  speedBps: d.speedBps,
                  status: d.status,
                };
                return updated;
              } else {
                return [d, ...prev];
              }
            });

            if (d.status === 'completed') {
              if (activeSource && activeSource.id === d.sourceId) {
                fetchMetrics(d.sourceId);
                fetchFiles(d.sourceId);
              }
            }
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, [activeSource]);

  // Actions
  const handleTriggerScan = async () => {
    if (!activeSource) return;
    setIsScanning(true);
    try {
      await fetch(`/api/sources/${activeSource.id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deepMediaScan: true }),
      });
    } catch (err) {
      console.error('Scan trigger error:', err);
      setIsScanning(false);
    }
  };

  /**
   * Run a download action in the source's default folder, or ask for a folder first.
   * Resolves true once the download is enqueued, or false if the location prompt is dismissed;
   * rejects only when enqueueing into the default folder fails.
   */
  const ensureDownloadLocation = async (action: DownloadAction): Promise<boolean> => {
    if (!activeSource) return false;
    const localPath = activeSource.localPath?.trim();
    if (localPath) {
      await action.execute(localPath);
      return true;
    }

    return new Promise((resolve) => setPendingDownload({ ...action, settle: resolve }));
  };

  // Errors propagate to the location modal, which keeps the pending action so the user can retry
  const handleConfirmLocation = async (destinationDir: string, saveAsDefault: boolean) => {
    if (!pendingDownload) return;
    if (saveAsDefault) {
      await handleUpdateSource({ localPath: destinationDir });
    }
    await pendingDownload.execute(destinationDir);
    pendingDownload.settle(true);
  };

  const handleCloseLocationModal = () => {
    pendingDownload?.settle(false);
    setPendingDownload(null);
  };

  const reportDownloadError = (err: any) => alert('Download error: ' + (err?.message || err));

  /**
   * POST a download request, then surface the queue (or explain why nothing was queued).
   */
  const postDownload = async (url: string, body: object, failureMessage: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || failureMessage);
    }

    const queued: number = data.task ? 1 : data.tasks?.length ?? data.tasksCount ?? 0;
    if (queued === 0) {
      alert('Nothing to download: all matching files are already synced locally.');
    } else {
      setIsDownloadsDrawerOpen(true);
    }
    fetchDownloads();
    return data;
  };

  const handleDownloadFile = (file: StorageFile) => {
    if (!activeSource) return;
    ensureDownloadLocation({
      actionTitle: 'Download Single File',
      itemDetails: file.key,
      fileCount: 1,
      totalSize: file.size,
      execute: async (destinationDir) => {
        await postDownload(
          '/api/downloads',
          { sourceId: activeSource.id, key: file.key, destinationDir },
          'Failed to enqueue file download'
        );
      },
    }).catch(reportDownloadError);
  };

  const handleBatchDownload = (batchFiles: StorageFile[]) => {
    if (!activeSource || batchFiles.length === 0) return;
    const totalSize = batchFiles.reduce((acc, f) => acc + f.size, 0);
    ensureDownloadLocation({
      actionTitle: `Batch Download (${batchFiles.length} files)`,
      itemDetails: `${batchFiles.length} file(s) selected`,
      fileCount: batchFiles.length,
      totalSize,
      execute: async (destinationDir) => {
        await postDownload(
          '/api/downloads',
          { sourceId: activeSource.id, keys: batchFiles.map((f) => f.key), destinationDir },
          'Failed to enqueue batch download'
        );
      },
    }).catch(reportDownloadError);
  };

  const handleDownloadMissing = () => {
    if (!activeSource) return;
    const missingCount = metrics?.onPremSync?.missingLocalCount;
    const missingSize = metrics?.onPremSync?.missingLocalSize;
    ensureDownloadLocation({
      actionTitle: 'Sync Missing Files to Local Box',
      itemDetails: missingCount !== undefined ? `Syncing ${missingCount} missing file(s)` : 'Syncing missing files',
      fileCount: missingCount,
      totalSize: missingSize,
      execute: async (destinationDir) => {
        await postDownload(
          '/api/downloads/missing',
          { sourceId: activeSource.id, destinationDir },
          'Failed to sync missing files'
        );
      },
    }).catch(reportDownloadError);
  };

  // Awaited by HierarchyExplorer, which shows its own spinner and error alert
  const handleDownloadFolder = async (folderPrefix: string) => {
    if (!activeSource) return;
    await ensureDownloadLocation({
      actionTitle: `Download Folder: "${folderPrefix || 'Root'}"`,
      itemDetails: `Folder prefix: ${folderPrefix}`,
      execute: async (destinationDir) => {
        await postDownload(
          `/api/sources/${activeSource.id}/download-folder`,
          { folderPrefix, onlyMissing: true, destinationDir },
          'Failed to download folder'
        );
      },
    });
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await fetch(`/api/downloads/${taskId}/cancel`, { method: 'POST' });
      fetchDownloads();
    } catch {}
  };

  const handleSeedDemo = async () => {
    try {
      const res = await fetch('/api/demo/seed', { method: 'POST' });
      const data = await res.json();
      if (data.source) {
        await fetchSources();
        setActiveSource(data.source);
        fetchMetrics(data.source.id);
        fetchFiles(data.source.id);
      }
    } catch (err) {
      alert('Seed error: ' + err);
    }
  };

  const handleSaveSource = async (sourceData: Partial<StorageSource>) => {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sourceData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create source');
    }
    const created = await res.json();
    await fetchSources();
    setActiveSource(created);
  };

  const handleUpdateSource = async (updatedData: Partial<StorageSource>) => {
    if (!activeSource) return;
    const res = await fetch(`/api/sources/${activeSource.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update source');
    }
    const updated = await res.json();
    await fetchSources();
    setActiveSource(updated);
  };

  const handleDeleteSource = async (sourceId: string) => {
    await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
    await fetchSources();
  };

  const handleStartRangeDownload = async (params: {
    startDate?: number;
    endDate?: number;
    onlyMissing: boolean;
    updateCheckpoint: boolean;
  }): Promise<boolean> => {
    if (!activeSource) return false;
    // Awaited by DateRangeDownloadModal, which reports errors and closes itself once started
    return ensureDownloadLocation({
      actionTitle: 'Date Range Download',
      itemDetails: 'Selected date range download batch',
      execute: async (destinationDir) => {
        await postDownload(
          `/api/sources/${activeSource.id}/download-range`,
          { ...params, destinationDir },
          'Failed to start range download'
        );
        await fetchSources();
      },
    });
  };

  const handleUpdateCheckpoint = async (timestamp: number | null) => {
    if (!activeSource) return;
    const res = await fetch(`/api/sources/${activeSource.id}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp }),
    });
    if (res.ok) {
      await fetchSources();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <Header
        sources={sources}
        activeSource={activeSource}
        onSelectSource={setActiveSource}
        onOpenAddModal={() => setIsAddSourceModalOpen(true)}
        onOpenDownloadsDrawer={() => setIsDownloadsDrawerOpen(true)}
        onOpenDateRangeModal={() => setIsDateRangeModalOpen(true)}
        onTriggerScan={handleTriggerScan}
        onDownloadMissing={handleDownloadMissing}
        onSeedDemo={handleSeedDemo}
        isScanning={isScanning}
        scanProgress={scanProgress}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeDownloads={activeDownloads}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {sources.length === 0 ? (
          /* Empty State */
          <div className="py-20 text-center max-w-md mx-auto space-y-6">
            <div className="w-16 h-16 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 mx-auto flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-500/10">
              <PlusCircle className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white">No Storage Sources Configured</h2>
              <p className="text-xs text-slate-400 mt-2">
                Connect your AWS S3, Cloudflare R2, MinIO self-hosted, or KeyCDN bucket to inspect
                metrics, video play times, and mirror files to your on-premise box.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setIsAddSourceModalOpen(true)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/25 transition-all"
              >
                Add Your First Source
              </button>
              <button
                onClick={handleSeedDemo}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 font-semibold text-xs flex items-center justify-center gap-2 transition-all"
              >
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Load Demo CDN Library</span>
              </button>
            </div>
          </div>
        ) : !activeSource ? (
          <div className="py-12 text-center text-slate-500">Select a source above</div>
        ) : (
          <div>
            {/* TAB: METRICS */}
            {activeTab === 'metrics' && (
              <div>
                {metrics ? (
                  <MetricsDashboard
                    metrics={metrics}
                    onPreviewFile={setPreviewFile}
                    onDownloadFile={handleDownloadFile}
                  />
                ) : (
                  <div className="py-16 text-center space-y-4 bg-slate-900/40 rounded-2xl border border-slate-800">
                    <div className="text-sm text-slate-400">
                      No metrics found for this source yet.
                    </div>
                    <button
                      onClick={handleTriggerScan}
                      className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-md transition-all"
                    >
                      Run Initial Scan
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: FILE BROWSER */}
            {activeTab === 'files' && (
              <FileBrowser
                source={activeSource}
                files={files}
                totalFiles={totalFiles}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                startDate={browseStartDate}
                setStartDate={setBrowseStartDate}
                endDate={browseEndDate}
                setEndDate={setBrowseEndDate}
                sortBy={sortBy}
                setSortBy={setSortBy}
                sortOrder={sortOrder}
                setSortOrder={setSortOrder}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                pageSize={pageSize}
                onPreviewFile={setPreviewFile}
                onDownloadFile={handleDownloadFile}
                onBatchDownload={handleBatchDownload}
                onDownloadFolder={handleDownloadFolder}
              />
            )}

            {/* TAB: ON-PREM SYNC */}
            {activeTab === 'sync' && (
              <OnPremSyncManager
                source={activeSource}
                metrics={metrics}
                onDownloadMissing={handleDownloadMissing}
                onTriggerScan={handleTriggerScan}
                onPreviewFile={setPreviewFile}
              />
            )}

            {/* TAB: HISTORY */}
            {activeTab === 'history' && (
              <DownloadHistoryView
                source={activeSource}
                onOpenDateRangeModal={() => setIsDateRangeModalOpen(true)}
                onUpdateCheckpoint={handleUpdateCheckpoint}
              />
            )}

            {/* TAB: SETTINGS */}
            {activeTab === 'settings' && (
              <SourceSettings
                source={activeSource}
                onUpdateSource={handleUpdateSource}
                onDeleteSource={handleDeleteSource}
              />
            )}
          </div>
        )}
      </main>

      {/* File Preview Modal */}
      {previewFile && activeSource && (
        <FilePreviewModal
          file={previewFile}
          source={activeSource}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownloadFile}
        />
      )}

      {/* Date Range Download Modal */}
      {isDateRangeModalOpen && activeSource && (
        <DateRangeDownloadModal
          isOpen={isDateRangeModalOpen}
          source={activeSource}
          onClose={() => setIsDateRangeModalOpen(false)}
          onStartDownload={handleStartRangeDownload}
        />
      )}

      {/* Local Download Location Confirmation Modal */}
      {pendingDownload && activeSource && (
        <DownloadLocationModal
          isOpen
          source={activeSource}
          actionTitle={pendingDownload.actionTitle}
          itemDetails={pendingDownload.itemDetails}
          fileCount={pendingDownload.fileCount}
          totalSize={pendingDownload.totalSize}
          onConfirm={handleConfirmLocation}
          onClose={handleCloseLocationModal}
        />
      )}

      {/* Source Configuration Modal */}
      <SourceConfigModal
        isOpen={isAddSourceModalOpen}
        onClose={() => setIsAddSourceModalOpen(false)}
        onSave={handleSaveSource}
      />

      {/* Active Downloads Drawer */}
      <DownloadsDrawer
        isOpen={isDownloadsDrawerOpen}
        onClose={() => setIsDownloadsDrawerOpen(false)}
        tasks={activeDownloads}
        onCancelTask={handleCancelTask}
      />
    </div>
  );
};
export default App;
