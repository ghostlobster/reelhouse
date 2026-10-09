import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  Copy,
  Check,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  HardDrive,
  Info,
} from 'lucide-react';
import { StorageFile, StorageSource } from '../types';
import { formatBytes, formatDuration, formatDate } from '../utils/formatters';

interface FilePreviewModalProps {
  file: StorageFile | null;
  source: StorageSource;
  onClose: () => void;
  onDownload: (file: StorageFile) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  source,
  onClose,
  onDownload,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!file) return;
    setZoomLevel(1);
    setRotation(0);
    setTextContent(null);

    // If text or code, fetch content
    if (file.category === 'code' || file.extension === 'txt' || file.extension === 'json' || file.extension === 'md' || file.extension === 'csv' || file.extension === 'yml' || file.extension === 'yaml') {
      setLoadingText(true);
      fetch(`/api/sources/${source.id}/raw?key=${encodeURIComponent(file.key)}`)
        .then((res) => res.json())
        .then((data) => {
          setTextContent(data.content || '');
          setLoadingText(false);
        })
        .catch(() => {
          setTextContent('Failed to load text preview.');
          setLoadingText(false);
        });
    }
  }, [file, source]);

  if (!file) return null;

  const streamUrl = `/api/sources/${source.id}/stream?key=${encodeURIComponent(file.key)}`;
  const publicCdnUrl = source.cdnUrl
    ? `${source.cdnUrl.replace(/\/$/, '')}/${file.key}`
    : streamUrl;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(publicCdnUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div
        className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 rounded-xl bg-slate-800 border border-slate-700/80 text-cyan-400">
              {file.category === 'video' && <Film className="w-5 h-5 text-violet-400" />}
              {file.category === 'audio' && <Music className="w-5 h-5 text-pink-400" />}
              {file.category === 'image' && <ImageIcon className="w-5 h-5 text-cyan-400" />}
              {file.category === 'document' && <FileText className="w-5 h-5 text-amber-400" />}
              {file.category !== 'video' &&
                file.category !== 'audio' &&
                file.category !== 'image' &&
                file.category !== 'document' && <FileText className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="truncate">
              <h2 className="text-sm font-bold text-white font-mono truncate" title={file.key}>
                {file.key}
              </h2>
              <div className="text-[11px] text-slate-400 flex items-center gap-3 mt-0.5">
                <span>{formatBytes(file.size)}</span>
                {file.duration && (
                  <span className="text-violet-400 font-mono font-medium">
                    {formatDuration(file.duration)}
                  </span>
                )}
                {file.width && file.height && (
                  <span className="text-slate-400 font-mono">
                    {file.width} × {file.height}
                  </span>
                )}
                <span className="text-slate-500 font-mono">.{file.extension}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Copy public CDN link */}
            <button
              onClick={handleCopyUrl}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Copy URL"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            {/* Download to On-Prem Box */}
            <button
              onClick={() => onDownload(file)}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download to Box</span>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body / Media Canvas */}
        <div className="flex-1 overflow-auto p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          {/* VIDEO PREVIEW */}
          {file.category === 'video' && (
            <div className="w-full max-w-4xl flex flex-col items-center">
              <video
                controls
                autoPlay
                playsInline
                src={streamUrl}
                className="w-full max-h-[60vh] rounded-xl shadow-2xl bg-black object-contain border border-slate-800"
              >
                Your browser does not support HTML5 video preview.
              </video>

              {/* Video metadata hud */}
              <div className="w-full mt-4 p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-slate-500 text-[10px] block uppercase font-bold">
                      Codec
                    </span>
                    <span className="font-mono text-cyan-400 uppercase font-semibold">
                      {file.codec || 'H.264 / AVC'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block uppercase font-bold">
                      Resolution
                    </span>
                    <span className="font-mono text-slate-200">
                      {file.width && file.height ? `${file.width} × ${file.height}` : 'Variable'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block uppercase font-bold">
                      Total Play Time
                    </span>
                    <span className="font-mono text-violet-400 font-bold">
                      {file.duration ? formatDuration(file.duration) : 'Stream pending'}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Streaming via Range Proxy (Instant seeking enabled)
                </div>
              </div>
            </div>
          )}

          {/* AUDIO PREVIEW */}
          {file.category === 'audio' && (
            <div className="w-full max-w-lg p-8 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-6">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 shadow-xl">
                <Music className="w-10 h-10 animate-pulse" />
              </div>
              <div>
                <div className="font-mono font-bold text-white text-base truncate">{file.key}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {formatBytes(file.size)} • {file.duration ? formatDuration(file.duration) : 'Audio Track'}
                </div>
              </div>
              <audio controls src={streamUrl} className="w-full" />
            </div>
          )}

          {/* IMAGE PREVIEW */}
          {file.category === 'image' && (
            <div className="relative w-full flex flex-col items-center justify-center space-y-4">
              <div className="flex items-center gap-2 p-1.5 bg-slate-900/90 rounded-xl border border-slate-800">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-slate-300 w-12 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 ml-2"
                  title="Rotate"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>

              <div className="max-w-4xl max-h-[60vh] overflow-hidden flex items-center justify-center p-4">
                <img
                  src={streamUrl}
                  alt={file.key}
                  style={{
                    transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                    transition: 'transform 0.2s ease',
                  }}
                  className="max-h-[55vh] object-contain rounded-lg shadow-2xl"
                />
              </div>
            </div>
          )}

          {/* CODE / TEXT / JSON / MARKDOWN PREVIEW */}
          {(file.category === 'code' ||
            file.extension === 'txt' ||
            file.extension === 'json' ||
            file.extension === 'md' ||
            file.extension === 'csv') && (
            <div className="w-full h-full max-h-[65vh] flex flex-col">
              {loadingText ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-xs">
                  Loading text preview...
                </div>
              ) : (
                <div className="w-full bg-slate-900/90 rounded-xl border border-slate-800 overflow-auto p-4">
                  <pre className="font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap select-text">
                    {textContent}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* PDF PREVIEW */}
          {file.extension === 'pdf' && (
            <div className="w-full h-[65vh]">
              <iframe
                src={streamUrl}
                title="PDF Preview"
                className="w-full h-full rounded-xl border border-slate-800 bg-white"
              />
            </div>
          )}

          {/* GENERIC / BINARY FALLBACK */}
          {file.category !== 'video' &&
            file.category !== 'audio' &&
            file.category !== 'image' &&
            file.category !== 'code' &&
            file.extension !== 'txt' &&
            file.extension !== 'json' &&
            file.extension !== 'md' &&
            file.extension !== 'pdf' && (
              <div className="max-w-md p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-mono font-bold text-white text-sm truncate">{file.key}</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Binary or archive format ({formatBytes(file.size)})
                  </p>
                </div>
                <button
                  onClick={() => onDownload(file)}
                  className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Download File to On-Prem Box</span>
                </button>
              </div>
            )}
        </div>

        {/* Modal Footer (Technical Object Metadata) */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-4">
          <div className="flex items-center gap-6 font-mono text-[11px]">
            <div>
              <span className="text-slate-600">ETag: </span>
              <span className="text-slate-400">{file.etag || '—'}</span>
            </div>
            <div>
              <span className="text-slate-600">Last Modified: </span>
              <span className="text-slate-400">{formatDate(file.lastModified)}</span>
            </div>
            <div>
              <span className="text-slate-600">On-Prem: </span>
              <span
                className={file.localStatus === 'synced' ? 'text-emerald-400' : 'text-amber-400'}
              >
                {file.localStatus.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            Provider: {source.provider.toUpperCase()} • Bucket: {source.bucket}
          </div>
        </div>
      </div>
    </div>
  );
};
