import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectData } from '../../types';
import {
  deleteStoredProject,
  duplicateStoredProject,
  getStorageStatus,
  listStoredProjects,
  readStoredProject,
  requestPersistentStorage,
  StorageStatus,
  StoredProjectInfo,
} from '../../services/storage';
import { BackupProgress, createBackup, downloadBlob, restoreBackup } from '../../services/projectBackup';
import { notify } from '../../services/notifications';
import { useDialog } from './useDialog';
import { X, FolderOpen, FilePlus2, Archive, Copy, Trash2, Upload, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';

interface ProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project being edited: its slot, and its latest state (for backing it up) */
  currentSlotId: string | null;
  currentProject: ProjectData;
  /** Writes the project being edited to the browser's storage now, so the list is up to date */
  saveNow: () => Promise<void>;
  /** Switch the editor to a stored project; resolves to whether it was opened */
  onOpenProject: (slotId: string) => Promise<boolean>;
  onNewProject: () => Promise<void>;
}

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

const formatLength = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
};

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
};

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  isOpen,
  onClose,
  currentSlotId,
  currentProject,
  saveNow,
  onOpenProject,
  onNewProject,
}) => {
  const [projects, setProjects] = useState<StoredProjectInfo[] | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  // What is running (a backup being made or read): the dialog stays open until it is done
  const [busy, setBusy] = useState<BackupProgress | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listStoredProjects());
    } catch (e) {
      console.warn('Could not list the stored projects:', e);
      setProjects([]);
      notify('このブラウザに保存されたプロジェクトを読み込めませんでした。', 'error');
    }
    setStorage(await getStorageStatus());
  }, []);

  // The project being edited is saved first, so it is in the list with its latest title
  useEffect(() => {
    if (!isOpen) return;
    setConfirmingDelete(null);
    saveNow()
      .catch((e) => console.warn('Could not save before listing projects:', e))
      .then(refresh);
  }, [isOpen, saveNow, refresh]);

  const dialogRef = useDialog(isOpen, onClose, !busy);

  if (!isOpen) return null;

  /** Run a long task with its progress shown; errors are reported, a cancel is not */
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy({ percentage: 0, statusText: '準備中...' });
    try {
      await task(abort.signal);
    } catch (e) {
      if (!abort.signal.aborted) notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const handleBackup = (info: StoredProjectInfo) =>
    run(async (signal) => {
      // The open project is taken as it is on screen; it also knows media that could not be stored
      const project = info.slotId === currentSlotId ? currentProject : await readStoredProject(info.slotId);
      if (!project) throw new Error('プロジェクトを読み込めなかったため、バックアップを作れませんでした。');
      const backup = await createBackup(project, setBusy, signal);
      downloadBlob(backup.blob, backup.fileName);
      if (backup.missing.length > 0) {
        notify(
          `次の素材はこのブラウザに残っていなかったため、バックアップに入っていません:\n${backup.missing.join('、')}`,
          'error'
        );
      } else {
        notify(`「${backup.fileName}」を保存しました（${formatBytes(backup.blob.size)}）。`);
      }
    });

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(async (signal) => {
      const restored = await restoreBackup(file, setBusy, signal);
      if (restored.missing.length > 0) {
        notify(`次の素材を取り込めませんでした（保存領域の空きをご確認ください）:\n${restored.missing.join('、')}`, 'error');
      }
      if (await onOpenProject(restored.slotId)) {
        notify(`バックアップから「${restored.title}」を読み込みました。`);
      } else {
        await refresh();
      }
    });
  };

  const handleDuplicate = async (info: StoredProjectInfo) => {
    try {
      // The open project is copied as it is now, not as it was last saved
      if (info.slotId === currentSlotId) await saveNow();
      await duplicateStoredProject(info.slotId);
    } catch (e) {
      console.warn('Could not duplicate the project:', e);
      notify('プロジェクトを複製できませんでした。', 'error');
    }
    await refresh();
  };

  const handleDelete = async (info: StoredProjectInfo) => {
    setConfirmingDelete(null);
    try {
      await deleteStoredProject(info.slotId);
    } catch (e) {
      console.warn('Could not delete the project:', e);
      notify('プロジェクトを削除できませんでした。', 'error');
    }
    await refresh();
  };

  const handleProtect = async () => {
    const isProtected = await requestPersistentStorage(true);
    if (!isProtected) {
      notify(
        'ブラウザが保護を許可しませんでした。このページをブックマークに追加してから、もう一度お試しください。大事なプロジェクトは「バックアップ」でファイルに残してください。'
      );
    }
    setStorage(await getStorageStatus());
  };

  const rowButton =
    'flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="プロジェクト"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#121620] border border-[#2b384c] rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#212937] pb-3">
          <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-sm">
            <FolderOpen className="w-4 h-4" />
            <span>プロジェクト</span>
          </div>
          {!busy && (
            <button onClick={onClose} aria-label="閉じる" className="p-1 text-gray-400 hover:text-white rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* New project / restore a backup */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onNewProject()}
            disabled={!!busy}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B0D11] bg-gradient-to-r from-[#E5C07B] to-[#D4AF37] hover:brightness-110 rounded disabled:opacity-50"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>新しいプロジェクト</span>
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            disabled={!!busy}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-gray-200 bg-[#1b2332] hover:bg-[#253248] border border-[#3a4a60] rounded disabled:opacity-50"
            title="バックアップ（.sacred.zip）から、素材ごと新しいプロジェクトとして読み込みます"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>バックアップから読み込む</span>
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleRestore}
            className="hidden"
            aria-label="バックアップファイル"
          />
        </div>

        {/* Progress of a backup being made or read */}
        {busy && (
          <div className="bg-[#171f2d] border border-[#263345] rounded-lg p-3 space-y-2" role="status">
            <div className="flex items-center justify-between text-xs text-gray-200">
              <span className="flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#D4AF37]" />
                <span>{busy.statusText}</span>
              </span>
              <span className="font-mono">{busy.percentage}%</span>
            </div>
            <div className="h-1.5 bg-[#0e131c] rounded-full overflow-hidden">
              <div className="h-full bg-[#D4AF37] transition-all" style={{ width: `${busy.percentage}%` }} />
            </div>
            <div className="text-right">
              <button
                onClick={() => abortRef.current?.abort()}
                className="px-3 py-1 text-xs text-gray-200 bg-[#1b2332] hover:bg-[#2a2030] border border-[#3a4a60] rounded"
              >
                中止
              </button>
            </div>
          </div>
        )}

        {/* The projects kept in this browser */}
        <div className="space-y-1.5">
          <div className="text-xs text-gray-400">このブラウザに保存されているプロジェクト</div>
          {projects === null ? (
            <div className="text-xs text-gray-400 py-4 text-center">読み込み中...</div>
          ) : projects.length === 0 ? (
            <div className="text-xs text-gray-400 py-4 text-center">保存されたプロジェクトはまだありません。</div>
          ) : (
            <ul className="space-y-1.5">
              {projects.map((info) => {
                const isCurrent = info.slotId === currentSlotId;
                return (
                  <li
                    key={info.slotId}
                    className={`rounded-lg border p-2.5 flex items-center justify-between gap-3 ${
                      isCurrent ? 'bg-[#1d1a12] border-[#D4AF37]/60' : 'bg-[#151a23] border-[#263345]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-[#F7F6F2] font-medium truncate">{info.title}</span>
                        {isCurrent && (
                          <span className="shrink-0 text-[11px] text-[#0B0D11] bg-[#D4AF37] rounded px-1.5 py-px font-semibold">
                            編集中
                          </span>
                        )}
                      </div>
                      {info.isReadable && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {info.aspectRatio}・{formatLength(info.duration)}・映像 {info.clipCount} 個
                          {formatDate(info.updatedAt) && `・${formatDate(info.updatedAt)} 更新`}
                        </div>
                      )}
                    </div>

                    {confirmingDelete === info.slotId ? (
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="text-xs text-red-200">削除しますか？</span>
                        <button
                          onClick={() => handleDelete(info)}
                          className={`${rowButton} text-red-100 bg-[#4a1a1c] hover:bg-[#641f22] border-[#7f2a2a]`}
                        >
                          削除する
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(null)}
                          className={`${rowButton} text-gray-200 bg-[#1b2332] hover:bg-[#253248] border-[#3a4a60]`}
                        >
                          やめる
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          onClick={() => onOpenProject(info.slotId)}
                          disabled={isCurrent || !info.isReadable || !!busy}
                          className={`${rowButton} text-[#F7E7B4] bg-[#292015] hover:bg-[#3a2c1b] border-[#D4AF37]/60`}
                          title={isCurrent ? 'いま編集しているプロジェクトです' : 'このプロジェクトに切り替える'}
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>開く</span>
                        </button>
                        <button
                          onClick={() => handleDuplicate(info)}
                          disabled={!info.isReadable || !!busy}
                          className={`${rowButton} text-gray-200 bg-[#1b2332] hover:bg-[#253248] border-[#3a4a60]`}
                          title="同じ内容のプロジェクトをもう1つ作る（素材は共有されます）"
                        >
                          <Copy className="w-3 h-3" />
                          <span>複製</span>
                        </button>
                        <button
                          onClick={() => handleBackup(info)}
                          disabled={!info.isReadable || !!busy}
                          className={`${rowButton} text-gray-200 bg-[#1a2523] hover:bg-[#22332f] border-[#3b665c]`}
                          title="素材ごと1つのファイル（.sacred.zip）に保存する。別のパソコンやブラウザでも読み込めます"
                        >
                          <Archive className="w-3 h-3" />
                          <span>バックアップ</span>
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(info.slotId)}
                          disabled={isCurrent || !!busy}
                          className={`${rowButton} text-red-200 bg-[#1b2332] hover:bg-[#2a2030] border-[#3a4a60]`}
                          title={isCurrent ? '編集中のプロジェクトは削除できません' : 'このプロジェクトを削除する'}
                          aria-label="削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* How much is stored, and how safe it is */}
        {storage && (
          <div className="bg-[#171f2d] border border-[#263345] rounded-lg p-3 text-xs text-gray-300 space-y-1.5">
            {storage.usage !== null && (
              <div>
                このブラウザでの保存量: <span className="font-mono text-white">{formatBytes(storage.usage)}</span>
                {storage.quota !== null && <span className="text-gray-400">（上限の目安 {formatBytes(storage.quota)}）</span>}
              </div>
            )}
            {storage.isPersistent === true && (
              <div className="flex items-center space-x-1.5 text-[#86efac]">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>保護されています（ブラウザが自動で消すことはありません）</span>
              </div>
            )}
            {storage.isPersistent === false && (
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-1.5 text-amber-200">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>パソコンの空き容量が少なくなると、ブラウザが保存内容を自動で消すことがあります。</span>
                </div>
                <button
                  onClick={handleProtect}
                  className="shrink-0 px-2 py-1 text-xs text-[#F7E7B4] bg-[#292015] hover:bg-[#3a2c1b] border border-[#D4AF37]/60 rounded"
                >
                  保護を有効にする
                </button>
              </div>
            )}
            <p className="text-gray-400 leading-relaxed">
              ブラウザの「サイトデータの削除」を行うと、保護されていてもすべて消えます。大事なプロジェクトは「バックアップ」でファイルに残してください。
              削除したプロジェクトの素材は、ほかのプロジェクトで使われていなければ 14 日後に消えます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
