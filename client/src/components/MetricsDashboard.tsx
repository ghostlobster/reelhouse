import React from 'react';
import {
  Film,
  HardDrive,
  Clock,
  Layers,
  PieChart as PieChartIcon,
  Calendar,
  DollarSign,
  TrendingUp,
  FileVideo,
  Play,
  Download,
  Eye,
  CheckCircle,
  AlertCircle,
  BarChart2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import { ScanMetrics, StorageFile } from '../types';
import { formatBytes, formatDuration, formatDate } from '../utils/formatters';

interface MetricsDashboardProps {
  metrics: ScanMetrics;
  onPreviewFile: (file: StorageFile) => void;
  onDownloadFile: (file: StorageFile) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  video: '#8b5cf6', // violet
  image: '#06b6d4', // cyan
  audio: '#ec4899', // pink
  document: '#f59e0b', // amber
  archive: '#10b981', // emerald
  code: '#3b82f6', // blue
  other: '#64748b', // slate
};

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({
  metrics,
  onPreviewFile,
  onDownloadFile,
}) => {
  // Category data for Pie chart
  const categoryChartData = Object.entries(metrics.categories)
    .filter(([_, cat]) => cat.count > 0)
    .map(([key, cat]) => ({
      name: key.toUpperCase(),
      category: key,
      value: cat.totalSize,
      formattedSize: cat.formattedSize,
      count: cat.count,
      percent: cat.percentSize,
    }));

  // Size buckets data for Bar chart
  const sizeBucketData = Object.entries(metrics.sizeBuckets).map(([bucket, count]) => ({
    bucket,
    count,
  }));

  // Video resolution data
  const resolutionData = Object.entries(metrics.video.resolutionBuckets).map(([res, count]) => ({
    resolution: res,
    count,
  }));

  // Video duration tiers
  const durationTierData = Object.entries(metrics.video.durationBuckets).map(([tier, count]) => ({
    tier,
    count,
  }));

  // Ingestion timeline data
  const timelineData = metrics.monthlyIngestion.map((item) => ({
    month: item.month,
    count: item.count,
    sizeGB: parseFloat((item.totalSize / (1024 * 1024 * 1024)).toFixed(2)),
  }));

  // Age buckets data
  const ageData = Object.entries(metrics.ageBuckets).map(([age, count]) => ({
    age,
    count,
  }));

  return (
    <div className="space-y-8 pb-12">
      {/* =========================================================================
          HERO CARDS SECTION
          ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Video Play Time (The User's Key Requirement) */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-900/40 via-purple-900/20 to-slate-900/80 border border-violet-500/30 p-5 shadow-xl shadow-violet-950/20 backdrop-blur-sm group hover:border-violet-500/50 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-2xl group-hover:bg-violet-500/20 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold tracking-wider text-violet-300 uppercase flex items-center gap-1.5">
              <Film className="w-4 h-4 text-violet-400" />
              Total Video Play Time
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {metrics.video.videoCount} Videos
            </span>
          </div>

          <div className="my-2">
            <div className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm font-mono">
              {metrics.video.totalVideoDurationFormatted}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1 font-mono">
              <Clock className="w-3.5 h-3.5 text-violet-400" />
              {Math.floor(metrics.video.totalVideoDuration).toLocaleString()} total seconds
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-violet-500/20 flex items-center justify-between text-xs text-slate-300">
            <span>Avg Video Duration:</span>
            <span className="font-semibold text-violet-200 font-mono">
              {formatDuration(metrics.video.avgVideoDuration)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-300">
            <span>Video Storage:</span>
            <span className="font-semibold text-violet-200 font-mono">
              {formatBytes(metrics.video.totalVideoSize)}
            </span>
          </div>
        </div>

        {/* Total Storage & Objects */}
        <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-5 shadow-lg backdrop-blur-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold tracking-wider text-cyan-400 uppercase flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              Total Storage
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {metrics.totalFiles.toLocaleString()} Objects
            </span>
          </div>

          <div className="my-2">
            <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
              {metrics.formattedTotalSize}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Active across {metrics.provider.toUpperCase()} bucket
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span>Average File Size:</span>
            <span className="font-semibold text-cyan-300 font-mono">{formatBytes(metrics.avgFileSize)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-300">
            <span>Median File Size:</span>
            <span className="font-semibold text-cyan-300 font-mono">{formatBytes(metrics.medianFileSize)}</span>
          </div>
        </div>

        {/* On-Premise Box Synchronization */}
        <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-5 shadow-lg backdrop-blur-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              On-Premise Sync
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {metrics.onPremSync.syncPercentage}% Synced
            </span>
          </div>

          <div className="my-2">
            <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
              {metrics.onPremSync.syncedFilesCount} / {metrics.totalFiles}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {formatBytes(metrics.onPremSync.syncedSize)} synced to on-prem disk
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, metrics.onPremSync.syncPercentage)}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
            <span>Pending Download:</span>
            <span className="font-semibold text-amber-300 font-mono">
              {formatBytes(metrics.onPremSync.missingLocalSize)}
            </span>
          </div>
        </div>

        {/* Estimated Storage Cost */}
        <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-5 shadow-lg backdrop-blur-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold tracking-wider text-amber-400 uppercase flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-amber-400" />
              Estimated Monthly Cost
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              ${metrics.costEstimates.costRatePerGB}/GB
            </span>
          </div>

          <div className="my-2">
            <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
              ${metrics.costEstimates.monthlyStorageEstimateUSD.toFixed(2)}
              <span className="text-sm text-slate-400 font-sans font-normal"> / mo</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Estimated raw cloud storage rate
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span>Storage Provider:</span>
            <span className="font-semibold text-slate-200 capitalize">{metrics.provider}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-300">
            <span>Egress Potential:</span>
            <span className="font-semibold text-emerald-400">Read-Only Cached</span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          VIDEO DEEP DIVE SECTION (PRIMARY USER EMPHASIS)
          ========================================================================= */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Video Asset Breakdown &amp; Play Time Analytics
              </h2>
              <p className="text-xs text-slate-400">
                Extracted via HTTP header range probing across all remote and on-prem video streams
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Total Video Duration</div>
            <div className="text-lg font-extrabold text-violet-400 font-mono">
              {metrics.video.totalVideoDurationFormatted}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Resolution Tiers */}
          <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-cyan-400" />
              Resolution Distribution
            </h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resolutionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="resolution" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
                  />
                  <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Videos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Duration Tiers */}
          <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-400" />
              Duration Tiers
            </h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={durationTierData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="tier" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Videos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Video Formats & Codecs */}
          <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-4 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileVideo className="w-4 h-4 text-pink-400" />
                Containers &amp; Codecs
              </h3>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 mb-1">Containers:</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(metrics.video.containerFormats).map(([fmt, data]) => (
                    <span
                      key={fmt}
                      className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-slate-200 flex items-center gap-1.5"
                    >
                      <span className="font-bold text-violet-400">{fmt}</span>
                      <span className="text-[10px] text-slate-400">({data.count})</span>
                    </span>
                  ))}
                </div>

                <div className="text-[11px] font-semibold text-slate-400 pt-3 mb-1">Video Codecs:</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(metrics.video.videoCodecs).map(([codec, data]) => (
                    <span
                      key={codec}
                      className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-slate-200 flex items-center gap-1.5"
                    >
                      <span className="font-bold text-cyan-400">{codec.toUpperCase()}</span>
                      <span className="text-[10px] text-slate-400">({data.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
              Videos represent{' '}
              <strong className="text-violet-300">
                {metrics.categories.video?.percentSize || 0}%
              </strong>{' '}
              of total library storage.
            </div>
          </div>
        </div>

        {/* Longest Videos Leaderboard */}
        {metrics.longestVideos.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-800">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Play className="w-4 h-4 text-violet-400" />
              Longest Video Files (Quick Preview)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                    <th className="py-2.5 px-3">File Key</th>
                    <th className="py-2.5 px-3">Play Time</th>
                    <th className="py-2.5 px-3">Resolution</th>
                    <th className="py-2.5 px-3">Codec</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {metrics.longestVideos.slice(0, 5).map((v) => (
                    <tr key={v.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-200 font-medium truncate max-w-xs">
                        {v.key}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-violet-400 font-bold">
                        {formatDuration(v.duration || 0)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {v.width && v.height ? `${v.width}x${v.height}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 uppercase text-cyan-400 font-mono">
                        {v.codec || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{formatBytes(v.size)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => onPreviewFile(v)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/40 border border-violet-500/30 transition-colors text-[11px]"
                        >
                          <Play className="w-3 h-3" /> Play
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          SIZE & CATEGORY DISTRIBUTIONS
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown (Donut + Progress) */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-cyan-400" />
            File Categories &amp; Storage Footprint
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {categoryChartData.map((entry) => (
                      <Cell
                        key={entry.category}
                        fill={CATEGORY_COLORS[entry.category] || '#64748b'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    formatter={(val: any) => [formatBytes(val), 'Storage Size']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-2">
              {categoryChartData.map((cat) => (
                <div key={cat.category} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[cat.category] || '#64748b' }}
                    />
                    <span className="font-medium text-slate-300">{cat.name}</span>
                    <span className="text-[11px] text-slate-500">({cat.count})</span>
                  </div>
                  <div className="font-mono text-slate-200 font-semibold">
                    {cat.formattedSize} ({cat.percent}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* File Size Distribution Buckets */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            File Size Distribution Buckets
          </h2>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sizeBucketData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-20} textAnchor="end" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f8fafc', fontWeight: 600 }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="File Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* =========================================================================
          TIME & INGESTION TIMELINE
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Activity / Ingestion */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-400" />
            File Age &amp; Ingestion Timeline (Activity by Month)
          </h2>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="sizeColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                  formatter={(val: any, name: any) => [name === 'sizeGB' ? `${val} GB` : val, name === 'sizeGB' ? 'Volume' : 'Files']}
                />
                <Area type="monotone" dataKey="sizeGB" stroke="#6366f1" fillOpacity={1} fill="url(#sizeColor)" name="Volume (GB)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recency Breakdown & Extremes */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              Recency Breakdown
            </h2>

            <div className="space-y-2">
              {ageData.map((a) => (
                <div key={a.age} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{a.age}</span>
                  <span className="font-mono text-slate-200 font-semibold">{a.count} files</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-xs">
            {metrics.newestFile && (
              <div>
                <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider block">
                  Most Recently Uploaded:
                </span>
                <span className="font-mono text-slate-200 truncate block">{metrics.newestFile.key}</span>
                <span className="text-[11px] text-slate-500">{formatDate(metrics.newestFile.date)}</span>
              </div>
            )}
            {metrics.oldestFile && (
              <div className="pt-2">
                <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider block">
                  Oldest Ingested Object:
                </span>
                <span className="font-mono text-slate-200 truncate block">{metrics.oldestFile.key}</span>
                <span className="text-[11px] text-slate-500">{formatDate(metrics.oldestFile.date)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          LARGEST FILES LEADERBOARD
          ========================================================================= */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-cyan-400" />
          Top Largest Files on CDN / Storage
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                <th className="py-2.5 px-3">File Key</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Play Time</th>
                <th className="py-2.5 px-3">On-Prem Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {metrics.largestFiles.slice(0, 10).map((f) => (
                <tr key={f.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-slate-200 font-medium truncate max-w-sm">
                    {f.key}
                  </td>
                  <td className="py-2.5 px-3 uppercase text-[11px] font-semibold text-slate-400">
                    <span
                      className="px-2 py-0.5 rounded text-[10px]"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[f.category] || '#64748b'}20`,
                        color: CATEGORY_COLORS[f.category] || '#94a3b8',
                      }}
                    >
                      {f.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-200 font-bold">{formatBytes(f.size)}</td>
                  <td className="py-2.5 px-3 font-mono text-violet-400">
                    {f.duration ? formatDuration(f.duration) : '—'}
                  </td>
                  <td className="py-2.5 px-3">
                    {f.localStatus === 'synced' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <CheckCircle className="w-3 h-3" /> Synced
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                        <AlertCircle className="w-3 h-3" /> Missing
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right space-x-2">
                    <button
                      onClick={() => onPreviewFile(f)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors text-[11px]"
                    >
                      <Eye className="w-3 h-3 text-cyan-400" /> Preview
                    </button>
                    {f.localStatus !== 'synced' && (
                      <button
                        onClick={() => onDownloadFile(f)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 border border-cyan-500/30 transition-colors text-[11px]"
                      >
                        <Download className="w-3 h-3" /> Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
