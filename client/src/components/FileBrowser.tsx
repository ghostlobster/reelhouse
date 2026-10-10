import React, { useState } from 'react';
import {
  Search,
  Filter,
  Eye,
  Download,
  Copy,
  Check,
  CheckCircle,
  AlertCircle,
  Film,
  Image as ImageIcon,
  Music,
  FileText,
  Archive,
  Code,
  File,
  ArrowUpDown,
  Folder,
  ChevronRight,
  FolderOpen,
  FolderTree,
  List,
  Calendar,
  Clock,
  Zap,
  X,
  RotateCcw,
} from 'lucide-react';
import { StorageFile, FileCategory, StorageSource } from '../types';
import { formatBytes, formatDuration, formatDate } from '../utils/formatters';
import { HierarchyExplorer } from './HierarchyExplorer';
import { DateTimeRangePicker } from './DateTimeRangePicker';

interface FileBrowserProps {
  source: StorageSource;
  files: StorageFile[];
  totalFiles: number;
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  startDate?: Date | null;
  setStartDate?: (date: Date | null) => void;
  endDate?: Date | null;
  setEndDate?: (date: Date | null) => void;
  sortBy: string;
  setSortBy: (sort: string) => void;
  sortOrder: 'ASC' | 'DESC';
  setSortOrder: (order: 'ASC' | 'DESC') => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  onPreviewFile: (file: StorageFile) => void;
  onDownloadFile: (file: StorageFile) => void;
  onBatchDownload: (files: StorageFile[]) => void;
  onDownloadFolder?: (folderPrefix: string) => Promise<void> | void;
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

export const FileBrowser: React.FC<FileBrowserProps> = ({
  source,
  files,
  totalFiles,
  categoryFilter,
  setCategoryFilter,
  searchQuery,
  setSearchQuery,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  currentPage,
  setCurrentPage,
  pageSize,
  onPreviewFile,
  onDownloadFile,
  onBatchDownload,
  onDownloadFolder,
}) => {
  const [viewMode, setViewMode] = useState<'hierarchy' | 'flat'>('hierarchy');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Datetime Range Filter State
  const [activeDatePreset, setActiveDatePreset] = useState<string>('all');
  const [isDatePickerModalOpen, setIsDatePickerModalOpen] = useState<boolean>(false);
  const [tempStart, setTempStart] = useState<Date | null>(startDate || null);
  const [tempEnd, setTempEnd] = useState<Date | null>(endDate || null);

  const applyDatePreset = (preset: string) => {
    setActiveDatePreset(preset);
    const now = new Date();
    if (!setStartDate || !setEndDate) return;

    switch (preset) {
      case 'all':
        setStartDate(null);
        setEndDate(null);
        break;
      case 'checkpoint':
        if (source.lastCheckpointMtime) {
          setStartDate(new Date(source.lastCheckpointMtime));
          setEndDate(now);
        } else {
          setStartDate(new Date(Date.now() - 7 * 86400000));
          setEndDate(now);
        }
        break;
      case '24h':
        setStartDate(new Date(Date.now() - 24 * 3600000));
        setEndDate(now);
        break;
      case '7d':
        setStartDate(new Date(Date.now() - 7 * 86400000));
        setEndDate(now);
        break;
      case '30d':
        setStartDate(new Date(Date.now() - 30 * 86400000));
        setEndDate(now);
        break;
      default:
        break;
    }
  };

  const handleOpenCustomPicker = () => {
    setTempStart(startDate || new Date(Date.now() - 7 * 86400000));
    setTempEnd(endDate || new Date());
    setIsDatePickerModalOpen(true);
  };

  const toggleSelect = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === files.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(files.map((f) => f.key)));
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

  const totalPages = Math.ceil(totalFiles / pageSize) || 1;

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortOrder('ASC');
    }
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

  const isDateFilterActive = Boolean(startDate || endDate);

  return (
    <div className="space-y-4">
      {/* Top View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-2xl border border-slate-800 shadow-sm">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('hierarchy')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === 'hierarchy'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Folder Hierarchy (On-Demand)</span>
          </button>

          <button
            onClick={() => setViewMode('flat')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === 'flat'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>All Files (Flat Table)</span>
          </button>
        </div>

        <div className="text-[11px] text-slate-400 px-2 font-mono flex items-center gap-2">
          {viewMode === 'hierarchy' ? (
            <span>⚡ Loads folders &amp; files on click • Zero lag</span>
          ) : (
            <span>Total files indexed: <strong className="text-slate-200">{totalFiles}</strong></span>
          )}
        </div>
      </div>

      {/* Date & Time Range Filter Toolbar */}
      <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Modified Date Filter:</span>
          </span>

          {/* Quick Presets */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => applyDatePreset('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                activeDatePreset === 'all' && !isDateFilterActive
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              All Time
            </button>

            <button
              onClick={() => applyDatePreset('checkpoint')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1 ${
                activeDatePreset === 'checkpoint'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Zap className="w-3 h-3 text-cyan-400" />
              <span>Since Checkpoint</span>
              {source.lastCheckpointMtime && (
                <span className="text-[10px] text-cyan-400/80 font-mono">
                  ({formatDate(source.lastCheckpointMtime).slice(0, 10)})
                </span>
              )}
            </button>

            <button
              onClick={() => applyDatePreset('24h')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                activeDatePreset === '24h'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Past 24h
            </button>

            <button
              onClick={() => applyDatePreset('7d')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                activeDatePreset === '7d'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Past 7d
            </button>

            <button
              onClick={() => applyDatePreset('30d')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                activeDatePreset === '30d'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Past 30d
            </button>

            <button
              onClick={handleOpenCustomPicker}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                activeDatePreset === 'custom' || (isDateFilterActive && activeDatePreset !== 'checkpoint' && activeDatePreset !== '24h' && activeDatePreset !== '7d' && activeDatePreset !== '30d')
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Calendar className="w-3 h-3 text-cyan-400" />
              <span>Custom Range...</span>
            </button>
          </div>
        </div>

        {/* Active Range Indicator Pill */}
        {isDateFilterActive && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>
                {startDate ? formatDate(startDate.getTime()) : 'Earliest'} →{' '}
                {endDate ? formatDate(endDate.getTime()) : 'Now'}
              </span>
            </span>

            <button
              onClick={() => applyDatePreset('all')}
              className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Reset date filter to All Time"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Custom Date Range Picker Modal */}
      {isDatePickerModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in"
          onClick={() => setIsDatePickerModalOpen(false)}
        >
          <div
            className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Filter Browsing by Datetime Range</h3>
                  <p className="text-[11px] text-slate-400">
                    Only files &amp; folders modified within this time window will be displayed
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDatePickerModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <DateTimeRangePicker
                startDate={tempStart}
                endDate={tempEnd}
                onChange={(s, e) => {
                  setTempStart(s);
                  setTempEnd(e);
                }}
                checkpointTimestamp={source.lastCheckpointMtime}
              />
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/50">
              <button
                type="button"
                onClick={() => {
                  if (setStartDate && setEndDate) {
                    setStartDate(null);
                    setEndDate(null);
                  }
                  setActiveDatePreset('all');
                  setIsDatePickerModalOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
              >
                Reset to All Time
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsDatePickerModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (setStartDate && setEndDate) {
                      setStartDate(tempStart);
                      setEndDate(tempEnd);
                      setActiveDatePreset('custom');
                    }
                    setIsDatePickerModalOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/20 transition-all"
                >
                  Apply Date Filter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'hierarchy' ? (
        <HierarchyExplorer
          source={source}
          onPreviewFile={onPreviewFile}
          onDownloadFile={onDownloadFile}
          onBatchDownload={onBatchDownload}
          onDownloadFolder={onDownloadFolder}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          startDate={startDate}
          endDate={endDate}
        />
      ) : (
        <>
          {/* Search and Category Filters for Flat View */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCategoryFilter(c.id);
                    setCurrentPage(1);
                  }}
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

        {/* Search input */}
        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search files or paths..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all font-mono"
          />
        </div>
      </div>

      {/* Batch Actions Bar (when files selected) */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center justify-between bg-cyan-950/40 border border-cyan-500/40 p-3 rounded-xl shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2 text-xs text-cyan-300 font-semibold">
            <span className="w-5 h-5 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center font-bold text-[10px]">
              {selectedKeys.size}
            </span>
            <span>files selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const selectedFiles = files.filter((f) => selectedKeys.has(f.key));
                onBatchDownload(selectedFiles);
                setSelectedKeys(new Set());
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Selected to On-Prem Box</span>
            </button>
            <button
              onClick={() => setSelectedKeys(new Set())}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 font-medium transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Files Table */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider select-none">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={files.length > 0 && selectedKeys.size === files.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                </th>
                <th
                  onClick={() => handleSort('key')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Object Key / Path</span>
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
              {files.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <div>No files found matching the criteria.</div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Try running a scan or adjusting filters.
                    </div>
                  </td>
                </tr>
              ) : (
                files.map((file) => {
                  const isSelected = selectedKeys.has(file.key);
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
                          onChange={() => toggleSelect(file.key)}
                          className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Key */}
                      <td className="py-3 px-4 font-mono font-medium text-slate-200 max-w-md truncate">
                        <div className="flex items-center gap-2">
                          {CATEGORY_ICONS[file.category]}
                          <span
                            onClick={() => onPreviewFile(file)}
                            className="hover:text-cyan-400 cursor-pointer hover:underline truncate"
                            title={file.key}
                          >
                            {file.key}
                          </span>
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

                      {/* Play time or dimensions */}
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

                        {/* Download to On-Prem Box */}
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

        {/* Pagination */}
        {totalFiles > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-950/40 text-xs text-slate-400">
            <div>
              Showing <span className="text-slate-200 font-semibold">{files.length}</span> of{' '}
              <span className="text-slate-200 font-semibold">{totalFiles}</span> files
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(currentPage - 1)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
              >
                Previous
              </button>
              <span className="font-mono text-slate-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )}
</div>
  );
};
