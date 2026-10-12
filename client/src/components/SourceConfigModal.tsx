import React, { useState } from 'react';
import {
  X,
  Check,
  AlertCircle,
  HardDrive,
  Cloud,
  Shield,
  Key,
  Globe,
  Database,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';
import { StorageSource, StorageProvider } from '../types';
import { getSuggestedDownloadPath } from '../utils/downloadPath';

interface SourceConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (source: Partial<StorageSource>) => Promise<void>;
  initialSource?: StorageSource | null;
}

const PROVIDER_PRESETS: Array<{
  id: StorageProvider;
  name: string;
  defaultEndpoint: string;
  defaultRegion: string;
  forcePathStyle: boolean;
  desc: string;
}> = [
  {
    id: 'aws',
    name: 'AWS S3',
    defaultEndpoint: 'https://s3.us-east-1.amazonaws.com',
    defaultRegion: 'us-east-1',
    forcePathStyle: false,
    desc: 'Amazon Simple Storage Service standard buckets',
  },
  {
    id: 'r2',
    name: 'Cloudflare R2',
    defaultEndpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    defaultRegion: 'auto',
    forcePathStyle: false,
    desc: 'Zero-egress object storage by Cloudflare',
  },
  {
    id: 'minio',
    name: 'MinIO (Self-Hosted)',
    defaultEndpoint: 'http://localhost:9000',
    defaultRegion: 'us-east-1',
    forcePathStyle: true,
    desc: 'Self-hosted on-premise high performance S3 storage',
  },
  {
    id: 'keycdn',
    name: 'KeyCDN',
    defaultEndpoint: 'https://s3.keycdn.com',
    defaultRegion: 'us-east-1',
    forcePathStyle: false,
    desc: 'KeyCDN Storage Zones with HTTP/S3 origin support',
  },
  {
    id: 'wasabi',
    name: 'Wasabi Hot Cloud',
    defaultEndpoint: 'https://s3.wasabisys.com',
    defaultRegion: 'us-east-1',
    forcePathStyle: false,
    desc: 'Hot cloud storage with flat pricing',
  },
  {
    id: 'b2',
    name: 'Backblaze B2',
    defaultEndpoint: 'https://s3.us-west-002.backblazeb2.com',
    defaultRegion: 'us-west-002',
    forcePathStyle: false,
    desc: 'Backblaze S3-compatible cloud storage',
  },
  {
    id: 'generic_s3',
    name: 'Generic S3 / Custom',
    defaultEndpoint: '',
    defaultRegion: 'us-east-1',
    forcePathStyle: false,
    desc: 'Any S3-compatible storage or CDN origin server',
  },
];

export const SourceConfigModal: React.FC<SourceConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSource,
}) => {
  const [provider, setProvider] = useState<StorageProvider>(initialSource?.provider || 'aws');
  const [name, setName] = useState(initialSource?.name || '');
  const [endpoint, setEndpoint] = useState(initialSource?.endpoint || 'https://s3.us-east-1.amazonaws.com');
  const [bucket, setBucket] = useState(initialSource?.bucket || '');
  const [region, setRegion] = useState(initialSource?.region || 'us-east-1');
  const [accessKey, setAccessKey] = useState(initialSource?.accessKey || '');
  const [secretKey, setSecretKey] = useState(initialSource?.secretKey || '');
  const [forcePathStyle, setForcePathStyle] = useState(initialSource?.forcePathStyle ?? false);
  const [cdnUrl, setCdnUrl] = useState(initialSource?.cdnUrl || '');
  const [localPath, setLocalPath] = useState(initialSource?.localPath || '');
  const [readOnly, setReadOnly] = useState(initialSource?.readOnly !== false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleProviderSelect = (p: StorageProvider) => {
    setProvider(p);
    const preset = PROVIDER_PRESETS.find((pr) => pr.id === p);
    if (preset) {
      if (!initialSource) {
        setEndpoint(preset.defaultEndpoint);
        setRegion(preset.defaultRegion);
        setForcePathStyle(preset.forcePathStyle);
      }
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/sources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          endpoint,
          bucket,
          region,
          accessKey,
          secretKey,
          forcePathStyle,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !bucket.trim()) return;

    setSaving(true);
    try {
      await onSave({
        name,
        provider,
        endpoint,
        bucket,
        region,
        accessKey,
        secretKey,
        forcePathStyle,
        cdnUrl,
        localPath: localPath.trim() || undefined,
        readOnly,
      });
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to save source');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div
        className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {initialSource ? 'Configure Storage Source' : 'Connect New Storage Source'}
              </h2>
              <p className="text-[11px] text-slate-400">
                Brand-agnostic S3, Cloudflare R2, MinIO, KeyCDN, or Custom Endpoint
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
          {/* Provider Selection Grid */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Select Storage Provider
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => handleProviderSelect(p.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    provider === p.id
                      ? 'bg-cyan-500/15 border-cyan-500/50 ring-2 ring-cyan-500/20 text-white'
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-xs">{p.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1 line-clamp-1">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Source Friendly Name & Bucket */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Source Display Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Production Media CDN"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Bucket / Zone Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. video-assets-bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          {/* Endpoint URL & Region */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Endpoint URL
              </label>
              <input
                type="text"
                placeholder="https://s3.us-east-1.amazonaws.com"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Leave blank for standard AWS S3, or provide custom MinIO / R2 / Wasabi endpoint.
              </span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Region</label>
              <input
                type="text"
                placeholder="us-east-1 or auto"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          {/* Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                Access Key ID
              </label>
              <input
                type="text"
                placeholder="AKIA..."
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                Secret Access Key
              </label>
              <input
                type="password"
                placeholder="••••••••••••••••"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
            </div>
          </div>

          {/* Public CDN URL & On-Premise Target Path */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                Public CDN Domain (Optional)
              </label>
              <input
                type="text"
                placeholder="https://cdn.example.com"
                value={cdnUrl}
                onChange={(e) => setCdnUrl(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                If your bucket is fronted by Cloudflare or KeyCDN pull zone.
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                  On-Premise Target Directory
                </label>
                <button
                  type="button"
                  onClick={async () => setLocalPath(await getSuggestedDownloadPath(name))}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Auto-fill Default</span>
                </button>
              </div>
              <input
                type="text"
                placeholder="Leave blank to prompt when downloading"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Optional default folder. If left blank, you will be prompted to confirm a location upon download.
              </span>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
              <input
                type="checkbox"
                checked={forcePathStyle}
                onChange={(e) => setForcePathStyle(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
              />
              <span>Force Path Style Addressing (Required for MinIO / self-hosted)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
              />
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Read-Only Mode (Safeguard remote objects from modification)
              </span>
            </label>
          </div>

          {/* Connection Test Banner */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              disabled={testing || !bucket}
              onClick={handleTestConnection}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>{testing ? 'Testing...' : 'Test Connection'}</span>
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !name || !bucket}
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : initialSource ? 'Update Source' : 'Connect Source'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
