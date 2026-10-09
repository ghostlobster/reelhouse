import React, { useState, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  CornerLeftUp,
  Download,
  Eye,
  Copy,
  Check,
  Search,
  Filter,
  Film,
  Image as ImageIcon,
  Music,
  FileText,
  Archive,
  Code,
  File,
  CheckCircle,
  AlertCircle,
  HardDrive,
  Clock,
  ArrowUpDown,
  RefreshCw,
  FolderTree,
  ChevronDown,
} from 'lucide-react';
import {
  StorageSource,
  StorageFile,
  FileCategory,
  HierarchyFolder,
  HierarchyBreadcrumb,
  HierarchyResponse,
} from '../types';
import { formatBytes, formatDuration, formatDate } from '../utils/formatters';

interface HierarchyExplorerProps {
  source: StorageSource;
  onPreviewFile: (file: StorageFile) => void;
  onDownloadFile: (file: StorageFile) => void;
  onBatchDownload: (files: StorageFile[]) => void;
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  startDate?: Date | null;
  endDate?: Date | null;
}

const CATEGORY_ICONS: Record<FileCategory, React.ReactNode> = {
  video: <Film className="w-4 h-4 text-violet-400" />,
  image: <ImageIcon className="w-4 h-4 text-cyan-400" />,
  audio: <Music className="w-4 h-4 text-pink-400" />,
  document: <FileText className="w-4 h-4 text-amber-400" />,
  archive: <Archive className="w-4 h-4 text-emerald-400" />,
  code: <Code className="w-4 h-4 text-blue-400" />,
  other: <File className="w-4 h-4 text-slate-400" />,
};

export const HierarchyExplorer: React.FC<HierarchyExplorerProps> = ({
  source,
  onPreviewFile,
  onDownloadFile,
  onBatchDownload,
  categoryFilter,
  setCategoryFilter,
  searchQuery,
  setSearchQuery,
  startDate,
  endDate,
}) => {
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [hierarchyData, setHierarchyData] = useState<HierarchyResponse | null>(null);

  // Sorting
  const [sortBy, setSortBy] = useState<string>('key');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');

  // File selection within the current directory
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Folder download state
  const [folderDownloading, setFolderDownloading] = useState<string | null>(null);

  // Tree sidebar expanded branches
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [showTreeSidebar, setShowTreeSidebar] = useState<boolean>(true);
  const [rootFolders, setRootFolders] = useState<HierarchyFolder[]>([]);

  // Fetch root folders for tree sidebar (updated on date change)
  useEffect(() => {
    if (!source) return;
    const rootParams = new URLSearchParams({ prefix: '' });
    if (startDate) rootParams.append('startDate', startDate.getTime().toString());
    if (endDate) rootParams.append('endDate', endDate.getTime().toString());

    fetch(`/api/sources/${source.id}/hierarchy?${rootParams.toString()}`)
      .then((r) => r.json())
      .then((data: HierarchyResponse) => {
        if (data && data.folders) {
          setRootFolders(data.folders);
        }
      })
      .catch((err) => console.error('Failed to load root folders for tree:', err));
  }, [source, startDate, endDate]);

  // Fetch current folder hierarchy on prefix change, category filter, search, or date range
  const loadHierarchy = async (prefixToLoad: string) => {
    if (!source) return;
    setLoading(true);
    setSelectedFileKeys(new Set());

    try {
      const params = new URLSearchParams({
        prefix: prefixToLoad,
        category: categoryFilter,
        search: searchQuery,
        sortBy,
        sortOrder,
      });

      if (startDate) params.append('startDate', startDate.getTime().toString());
      if (endDate) params.append('endDate', endDate.getTime().toString());

      const res = await fetch(`/api/sources/${source.id}/hierarchy?${params.toString()}`);
      if (res.ok) {
        const data: HierarchyResponse = await res.json();
        setHierarchyData(data);
        setCurrentPrefix(data.currentPrefix);

        // Also ensure current path's parent folders are marked expanded in the tree
        if (data.currentPrefix) {
          const parts = data.currentPrefix.replace(/\/$/, '').split('/');
          const nextExpanded = new Set(treeExpanded);
          let acc = '';
          for (const part of parts) {
            acc += part + '/';
            nextExpanded.add(acc);
          }
          setTreeExpanded(nextExpanded);
        }
      }
    } catch (err) {
      console.error('Failed to load hierarchy:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHierarchy(currentPrefix);
  }, [source, currentPrefix, categoryFilter, searchQuery, sortBy, sortOrder, startDate, endDate]);

  const navigateTo = (prefix: string) => {
    setCurrentPrefix(prefix);
  };

  const navigateUp = () => {
    if (hierarchyData?.parentPrefix !== null && hierarchyData?.parentPrefix !== undefined) {
      setCurrentPrefix(hierarchyData.parentPrefix);
    }
  };

  const handleDownloadFolder = async (folderPrefixToDownload: string) => {
    if (!source) return;
    setFolderDownloading(folderPrefixToDownload);
    try {
      const res = await fetch(`/api/sources/${source.id}/download-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPrefix: folderPrefixToDownload,
          onlyMissing: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to download folder');
      } else {
        alert(
          `Queued ${data.tasksCount} missing file(s) for folder "${folderPrefixToDownload}" to ${source.localPath}`
        );
      }
    } catch (err: any) {
      alert(err.message || 'Download error');
    } finally {
      setFolderDownloading(null);
    }
  };

  const toggleSelectFile = (key: string) => {
    const next = new Set(selectedFileKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedFileKeys(next);
  };

  const toggleSelectAllFiles = () => {
    if (!hierarchyData) return;
    if (selectedFileKeys.size === hierarchyData.files.length) {
      setSelectedFileKeys(new Set());
    } else {
      setSelectedFileKeys(new Set(hierarchyData.files.map((f) => f.key)));
    }
  };

  const handleCopyUrl = (file: StorageFile) => {
    let url = `/api/sources/${source.id}/stream?key=${encodeURIComponent(file.key)}`;
    if (source.cdnUrl) {
      const base = source.cdnUrl.replace(/\/$/, '');
      url = `${base}/${file.key}`;
    }
    navigator.clipboard.writeText(url);
    setCopiedKey(file.key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortOrder('ASC');
    }
  };

  // Extract relative filename from object key under current prefix
  const getRelativeName = (fullKey: string) => {
    if (!currentPrefix) return fullKey;
    if (fullKey.startsWith(currentPrefix)) {
      return fullKey.slice(currentPrefix.length);
    }
    return fullKey;
  };

  const categories: Array<{ id: string; label: string; icon: React.ReactNode }> = [
    { id: 'all', label: 'All Files', icon: <File className="w-3.5 h-3.5" /> },
    { id: 'video', label: 'Videos', icon: <Film className="w-3.5 h-3.5 text-violet-400" /> },
    { id: 'image', label: 'Images', icon: <ImageIcon className="w-3.5 h-3.5 text-cyan-400" /> },
    { id: 'audio', label: 'Audio', icon: <Music className="w-3.5 h-3.5 text-pink-400" /> },
    { id: 'document', label: 'Docs', icon: <FileText className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'archive', label: 'Archives', icon: <Archive className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'code', label: 'Code & Data', icon: <Code className="w-3.5 h-3.5 text-blue-400" /> },
  ];

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* Category Filter Pills and Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                categoryFilter === c.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
              }`}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search in folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-mono"
            />
          </div>

          <button
            onClick={() => setShowTreeSidebar(!showTreeSidebar)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              showTreeSidebar
                ? 'bg-slate-800 text-cyan-300 border-slate-700'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title="Toggle Directory Tree Sidebar"
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tree</span>
          </button>
        </div>
      </div>

      {/* Breadcrumb Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3 rounded-2xl shadow-lg">
        {/* Breadcrumb Path */}
        <div className="flex items-center gap-1 text-xs overflow-x-auto py-1">
          <button
            onClick={() => navigateTo('')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-mono font-medium transition-colors ${
              currentPrefix === ''
                ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
            <span>Root</span>
          </button>

          {hierarchyData?.breadcrumbs
            .filter((b) => b.prefix !== '')
            .map((b, idx, arr) => {
              const isCurrent = idx === arr.length - 1;
              return (
                <React.Fragment key={b.prefix}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <button
                    onClick={() => navigateTo(b.prefix)}
                    className={`px-2.5 py-1.5 rounded-lg font-mono font-medium transition-colors shrink-0 ${
                      isCurrent
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <span>{b.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
        </div>

        {/* Directory Action Buttons */}
        <div className="flex items-center gap-2">
          {currentPrefix !== '' && (
            <button
              onClick={navigateUp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition-colors shadow-sm"
              title="Go up to parent directory"
            >
              <CornerLeftUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Up One Level</span>
            </button>
          )}

          {currentPrefix !== '' && (
            <button
              onClick={() => handleDownloadFolder(currentPrefix)}
              disabled={folderDownloading === currentPrefix}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/20 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {folderDownloading === currentPrefix ? 'Queueing...' : 'Download This Folder'}
              </span>
            </button>
          )}

          <button
            onClick={() => loadHierarchy(currentPrefix)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors border border-transparent hover:border-slate-700"
            title="Refresh folder contents"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Explorer Content Container (Optional Tree Sidebar + Main Content) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Tree Sidebar */}
        {showTreeSidebar && (
          <div className="lg:col-span-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400 px-2 pb-2 border-b border-slate-800 font-bold uppercase tracking-wider text-[10px]">
              <span>Directories</span>
              <span>Items</span>
            </div>

            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              <button
                onClick={() => navigateTo('')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left font-mono transition-colors ${
                  currentPrefix === ''
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">Root /</span>
                </div>
                <span className="text-[10px] text-slate-500">{source.totalFiles}</span>
              </button>

              {rootFolders.map((folder) => {
                const isActive = currentPrefix.startsWith(folder.prefix);
                return (
                  <button
                    key={folder.prefix}
                    onClick={() => navigateTo(folder.prefix)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left font-mono transition-colors ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-sans">
                      {folder.fileCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Explorer Area */}
        <div className={showTreeSidebar ? 'lg:col-span-9 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {/* Subfolders Section */}
          {hierarchyData && hierarchyData.folders.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between">
                <span>Folders in {currentPrefix ? `"${currentPrefix}"` : 'Root'}</span>
                <span>{hierarchyData.folders.length} Subfolder(s)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {hierarchyData.folders.map((folder) => (
                  <div
                    key={folder.prefix}
                    onClick={() => navigateTo(folder.prefix)}
                    className="group relative bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-3.5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 truncate">
                        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 group-hover:scale-110 transition-transform">
                          <Folder className="w-5 h-5" />
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-bold text-slate-200 group-hover:text-cyan-300 truncate font-mono">
                            {folder.name}
                          </h4>
                          <span className="text-[10px] text-slate-500">
                            {folder.fileCount} file(s)
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadFolder(folder.prefix);
                        }}
                        disabled={folderDownloading === folder.prefix}
                        className="p-1.5 text-slate-500 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
                        title={`Download all missing files in "${folder.name}"`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Stats & Duration Pills */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                      <span>{formatBytes(folder.totalSize)}</span>
                      {folder.videoDuration > 0 && (
                        <span className="text-violet-400 font-semibold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20 flex items-center gap-1">
                          <Film className="w-2.5 h-2.5" />
                          {formatDuration(folder.videoDuration)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Batch Actions Bar for Files */}
          {selectedFileKeys.size > 0 && hierarchyData && (
            <div className="flex items-center justify-between bg-cyan-950/40 border border-cyan-500/40 p-3 rounded-xl shadow-lg animate-in fade-in">
              <div className="flex items-center gap-2 text-xs text-cyan-300 font-semibold">
                <span className="w-5 h-5 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center font-bold text-[10px]">
                  {selectedFileKeys.size}
                </span>
                <span>files selected</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const selectedFiles = hierarchyData.files.filter((f) =>
                      selectedFileKeys.has(f.key)
                    );
                    onBatchDownload(selectedFiles);
                    setSelectedFileKeys(new Set());
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Selected to On-Prem Box</span>
                </button>
                <button
                  onClick={() => setSelectedFileKeys(new Set())}
                  className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 font-medium transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Immediate Files Table */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider select-none">
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={Boolean(
                          hierarchyData &&
                          hierarchyData.files.length > 0 &&
                          selectedFileKeys.size === hierarchyData.files.length
                        )}
                        onChange={toggleSelectAllFiles}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                    </th>
                    <th
                      onClick={() => handleSort('key')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>File Name</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('category')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Type</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('size')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Size</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('duration')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Play Time / Dim</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('last_modified')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Modified</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('local_status')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-200"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>On-Prem</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {hierarchyData && hierarchyData.files.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        {hierarchyData.folders.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-slate-400 font-medium">
                              No loose files directly in this folder.
                            </span>
                            <div className="text-[11px] text-slate-500">
                              Click any subfolder above to view nested files.
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <FolderOpen className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                            <div className="text-slate-400 font-medium">This directory is empty</div>
                            <div className="text-[11px] text-slate-600">
                              No files or subfolders found under this path.
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    hierarchyData?.files.map((file) => {
                      const isSelected = selectedFileKeys.has(file.key);
                      const relativeName = getRelativeName(file.key);

                      return (
                        <tr
                          key={file.id}
                          className={`hover:bg-slate-800/40 transition-colors ${
                            isSelected ? 'bg-cyan-950/20' : ''
                          }`}
                        >
                          <td className="py-3 px-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectFile(file.key)}
                              className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                          </td>

                          {/* Name */}
                          <td className="py-3 px-4 font-mono font-medium text-slate-200 max-w-md truncate">
                            <div className="flex items-center gap-2">
                              {CATEGORY_ICONS[file.category]}
                              <div className="truncate">
                                <span
                                  onClick={() => onPreviewFile(file)}
                                  className="hover:text-cyan-400 cursor-pointer hover:underline truncate block"
                                  title={file.key}
                                >
                                  {relativeName}
                                </span>
                                {currentPrefix && (
                                  <span className="text-[10px] text-slate-500 block truncate">
                                    {file.key}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Category & Ext */}
                          <td className="py-3 px-4 uppercase text-[11px] font-mono text-slate-400">
                            {file.extension ? `.${file.extension}` : file.category}
                          </td>

                          {/* Size */}
                          <td className="py-3 px-4 font-mono text-slate-200 font-semibold whitespace-nowrap">
                            {formatBytes(file.size)}
                          </td>

                          {/* Play Time or Dim */}
                          <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                            {file.duration ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-violet-400 font-bold">
                                  {formatDuration(file.duration)}
                                </span>
                                {file.width && file.height && (
                                  <span className="text-[10px] text-slate-500">
                                    ({file.width}p)
                                  </span>
                                )}
                              </div>
                            ) : file.width && file.height ? (
                              <span className="text-slate-400 text-[11px]">
                                {file.width} × {file.height}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>

                          {/* Modified */}
                          <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                            {formatDate(file.lastModified)}
                          </td>

                          {/* On-Prem Sync Status */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {file.localStatus === 'synced' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                <CheckCircle className="w-3 h-3" /> Synced
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                <AlertCircle className="w-3 h-3" /> Missing
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                            {/* Preview */}
                            <button
                              onClick={() => onPreviewFile(file)}
                              title="Preview file"
                              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 inline-flex items-center"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Copy URL */}
                            <button
                              onClick={() => handleCopyUrl(file)}
                              title="Copy direct / CDN URL"
                              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 inline-flex items-center"
                            >
                              {copiedKey === file.key ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Download */}
                            <button
                              onClick={() => onDownloadFile(file)}
                              title={
                                file.localStatus === 'synced'
                                  ? 'Re-download to on-premise box'
                                  : 'Download to on-premise box'
                              }
                              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 inline-flex items-center"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Folder Footer Summary */}
            {hierarchyData && (
              <div className="flex items-center justify-between p-3.5 border-t border-slate-800 bg-slate-950/40 text-xs text-slate-400 font-mono">
                <div>
                  Current directory:{' '}
                  <span className="text-cyan-300 font-bold">
                    {currentPrefix || '/ (Root)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-200 font-semibold">{hierarchyData.folders.length}</span>{' '}
                  folders,{' '}
                  <span className="text-slate-200 font-semibold">{hierarchyData.files.length}</span>{' '}
                  files ({formatBytes(hierarchyData.totalSize)})
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
