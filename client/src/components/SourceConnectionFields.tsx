import React from 'react';
import { Key, Check, AlertCircle } from 'lucide-react';
import { StorageSource, StorageProvider } from '../types';

/**
 * Connection fields shared by "Connect New Storage Source" and the source settings page,
 * so both show the same inputs for each provider.
 */

/** Providers reached as a file server; their endpoint is stored as "<protocol>://host:port". */
export const isFileServerProvider = (p: StorageProvider) => p === 'keycdn';

export type FileProtocol = 'ftps' | 'ftp' | 'sftp';
const FILE_PROTOCOLS: Array<{ id: FileProtocol; label: string; port: string }> = [
  { id: 'ftps', label: 'FTPS (FTP over TLS)', port: '21' },
  { id: 'ftp', label: 'FTP (unencrypted)', port: '21' },
  { id: 'sftp', label: 'SFTP (SSH)', port: '22' },
];
const defaultPort = (protocol: FileProtocol) => FILE_PROTOCOLS.find((p) => p.id === protocol)!.port;

function splitFileEndpoint(endpoint: string): { protocol: FileProtocol; host: string; port: string } {
  let raw = endpoint.trim();
  const scheme = raw.match(/^(ftps|ftp|sftp):\/\//i);
  const protocol = (scheme?.[1].toLowerCase() as FileProtocol) || 'ftps';
  raw = raw.slice(scheme?.[0].length ?? 0).replace(/\/+$/, '');
  const match = raw.match(/^(.+?)(?::(\d+))?$/);
  return { protocol, host: match?.[1] || 'ftp.keycdn.com', port: match?.[2] || defaultPort(protocol) };
}

export interface ConnectionDraft {
  provider: StorageProvider;
  bucket: string;
  accessKey: string;
  secretKey: string;
  // S3
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  // File server
  fileProtocol: FileProtocol;
  fileHost: string;
  filePort: string;
}

export function draftFromSource(source?: Partial<StorageSource> | null): ConnectionDraft {
  const provider = source?.provider || 'aws';
  const file = splitFileEndpoint(isFileServerProvider(provider) ? source?.endpoint || '' : '');
  return {
    provider,
    bucket: source?.bucket || '',
    accessKey: source?.accessKey || '',
    secretKey: source?.secretKey || '',
    endpoint: source?.endpoint ?? 'https://s3.us-east-1.amazonaws.com',
    region: source?.region || 'us-east-1',
    forcePathStyle: source?.forcePathStyle ?? false,
    fileProtocol: file.protocol,
    fileHost: file.host,
    filePort: file.port,
  };
}

/** The connection part of a source, as the API stores it. */
export function connectionPayload(d: ConnectionDraft): Partial<StorageSource> {
  const fileServer = isFileServerProvider(d.provider);
  return {
    provider: d.provider,
    endpoint: fileServer
      ? `${d.fileProtocol}://${d.fileHost.trim()}:${d.filePort.trim() || defaultPort(d.fileProtocol)}`
      : d.endpoint,
    // Blank folder means "the folder the login opens in"
    bucket: fileServer ? d.bucket.trim() || '/' : d.bucket,
    region: d.region,
    accessKey: d.accessKey,
    secretKey: d.secretKey,
    forcePathStyle: fileServer ? false : d.forcePathStyle,
  };
}

/** Whether enough is filled in to test or save. */
export const isConnectionComplete = (d: ConnectionDraft): boolean =>
  isFileServerProvider(d.provider) ? Boolean(d.fileHost.trim()) : Boolean(d.bucket.trim());

export async function testConnection(d: ConnectionDraft): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch('/api/sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectionPayload(d)),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || 'Connection test failed' };
  }
}

const inputClass =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono';
const labelClass = 'block text-xs font-semibold text-slate-300 mb-1';

interface SourceConnectionFieldsProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  /** Rendered beside the bucket / folder field (the source name input). */
  nameField?: React.ReactNode;
}

export const SourceConnectionFields: React.FC<SourceConnectionFieldsProps> = ({ draft, onChange, nameField }) => {
  const fileServer = isFileServerProvider(draft.provider);

  return (
    <>
      {/* Name & Bucket / Folder */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {nameField}
        <div>
          <label className={labelClass}>{fileServer ? 'Storage Zone / Remote Folder' : 'Bucket / Zone Name *'}</label>
          <input
            type="text"
            required={!fileServer}
            placeholder={fileServer ? 'Blank or / for the login folder' : 'e.g. video-assets-bucket'}
            value={draft.bucket}
            onChange={(e) => onChange({ bucket: e.target.value })}
            className={inputClass}
          />
          {fileServer && (
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Folder to scan. A KeyCDN Subuser usually logs straight into its zone, so leave it blank.
            </span>
          )}
        </div>
      </div>

      {/* Endpoint URL & Region (S3) or Protocol, Host & Port (file server) */}
      {fileServer ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className={labelClass}>Protocol</label>
            <select
              value={draft.fileProtocol}
              onChange={(e) => {
                const next = e.target.value as FileProtocol;
                // Keep a custom port, but follow the protocol when it was the default one
                const port = draft.filePort === defaultPort(draft.fileProtocol) ? defaultPort(next) : draft.filePort;
                onChange({ fileProtocol: next, filePort: port });
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {FILE_PROTOCOLS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Server Host *</label>
            <input
              type="text"
              required
              placeholder="ftp.keycdn.com"
              value={draft.fileHost}
              onChange={(e) => onChange({ fileHost: e.target.value })}
              className={inputClass}
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              KeyCDN storage uses FTPS on ftp.keycdn.com:21 with a Subuser login.
            </span>
          </div>
          <div>
            <label className={labelClass}>Port</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder={defaultPort(draft.fileProtocol)}
              value={draft.filePort}
              onChange={(e) => onChange({ filePort: e.target.value.replace(/[^0-9]/g, '') })}
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Endpoint URL</label>
            <input
              type="text"
              placeholder="https://s3.us-east-1.amazonaws.com"
              value={draft.endpoint}
              onChange={(e) => onChange({ endpoint: e.target.value })}
              className={inputClass}
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Leave blank for standard AWS S3, or provide custom MinIO / R2 / Wasabi endpoint.
            </span>
          </div>
          <div>
            <label className={labelClass}>Region</label>
            <input
              type="text"
              placeholder="us-east-1 or auto"
              value={draft.region}
              onChange={(e) => onChange({ region: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {/* Credentials */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={`${labelClass} flex items-center gap-1.5`}>
            <Key className="w-3.5 h-3.5 text-cyan-400" />
            {fileServer ? 'Username' : 'Access Key ID'}
          </label>
          <input
            type="text"
            placeholder={fileServer ? 'KeyCDN Subuser name' : 'AKIA...'}
            value={draft.accessKey}
            onChange={(e) => onChange({ accessKey: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`${labelClass} flex items-center gap-1.5`}>
            <Key className="w-3.5 h-3.5 text-cyan-400" />
            {fileServer ? 'Password' : 'Secret Access Key'}
          </label>
          <input
            type="password"
            placeholder="••••••••••••••••"
            value={draft.secretKey}
            onChange={(e) => onChange({ secretKey: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {!fileServer && (
        <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
          <input
            type="checkbox"
            checked={draft.forcePathStyle}
            onChange={(e) => onChange({ forcePathStyle: e.target.checked })}
            className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
          />
          <span>Force Path Style Addressing (Required for MinIO / self-hosted)</span>
        </label>
      )}
    </>
  );
};

export const ConnectionTestBanner: React.FC<{ result: { success: boolean; message: string } | null }> = ({ result }) =>
  result ? (
    <div
      className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
        result.success
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
      }`}
    >
      {result.success ? (
        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
      )}
      <span className="break-words">{result.message}</span>
    </div>
  ) : null;
