import React from 'react';
import {
  X,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  StopCircle,
  HardDrive,
  Trash2,
} from 'lucide-react';
import { DownloadTask } from '../types';
import { formatBytes } from '../utils/formatters';

interface DownloadsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: DownloadTask[];
  onCancelTask: (taskId: string) => void;
}

export const DownloadsDrawer: React.FC<DownloadsDrawerProps> = ({
  isOpen,
  onClose,
  tasks,
  onCancelTask,
}) => {
  if (!isOpen) return null;

  const activeTasks = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'queued'
  );
  const finishedTasks = tasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
      <div
        className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Transfer Queue &amp; Sync</h2>
              <p className="text-[11px] text-slate-400">
                {activeTasks.length} active • {finishedTasks.length} past transfers
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

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Active transfers */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>Active Downloads</span>
              {activeTasks.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">
                  {activeTasks.length} in progress
                </span>
              )}
            </h3>

            {activeTasks.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 text-center text-xs text-slate-500">
                No active downloads right now.
              </div>
            ) : (
              <div className="space-y-3">
                {activeTasks.map((task) => {
                  const percent = task.size > 0 ? Math.min(100, Math.round((task.bytesDownloaded / task.size) * 100)) : 0;
                  const speedFormatted = task.speedBps > 0 ? `${formatBytes(task.speedBps)}/s` : '';

                  return (
                    <div
                      key={task.id}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate font-mono text-xs font-medium text-slate-200" title={task.fileKey}>
                          {task.fileKey}
                        </div>
                        <button
                          onClick={() => onCancelTask(task.id)}
                          title="Cancel Download"
                          className="text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                        >
                          <StopCircle className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-cyan-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>
                          {formatBytes(task.bytesDownloaded)} / {formatBytes(task.size)}
                        </span>
                        <div className="flex items-center gap-2">
                          {speedFormatted && <span className="text-cyan-400 font-semibold">{speedFormatted}</span>}
                          <span>{percent}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Finished transfers */}
          {finishedTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                Recent Completed Transfers
              </h3>
              <div className="space-y-2">
                {finishedTasks.slice(0, 15).map((task) => (
                  <div
                    key={task.id}
                    className="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 truncate mr-2">
                      {task.status === 'completed' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      {task.status === 'failed' && (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      {task.status === 'cancelled' && (
                        <StopCircle className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span className="font-mono text-slate-300 truncate" title={task.fileKey}>
                        {task.fileKey}
                      </span>
                    </div>
                    <span className="font-mono text-slate-500 text-[11px] shrink-0">
                      {formatBytes(task.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
            <span>Files save to configured on-premise folder</span>
          </div>
        </div>
      </div>
    </div>
  );
};
