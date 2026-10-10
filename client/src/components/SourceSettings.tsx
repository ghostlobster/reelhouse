import React, { useState } from 'react';
import {
  Sliders,
  Trash2,
  Save,
  Shield,
  HardDrive,
  Globe,
  Key,
  Check,
  AlertTriangle,
  FolderTree,
  FolderDown,
  RotateCcw,
  Info,
} from 'lucide-react';
import { StorageSource } from '../types';

interface SourceSettingsProps {
  source: StorageSource;
  onUpdateSource: (updated: Partial<StorageSource>) => Promise<void>;
  onDeleteSource: (sourceId: string) => Promise<void>;
}

export const SourceSettings: React.FC<SourceSettingsProps> = ({
  source,
  onUpdateSource,
  onDeleteSource,
}) => {
  const [name, setName] = useState(source.name);
  const [endpoint, setEndpoint] = useState(source.endpoint || '');
  const [bucket, setBucket] = useState(source.bucket || '');
  const [region, setRegion] = useState(source.region || '');
  const [accessKey, setAccessKey] = useState(source.accessKey || '');
  const [secretKey, setSecretKey] = useState(source.secretKey || '');
  const [cdnUrl, setCdnUrl] = useState(source.cdnUrl || '');
  const [localPath, setLocalPath] = useState(source.localPath || '');
  const [readOnly, setReadOnly] = useState(source.readOnly !== false);
  const [forcePathStyle, setForcePathStyle] = useState(source.forcePathStyle ?? false);

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateSource({
        name,
        endpoint,
        bucket,
        region,
        accessKey,
        secretKey,
        cdnUrl,
        localPath,
        readOnly,
        forcePathStyle,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to update source');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete source "${source.name}"? This removes indexed metrics from CDN Buddy.`)) {
      await onDeleteSource(source.id);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-bold text-white">Source Configuration</h2>
              <p className="text-xs text-slate-400">
                Update connection settings, public CDN domains, and on-premise local directories.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
            {source.provider.toUpperCase()}
          </span>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Source Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Bucket Name</label>
              <input
                type="text"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1">Endpoint URL</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Region</label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                Access Key ID
              </label>
              <input
                type="text"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                Secret Access Key
              </label>
              <input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          {/* Public CDN URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              Public CDN Domain / Pull Zone (Optional)
            </label>
            <input
              type="text"
              placeholder="https://cdn.example.com"
              value={cdnUrl}
              onChange={(e) => setCdnUrl(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
            />
          </div>

          {/* Dedicated Local Storage Location Settings Card */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  On-Premise Local Storage Directory
                </h3>
              </div>
              {localPath.trim() ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  DEFAULT LOCATION CONFIGURED
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  NOT SET (WILL PROMPT ON DOWNLOAD)
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Files downloaded from <span className="text-slate-200 font-semibold">{source.name}</span> will be saved here on this host server. Different sources can have different default directories. If left empty, you will be prompted to confirm a destination every time you download.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">Target Folder Path</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/system/default-download-path?sourceName=${encodeURIComponent(name || source.name)}`);
                        const data = await res.json();
                        if (data.suggestedPath) setLocalPath(data.suggestedPath);
                      } catch {
                        setLocalPath(`./downloads/${(name || source.name).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
                      }
                    }}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Set Default (downloads/{name || source.name})</span>
                  </button>
                  {localPath && (
                    <button
                      type="button"
                      onClick={() => setLocalPath('')}
                      className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors ml-2"
                    >
                      Clear Path
                    </button>
                  )}
                </div>
              </div>

              <input
                type="text"
                placeholder="Leave blank to prompt on download, or enter e.g. E:\Downloads\cdn-mirror"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1 font-mono">
              <FolderTree className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Full remote hierarchy will be preserved inside: <span className="text-slate-200">{localPath.trim() || '<prompted directory>'}</span></span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={forcePathStyle}
                onChange={(e) => setForcePathStyle(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
              />
              <span>Force Path Style (MinIO)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
              />
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Read-Only Protection (Safe mode)
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-6 border-t border-slate-800">
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Source</span>
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-950" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
