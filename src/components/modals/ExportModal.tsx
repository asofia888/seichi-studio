import React, { useEffect, useRef, useState } from 'react';
import { ProjectData, SupportedLanguage } from '../../types';
import type {
  ExportFrameRate,
  ExportProgress,
  ExportResolution,
  SoundtrackLevels,
  WritableFile,
} from '../../services/videoExporter';
import { LOUDNESS_PROFILES } from '../../services/audioEngine';
import { PEAK_CEILING_DB } from '../../services/mastering';
import {
  X,
  Film,
  Download,
  Check,
  RefreshCw,
  AlertCircle,
  Globe,
  Volume2,
} from 'lucide-react';

/** File System Access API (Chrome / Edge): lets the export write straight into a file the user picks */
interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ name: string; createWritable(): Promise<WritableFile> }>;
}
const filePickerWindow = window as unknown as FilePickerWindow;
const canSaveToFile = typeof filePickerWindow.showSaveFilePicker === 'function';
// From this length on, writing straight to a file is offered first: the video never has to fit in memory
const LONG_VIDEO_SEC = 180;

type SaveMode = 'download' | 'file';
const RESOLUTIONS: { value: ExportResolution; label: string; note: string }[] = [
  { value: '1080p', label: '1080p', note: 'フルHD' },
  { value: '2160p', label: '2160p', note: '4K' },
];
const FRAME_RATES: { value: ExportFrameRate; note: string }[] = [
  { value: 24, note: '映画風' },
  { value: 30, note: '標準' },
  { value: 60, note: 'なめらか' },
];

type LoudnessChoice = keyof typeof LOUDNESS_PROFILES | 'off';
const LOUDNESS_CHOICES: LoudnessChoice[] = ['youtube', 'sacred_calm', 'shorts', 'off'];

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

/** e.g. "音量 -14.0 LUFS（+3.2 dB）・ピーク -1.6 dBFS" */
function describeSoundtrack(levels: SoundtrackLevels): string {
  const loudness = levels.lufs === null ? '音量 測定できず（音が小さすぎるか短すぎます）' : `音量 ${levels.lufs.toFixed(1)} LUFS`;
  const gain = levels.gainDb !== 0 ? `（${signed(levels.gainDb)} dB）` : '';
  const peak = Number.isFinite(levels.peakDb) ? `・ピーク ${levels.peakDb.toFixed(1)} dBFS` : '';
  return `${loudness}${gain}${peak}`;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData;
}

interface FinishedExport {
  /** Null when the video was written straight to a file */
  url: string | null;
  fileName: string;
  formatLabel: string;
  warnings: string[];
  soundtrack: SoundtrackLevels | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [exportLang, setExportLang] = useState<SupportedLanguage>('ja');
  const [loudness, setLoudness] = useState<LoudnessChoice>('youtube');
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [fps, setFps] = useState<ExportFrameRate>(30);
  const [saveMode, setSaveMode] = useState<SaveMode>('download');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [finished, setFinished] = useState<FinishedExport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A long video goes straight into a file by default (where the browser allows it)
  useEffect(() => {
    if (isOpen) setSaveMode(canSaveToFile && project.duration >= LONG_VIDEO_SEC ? 'file' : 'download');
  }, [isOpen]);

  if (!isOpen) return null;

  const isLandscape = project.aspectRatio === '16:9';
  const scale = resolution === '2160p' ? 2 : 1;
  const width = (isLandscape ? 1920 : 1080) * scale;
  const height = (isLandscape ? 1080 : 1920) * scale;

  const handleStartExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    setProgress(null);
    if (finished) {
      if (finished.url) URL.revokeObjectURL(finished.url);
      setFinished(null);
    }
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // The encoder library is large, so it is only loaded when an export starts
      const { chooseExportFormat, exportProjectVideo } = await import('../../services/videoExporter');
      const targetLufs = loudness === 'off' ? null : LOUDNESS_PROFILES[loudness].targetLufs;
      const settings = { lang: exportLang, targetLufs, resolution, fps };
      // The format is known before the export, so the save dialog can offer the right file name
      const format = await chooseExportFormat(project, settings);
      const safeName = project.title.replace(/[/\\?%*:|"<>]/g, '_') || 'sanctuary_video';
      const size = resolution === '2160p' ? '_4K' : '';
      let fileName = `${safeName}_${exportLang.toUpperCase()}_${isLandscape ? '16x9' : '9x16'}${size}.${format.fileExtension}`;

      let destination: WritableFile | null = null;
      if (saveMode === 'file' && filePickerWindow.showSaveFilePicker) {
        try {
          const handle = await filePickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: format.fileExtension === 'mp4' ? 'MP4 動画' : 'WebM 動画',
                accept: { [format.mimeType]: [`.${format.fileExtension}`] },
              },
            ],
          });
          destination = await handle.createWritable();
          fileName = handle.name;
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') return; // the save dialog was closed
          throw e;
        }
      }

      const result = await exportProjectVideo(project, { ...settings, format, destination }, setProgress, abort.signal);
      if (!result.blob) {
        setFinished({ url: null, fileName, formatLabel: result.formatLabel, warnings: result.warnings, soundtrack: result.soundtrack });
        return;
      }

      const url = URL.createObjectURL(result.blob);
      setFinished({
        url,
        fileName,
        formatLabel: result.formatLabel,
        warnings: result.warnings,
        soundtrack: result.soundtrack,
      });

      // Auto trigger download
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e: any) {
      if (!abort.signal.aborted) {
        setErrorMessage(`書き出し中にエラーが発生しました: ${e.message}`);
      }
    } finally {
      abortRef.current = null;
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121620] border border-[#2b384c] rounded-xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#212937] pb-3">
          <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-sm">
            <Film className="w-4 h-4" />
            <span>動画書き出し（エンコード）</span>
          </div>
          {!isExporting && (
            <button
              onClick={onClose}
              aria-label="閉じる"
              className="p-1 text-gray-400 hover:text-white rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Video Specs Summary */}
        <div className="bg-[#171f2d] border border-[#263345] rounded-lg p-3 text-xs space-y-1.5 text-gray-300">
          <div className="flex justify-between">
            <span className="text-gray-400">アスペクト比:</span>
            <span className="font-semibold text-white font-mono">
              {project.aspectRatio} ({width} x {height})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">総尺 (デュレーション):</span>
            <span className="font-semibold text-white font-mono">{Math.floor(project.duration)} 秒</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">フレームレート / 形式:</span>
            <span className="font-semibold text-white font-mono">{fps} FPS / MP4 (H.264・AAC)</span>
          </div>
          <p className="text-[10px] text-gray-500 pt-1">
            ※ MP4に対応していないブラウザではWebM形式で書き出します。書き出し中も別のタブに切り替えて構いません。
          </p>
        </div>

        {/* Size, frame rate and where the file goes */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-gray-300 font-medium block">解像度</span>
            <div className="grid grid-cols-2 gap-1">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.value}
                  disabled={isExporting}
                  onClick={() => setResolution(r.value)}
                  className={`py-1 rounded border text-center ${
                    resolution === r.value
                      ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                      : 'bg-[#151c27] border-[#273447] text-gray-400 hover:text-white'
                  }`}
                >
                  <div className="text-[11px] font-mono">{r.label}</div>
                  <div className="text-[10px] opacity-80">{r.note}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-gray-300 font-medium block">フレームレート</span>
            <div className="grid grid-cols-3 gap-1">
              {FRAME_RATES.map((f) => (
                <button
                  key={f.value}
                  disabled={isExporting}
                  onClick={() => setFps(f.value)}
                  className={`py-1 rounded border text-center ${
                    fps === f.value
                      ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                      : 'bg-[#151c27] border-[#273447] text-gray-400 hover:text-white'
                  }`}
                >
                  <div className="text-[11px] font-mono">{f.value}</div>
                  <div className="text-[10px] opacity-80">{f.note}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        {resolution === '2160p' && (
          <p className="text-[10px] text-amber-300/80 -mt-3">
            4K は書き出しに時間がかかり、パソコンによっては対応していません。写真・動画素材も 4K 以上だときれいに仕上がります。
          </p>
        )}
        {canSaveToFile && (
          <div className="space-y-1 text-xs">
            <span className="text-gray-300 font-medium block">保存方法</span>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ['download', 'ダウンロード', '書き出し後にダウンロード'],
                  ['file', '保存先を選んで直接書き込む', '長い動画・4K向け（メモリを使わない）'],
                ] as const
              ).map(([mode, label, note]) => (
                <button
                  key={mode}
                  disabled={isExporting}
                  onClick={() => setSaveMode(mode)}
                  className={`py-1 px-1 rounded border text-center ${
                    saveMode === mode
                      ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                      : 'bg-[#151c27] border-[#273447] text-gray-400 hover:text-white'
                  }`}
                >
                  <div className="text-[11px]">{label}</div>
                  <div className="text-[10px] opacity-80">{note}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Language Selection */}
        <div className="space-y-1.5 text-xs">
          <label className="text-gray-300 font-medium flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>動画内に焼き込む字幕言語を選択:</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { code: 'ja', label: '日本語 (JA)' },
              { code: 'en', label: 'English (EN)' },
            ].map((lang) => (
              <button
                key={lang.code}
                disabled={isExporting}
                onClick={() => setExportLang(lang.code as SupportedLanguage)}
                className={`py-2 px-2.5 rounded border text-center transition-all ${
                  exportLang === lang.code
                    ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                    : 'bg-[#151c27] border-[#273447] text-gray-400 hover:text-white'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loudness of the whole soundtrack */}
        <div className="space-y-1.5 text-xs">
          <label className="text-gray-300 font-medium flex items-center space-x-1.5">
            <Volume2 className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>音量の仕上げ（動画全体の音量をそろえる）:</span>
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {LOUDNESS_CHOICES.map((choice) => (
              <button
                key={choice}
                disabled={isExporting}
                onClick={() => setLoudness(choice)}
                title={choice === 'off' ? 'ミックスした音量のまま書き出します' : LOUDNESS_PROFILES[choice].description}
                className={`py-1.5 px-1 rounded border text-center transition-all ${
                  loudness === choice
                    ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                    : 'bg-[#151c27] border-[#273447] text-gray-400 hover:text-white'
                }`}
              >
                <div className="text-[11px] truncate">{choice === 'off' ? 'そろえない' : LOUDNESS_PROFILES[choice].name}</div>
                <div className="text-[10px] font-mono opacity-80">
                  {choice === 'off' ? 'ミックスのまま' : LOUDNESS_PROFILES[choice].badge}
                </div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            YouTube は -14 LUFS より大きい動画の音量を下げます。どれを選んでも、音割れを防ぐリミッター（ピーク {PEAK_CEILING_DB} dBFS）がかかります。
          </p>
        </div>

        {/* Progress Bar during export */}
        {isExporting && progress && (
          <div className="space-y-2 bg-[#10141d] p-3 rounded-lg border border-[#232c3c]">
            <div className="flex justify-between text-xs">
              <span className="text-gray-300 flex items-center space-x-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#D4AF37]" />
                <span>{progress.statusText}</span>
              </span>
              <span className="font-mono text-[#D4AF37] font-bold">{progress.percentage}%</span>
            </div>
            <div className="w-full bg-[#1b2332] h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] h-full transition-all duration-150"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {errorMessage && !isExporting && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-3 text-xs text-red-200 flex items-start space-x-1.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success message with direct download link */}
        {finished && !isExporting && (
          <div className="space-y-2">
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3 text-xs text-emerald-300 flex items-center justify-between">
              <span className="flex items-center space-x-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>書き出しが完了しました（{finished.formatLabel}）</span>
              </span>
              {finished.url ? (
                <a
                  href={finished.url}
                  download={finished.fileName}
                  className="text-xs font-semibold text-white underline hover:text-[#D4AF37] shrink-0 ml-2"
                >
                  再ダウンロード
                </a>
              ) : (
                <span className="text-[11px] text-emerald-200 shrink-0 ml-2 truncate max-w-[45%]" title={finished.fileName}>
                  保存先: {finished.fileName}
                </span>
              )}
            </div>
            {finished.soundtrack && (
              <div className="bg-[#10141d] border border-[#232c3c] rounded-lg p-2.5 text-[11px] text-gray-300 flex items-center space-x-1.5">
                <Volume2 className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                <span>{describeSoundtrack(finished.soundtrack)}</span>
              </div>
            )}
            {finished.warnings.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 text-[11px] text-amber-200 space-y-1">
                {finished.warnings.map((w, i) => (
                  <div key={i} className="flex items-start space-x-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            disabled={isExporting}
            onClick={handleStartExport}
            className="flex-1 py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded shadow-lg flex items-center justify-center space-x-1.5 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#0B0D11]" />
                <span>動画をレンダリング中...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-[#0B0D11]" />
                <span>動画書き出しを開始 ({project.aspectRatio})</span>
              </>
            )}
          </button>
          {isExporting && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-2.5 bg-[#1b2332] hover:bg-[#2a2030] border border-[#3a4a60] text-gray-200 text-xs font-semibold rounded transition-colors"
            >
              中止
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
