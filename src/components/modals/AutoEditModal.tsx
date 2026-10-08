import React, { useRef, useState } from 'react';
import { ProjectData } from '../../types';
import type { AutoEditProgress, AutoEditSummary } from '../../services/autoEdit';
import { loadClaudeSettings } from '../../services/claudeApi';
import {
  X,
  WandSparkles,
  Upload,
  RefreshCw,
  AlertCircle,
  Check,
  Film,
} from 'lucide-react';

interface AutoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData;
  /** Replace the project with the finished draft (one undo step) */
  onApply: (project: ProjectData) => void;
}

const LANDSCAPE_TARGETS = [
  { sec: 60, label: '1分' },
  { sec: 180, label: '3分' },
  { sec: 300, label: '5分' },
  { sec: 480, label: '8分' },
  { sec: 600, label: '10分' },
];
// 59 seconds keeps "60秒以内" true after rounding
const PORTRAIT_TARGETS = [
  { sec: 30, label: '30秒' },
  { sec: 45, label: '45秒' },
  { sec: 59, label: '60秒以内' },
];

const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
};

export const AutoEditModal: React.FC<AutoEditModalProps> = ({ isOpen, onClose, project, onApply }) => {
  const isLandscape = project.aspectRatio === '16:9';
  const targets = isLandscape ? LANDSCAPE_TARGETS : PORTRAIT_TARGETS;

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [shrineName, setShrineName] = useState('');
  const [notes, setNotes] = useState('');
  const [targetSec, setTargetSec] = useState<number | null>(null);
  const [useClaude, setUseClaude] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AutoEditProgress | null>(null);
  const [summary, setSummary] = useState<AutoEditSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const claudeSettings = loadClaudeSettings();
  const hasApiKey = claudeSettings.apiKey.trim() !== '';
  const willUseClaude = useClaude && hasApiKey;
  // The default follows the aspect ratio, which may change while the dialog is closed
  const target = targets.some((t) => t.sec === targetSec) ? targetSec! : targets[isLandscape ? 1 : 2].sec;
  const canStart = files.length > 0 && !isRunning && (!willUseClaude || shrineName.trim() !== '');

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const videos = Array.from(list).filter((f) => f.type.startsWith('video') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    setFiles((prev) => {
      const known = new Set(prev.map((f) => `${f.name}_${f.size}_${f.lastModified}`));
      return [...prev, ...videos.filter((f) => !known.has(`${f.name}_${f.size}_${f.lastModified}`))];
    });
    setSummary(null);
    setErrorMessage(null);
  };

  const handleStart = async () => {
    setIsRunning(true);
    setErrorMessage(null);
    setSummary(null);
    setProgress({ percentage: 0, statusText: '準備中...' });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      // The video decoding library is large, so it is only loaded when an edit starts
      const { runAutoEdit } = await import('../../services/autoEdit');
      const result = await runAutoEdit(
        files,
        project,
        {
          targetDuration: target,
          shrineName: shrineName.trim(),
          notes,
          claude: willUseClaude ? { apiKey: claudeSettings.apiKey, model: claudeSettings.model } : null,
        },
        setProgress,
        abort.signal
      );
      onApply(result.project);
      setSummary(result.summary);
      setFiles([]);
    } catch (e: any) {
      if (!abort.signal.aborted) {
        setErrorMessage(e?.message || String(e));
      }
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  };

  // The next time the dialog opens, it starts fresh rather than showing the last result
  const handleClose = () => {
    setSummary(null);
    setErrorMessage(null);
    setProgress(null);
    onClose();
  };

  const totalSize = files.reduce((t, f) => t + f.size, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121620] border border-[#2b384c] rounded-xl max-w-xl w-full p-5 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#212937] pb-3">
          <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-sm">
            <WandSparkles className="w-4 h-4" />
            <span>おまかせ編集（動画から下書きを自動作成）</span>
          </div>
          {!isRunning && (
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-white rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {summary ? (
          <AutoEditResult summary={summary} onClose={handleClose} />
        ) : (
          <>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              撮影した動画をまとめて入れると、撮影順に並べ、話している部分は残し、景色の場面はブレの少ない見どころだけを切り出して、指定の長さに編集します。
              解析はこのブラウザの中で行います。
            </p>

            {/* File drop area */}
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (!isRunning) addFiles(e.dataTransfer.files);
              }}
              className={`block border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              } ${isDragging ? 'border-[#D4AF37] bg-[#1d1a12]' : 'border-[#2c3747] hover:border-[#D4AF37]/60 bg-[#151a23]'}`}
            >
              <Upload className="w-5 h-5 mx-auto text-[#D4AF37] mb-1.5" />
              <div className="text-xs text-gray-200">動画ファイルをここにドロップ、またはクリックして選択</div>
              <div className="text-[10px] text-gray-500 mt-0.5">複数選択できます（MP4 / MOV など）</div>
              <input
                type="file"
                accept="video/*"
                multiple
                disabled={isRunning}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {files.length > 0 && (
              <div className="bg-[#151c27] border border-[#263345] rounded-lg p-2.5 text-[11px] space-y-1">
                <div className="flex justify-between text-gray-300">
                  <span className="flex items-center space-x-1">
                    <Film className="w-3.5 h-3.5 text-[#60A5FA]" />
                    <span>{files.length} 本の動画（{(totalSize / 1024 / 1024).toFixed(0)} MB）</span>
                  </span>
                  {!isRunning && (
                    <button onClick={() => setFiles([])} className="text-gray-500 hover:text-red-300">
                      すべて外す
                    </button>
                  )}
                </div>
                <div className="max-h-24 overflow-y-auto text-gray-500 space-y-0.5">
                  {files.map((f) => (
                    <div key={`${f.name}_${f.size}_${f.lastModified}`} className="truncate">
                      {f.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settings */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-gray-300 font-medium">
                  神社・聖地の名前{willUseClaude && <span className="text-[#C84B31]"> *</span>}
                </label>
                <input
                  type="text"
                  value={shrineName}
                  disabled={isRunning}
                  onChange={(e) => setShrineName(e.target.value)}
                  placeholder="例: 戸隠神社 奥社"
                  className="w-full bg-[#151a23] text-[#F7F6F2] px-2.5 py-1.5 rounded border border-[#2c3747] focus:border-[#D4AF37] outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-gray-300 font-medium">
                  仕上がりの長さ（{isLandscape ? '横 16:9' : '縦 9:16'}）
                </label>
                <select
                  value={target}
                  disabled={isRunning}
                  onChange={(e) => setTargetSec(Number(e.target.value))}
                  className="w-full bg-[#151a23] text-[#F7F6F2] px-2 py-1.5 rounded border border-[#2c3747] focus:border-[#D4AF37] outline-none cursor-pointer"
                >
                  {targets.map((t) => (
                    <option key={t.sec} value={t.sec} className="bg-[#151a23]">
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 -mt-1">
              縦横の切り替えはヘッダーのボタンで行えます。話している部分は切らないため、指定より長くなることがあります。
            </p>

            {/* Claude */}
            <div className="bg-[#151c27] border border-[#263345] rounded-lg p-3 space-y-2 text-xs">
              <label className={`flex items-start space-x-2 ${hasApiKey ? 'cursor-pointer' : 'opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={willUseClaude}
                  disabled={!hasApiKey || isRunning}
                  onChange={(e) => setUseClaude(e.target.checked)}
                  className="mt-0.5 accent-[#D4AF37]"
                />
                <span className="text-gray-200">
                  Claude に各場面を見せて、聖地名カード・解説テロップ・参拝作法・チャプター・アクセス案内（日本語と英語）を作らせる
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    {hasApiKey
                      ? 'API の利用料金がかかります（動画の本数が多いほど増えます）。'
                      : 'Claude API キーが未設定です。「翻訳」タブで保存すると使えます。未設定のままでも、並べ替えと切り出しは行えます。'}
                  </span>
                </span>
              </label>
              {willUseClaude && (
                <div className="space-y-1">
                  <label className="text-gray-300 font-medium">メモ（任意・正確な情報があれば）</label>
                  <textarea
                    value={notes}
                    disabled={isRunning}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder={'例: 御祭神は天手力雄命。駐車場は奥社入口に有料150台。\n撮影は10月の早朝、杉並木と随神門を中心に。'}
                    className="w-full bg-[#151a23] text-[#F7F6F2] px-2.5 py-1.5 rounded border border-[#2c3747] focus:border-[#D4AF37] outline-none resize-none text-[11px] leading-relaxed"
                  />
                  <p className="text-[10px] text-gray-500">
                    御祭神・ご利益・アクセス情報は、メモが優先されます。メモにない情報は Claude の知識で埋めるため、公開前に確認してください。
                  </p>
                </div>
              )}
            </div>

            {/* Progress */}
            {isRunning && progress && (
              <div className="space-y-2 bg-[#10141d] p-3 rounded-lg border border-[#232c3c]">
                <div className="flex justify-between text-xs gap-2">
                  <span className="text-gray-300 flex items-center space-x-1 min-w-0">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#D4AF37] shrink-0" />
                    <span className="truncate">{progress.statusText}</span>
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

            {errorMessage && !isRunning && (
              <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-3 text-xs text-red-200 flex items-start space-x-1.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="whitespace-pre-line">{errorMessage}</span>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-1.5">
              <div className="flex space-x-2">
                <button
                  disabled={!canStart}
                  onClick={handleStart}
                  className="flex-1 py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded shadow-lg flex items-center justify-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {isRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>編集中...</span>
                    </>
                  ) : (
                    <>
                      <WandSparkles className="w-4 h-4" />
                      <span>おまかせ編集を開始</span>
                    </>
                  )}
                </button>
                {isRunning && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="px-4 py-2.5 bg-[#1b2332] hover:bg-[#2a2030] border border-[#3a4a60] text-gray-200 text-xs font-semibold rounded transition-colors"
                  >
                    中止
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-500 text-center">
                今のタイムラインは編集結果に置き換わります（Ctrl+Z で元に戻せます）。
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const AutoEditResult: React.FC<{ summary: AutoEditSummary; onClose: () => void }> = ({ summary, onClose }) => {
  const rows: [string, string][] = [
    ['使った動画', `${summary.usedVideos} / ${summary.totalVideos} 本`],
    ['仕上がりの長さ', formatDuration(summary.duration)],
    ['並び順', summary.orderedBy === 'recordedAt' ? '撮影日時の順' : 'ファイル名の順（撮影日時が記録されていない動画があったため）'],
    ['話し声を検出した動画', `${summary.videosWithSpeech} 本（声の部分は切らずに残しました）`],
  ];
  if (summary.claudeUsed) {
    rows.push(['テロップ', `${summary.telopCount} 件と聖地名カード`]);
    rows.push(['チャプター', `${summary.chapterCount} 件`]);
  }
  rows.push(['アクセス案内カード', summary.hasAccessCard ? '撮影場所の座標で作成' : 'なし']);

  return (
    <div className="space-y-3 text-xs">
      <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3 text-emerald-300 flex items-center space-x-1.5">
        <Check className="w-4 h-4 text-emerald-400" />
        <span>下書きができました。タイムラインで確認・手直ししてから書き出してください。</span>
      </div>

      <div className="bg-[#171f2d] border border-[#263345] rounded-lg p-3 space-y-1.5 text-gray-300">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-gray-400 shrink-0">{label}</span>
            <span className="text-right text-white">{value}</span>
          </div>
        ))}
      </div>

      {(summary.claudeUsed || summary.overTarget || summary.claudeError || summary.warnings.length > 0) && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 text-[11px] text-amber-200 space-y-1.5">
          {summary.claudeUsed && (
            <Notice text="御祭神・ご利益・所在地・アクセス情報は Claude が作った下書きです。公開前に、神社の公式情報と照らして必ず確認してください。" />
          )}
          {summary.overTarget && <Notice text="話している部分だけで指定の長さを超えたため、指定より長くなりました。" />}
          {summary.claudeError && (
            <Notice text={`Claude によるテロップ作成に失敗したため、テロップなしで編集しました：${summary.claudeError}`} />
          )}
          {summary.warnings.map((w, i) => (
            <Notice key={i} text={w} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-500">
        BGM を「音声」タブで追加すると、動画の中で話している間は自動で音量が下がります。
      </p>

      <button
        onClick={onClose}
        className="w-full py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded shadow-lg transition-all"
      >
        閉じてタイムラインを確認する
      </button>
    </div>
  );
};

const Notice: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start space-x-1.5">
    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />
    <span>{text}</span>
  </div>
);
