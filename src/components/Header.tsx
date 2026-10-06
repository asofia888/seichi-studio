import React from 'react';
import { ProjectData, SupportedLanguage } from '../types';
import { exportProjectAsJSON } from '../services/storage';
import { shrinePresets } from '../services/sampleData';
import {
  Sparkles,
  Download,
  Upload,
  Image as ImageIcon,
  Film,
  Globe,
  Monitor,
  Smartphone,
  Save,
  Undo2,
  Redo2,
  Keyboard,
  Compass,
} from 'lucide-react';

interface HeaderProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  previewLang: SupportedLanguage;
  onChangePreviewLang: (lang: SupportedLanguage) => void;
  onOpenThumbnailModal: () => void;
  onOpenExportModal: () => void;
  onOpenShortcutsModal?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  onUpdateProject,
  previewLang,
  onChangePreviewLang,
  onOpenThumbnailModal,
  onOpenExportModal,
  onOpenShortcutsModal,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateProject({ ...project, title: e.target.value, updatedAt: new Date().toISOString() });
  };

  const handleToggleAspectRatio = () => {
    const nextRatio = project.aspectRatio === '16:9' ? '9:16' : '16:9';
    onUpdateProject({ ...project, aspectRatio: nextRatio, updatedAt: new Date().toISOString() });
  };

  const handleSaveJson = () => {
    exportProjectAsJSON(project);
  };

  const handleLoadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loaded = JSON.parse(event.target?.result as string);
        if (loaded && loaded.title) {
          onUpdateProject(loaded);
        }
      } catch (err) {
        alert('プロジェクトファイルの読み込みに失敗しました。有効なJSONファイルかご確認ください。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="h-14 bg-[#0e1117] border-b border-[#222934] px-4 flex items-center justify-between z-20 select-none">
      {/* Brand & Project Title */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-base tracking-wider">
          <span className="text-xl">⛩️</span>
          <span className="font-serif-jp hidden sm:inline">聖地巡礼動画スタジオ</span>
        </div>

        <div className="h-5 w-px bg-[#262f3d]" />

        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={project.title}
            onChange={handleTitleChange}
            className="bg-[#151a23] hover:bg-[#1b222d] focus:bg-[#1d2532] text-sm text-[#F7F6F2] font-serif-jp px-3 py-1 rounded border border-[#2c3747] focus:border-[#D4AF37] outline-none transition-all w-52 md:w-72 truncate"
            title="プロジェクト名をクリックして変更"
          />

          {/* Shrine Preset Dropdown */}
          <select
            onChange={(e) => {
              const selected = shrinePresets.find((p) => p.id === e.target.value);
              if (selected) {
                if (window.confirm(`聖地プリセット「${selected.name}」を読み込みますか？ 現在の編集内容は上書きされます。`)) {
                  onUpdateProject({ ...selected.data, updatedAt: new Date().toISOString() });
                }
              }
              e.target.value = '';
            }}
            defaultValue=""
            className="hidden lg:block bg-[#151a23] hover:bg-[#1c2432] text-xs text-[#E8D595] border border-[#2c3747] rounded px-2 py-1 outline-none cursor-pointer max-w-[150px] truncate"
            title="神社・聖地プリセットを読み込み"
          >
            <option value="" disabled>聖地プリセット読込</option>
            {shrinePresets.map((preset) => (
              <option key={preset.id} value={preset.id} className="bg-[#121620]">
                {preset.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Control Actions */}
      <div className="flex items-center space-x-2">
        {/* 16:9 vs 9:16 Ratio Switcher */}
        <button
          onClick={handleToggleAspectRatio}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium border transition-colors ${
            project.aspectRatio === '16:9'
              ? 'bg-[#1a222e] text-[#D4AF37] border-[#D4AF37]/50 shadow-sm'
              : 'bg-[#241a22] text-[#F39C12] border-[#F39C12]/50 shadow-sm'
          }`}
          title="アスペクト比切替 (横16:9 YouTube通常 ↔ 縦9:16 YouTube Shorts)"
        >
          {project.aspectRatio === '16:9' ? (
            <>
              <Monitor className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>横 16:9 通常</span>
            </>
          ) : (
            <>
              <Smartphone className="w-3.5 h-3.5 text-[#F39C12]" />
              <span>縦 9:16 ショート</span>
            </>
          )}
        </button>

        {/* Display Preview Language */}
        <div className="flex items-center bg-[#151a23] border border-[#2c3747] rounded px-2 py-1 space-x-1">
          <Globe className="w-3.5 h-3.5 text-[#D4AF37]" />
          <select
            value={previewLang}
            onChange={(e) => onChangePreviewLang(e.target.value as SupportedLanguage)}
            className="bg-transparent text-xs text-[#F7F6F2] outline-none cursor-pointer"
            title="プレビュー表示言語 (多言語字幕の確認)"
          >
            <option value="ja" className="bg-[#151a23]">日本語 (JA)</option>
            <option value="en" className="bg-[#151a23]">English (EN)</option>
            <option value="th" className="bg-[#151a23]">ภาษาไทย (TH)</option>
          </select>
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center space-x-0.5 bg-[#151a23] border border-[#2c3747] rounded p-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1 rounded text-[#c9cbcf] hover:text-white disabled:opacity-30 disabled:hover:text-[#c9cbcf] hover:bg-[#202734] transition-colors cursor-pointer disabled:cursor-not-allowed"
            title="元に戻す (Ctrl+Z / Cmd+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1 rounded text-[#c9cbcf] hover:text-white disabled:opacity-30 disabled:hover:text-[#c9cbcf] hover:bg-[#202734] transition-colors cursor-pointer disabled:cursor-not-allowed"
            title="やり直す (Ctrl+Y / Cmd+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Project JSON Save/Load */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleSaveJson}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs text-[#c9cbcf] hover:text-white bg-[#151a23] hover:bg-[#202734] border border-[#2c3747] rounded transition-colors"
            title="プロジェクト保存 (JSONファイル書き出し)"
          >
            <Save className="w-3.5 h-3.5 text-[#A0AEC0]" />
            <span className="hidden md:inline">保存</span>
          </button>

          <label
            className="flex items-center space-x-1 px-2.5 py-1 text-xs text-[#c9cbcf] hover:text-white bg-[#151a23] hover:bg-[#202734] border border-[#2c3747] rounded cursor-pointer transition-colors"
            title="プロジェクト再開 (JSONファイル読み込み)"
          >
            <Upload className="w-3.5 h-3.5 text-[#A0AEC0]" />
            <span className="hidden md:inline">読込</span>
            <input type="file" accept=".json" onChange={handleLoadJson} className="hidden" />
          </label>
        </div>

        {/* Shortcuts Helper */}
        {onOpenShortcutsModal && (
          <button
            onClick={onOpenShortcutsModal}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs text-[#c9cbcf] hover:text-white bg-[#151a23] hover:bg-[#202734] border border-[#2c3747] rounded transition-colors"
            title="キーボードショートカット一覧 (?)"
          >
            <Keyboard className="w-3.5 h-3.5 text-[#A0AEC0]" />
            <span className="hidden xl:inline">操作</span>
          </button>
        )}

        {/* Thumbnail Generator */}
        <button
          onClick={onOpenThumbnailModal}
          className="flex items-center space-x-1.5 px-3 py-1 text-xs font-medium text-[#F7F6F2] bg-[#1a2523] hover:bg-[#22332f] border border-[#3b665c] rounded transition-colors shadow-sm"
          title="現在のプレビュー画面からYouTubeサムネイル作成"
        >
          <ImageIcon className="w-3.5 h-3.5 text-[#50C878]" />
          <span>サムネイル</span>
        </button>

        {/* Video Export */}
        <button
          onClick={onOpenExportModal}
          className="flex items-center space-x-1.5 px-3.5 py-1 text-xs font-semibold text-[#0B0D11] bg-gradient-to-r from-[#E5C07B] to-[#D4AF37] hover:brightness-110 rounded transition-all shadow-md"
          title="完成した動画を書き出し"
        >
          <Film className="w-3.5 h-3.5 text-[#0B0D11]" />
          <span>書き出し</span>
        </button>
      </div>
    </header>
  );
};
