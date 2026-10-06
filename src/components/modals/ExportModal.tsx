import React, { useState } from 'react';
import { ProjectData, SupportedLanguage } from '../../types';
import { exportProjectVideo, ExportProgress } from '../../services/videoExporter';
import {
  X,
  Film,
  Download,
  Check,
  RefreshCw,
  AlertCircle,
  Globe,
  Settings,
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [exportLang, setExportLang] = useState<SupportedLanguage>('ja');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  if (!isOpen) return null;

  const isLandscape = project.aspectRatio === '16:9';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;

  const handleStartExport = async () => {
    setIsExporting(true);
    setDownloadUrl(null);

    try {
      const blob = await exportProjectVideo(project, exportLang, (p) => {
        setProgress(p);
      });

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);

      // Auto trigger download
      const anchor = document.createElement('a');
      anchor.href = url;
      const safeName = project.title.replace(/[/\\?%*:|"<>]/g, '_') || 'sanctuary_video';
      anchor.download = `${safeName}_${exportLang.toUpperCase()}_${project.aspectRatio === '16:9' ? '16x9' : '9x16'}.webm`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e: any) {
      alert(`書き出し中にエラーが発生しました: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121620] border border-[#2b384c] rounded-xl max-w-lg w-full p-5 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#212937] pb-3">
          <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-sm">
            <Film className="w-4 h-4" />
            <span>動画書き出し（エンコード）</span>
          </div>
          {!isExporting && (
            <button
              onClick={onClose}
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
            <span className="text-gray-400">フレームレート / コーデック:</span>
            <span className="font-semibold text-white font-mono">30 FPS / VP9・AAC高品位</span>
          </div>
        </div>

        {/* Language Selection */}
        <div className="space-y-1.5 text-xs">
          <label className="text-gray-300 font-medium flex items-center space-x-1.5">
            <Globe className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>動画内に焼き込む字幕言語を選択:</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { code: 'ja', label: '日本語 (JA)' },
              { code: 'en', label: 'English (EN)' },
              { code: 'th', label: 'ภาษาไทย (TH)' },
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

        {/* Success message with direct download link */}
        {downloadUrl && !isExporting && (
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3 text-xs text-emerald-300 flex items-center justify-between">
            <span className="flex items-center space-x-1.5">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>動画の書き出しとダウンロードが完了しました！</span>
            </span>
            <a
              href={downloadUrl}
              download={`${project.title}_export.webm`}
              className="text-xs font-semibold text-white underline hover:text-[#D4AF37]"
            >
              再ダウンロード
            </a>
          </div>
        )}

        {/* Action Button */}
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
        </div>
      </div>
    </div>
  );
};
