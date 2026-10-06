import React, { useState } from 'react';
import { ProjectData, GlossaryItem, MultilingualSubtitleItem, SupportedLanguage } from '../../types';
import type { ProjectUpdate } from '../../services/projectHistory';
import {
  translateWithClaude,
  CLAUDE_MODELS,
  ClaudeModelId,
  loadClaudeSettings,
  saveClaudeApiKey,
  saveClaudeModel,
} from '../../services/claudeApi';
import { downloadSRTFile } from '../../services/srtExporter';
import {
  Globe,
  Key,
  BookOpen,
  Sparkles,
  Download,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface TranslationPanelProps {
  project: ProjectData;
  onUpdateProject: (update: ProjectUpdate) => void;
}

export const TranslationPanel: React.FC<TranslationPanelProps> = ({
  project,
  onUpdateProject,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(() => loadClaudeSettings().apiKey);
  const [savedApiKey, setSavedApiKey] = useState(() => loadClaudeSettings().apiKey);
  const [model, setModel] = useState<ClaudeModelId>(() => loadClaudeSettings().model);
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translatingIndex, setTranslatingIndex] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Glossary new item state
  const [newJaTerm, setNewJaTerm] = useState('');
  const [newEnTerm, setNewEnTerm] = useState('');

  // Save API Key to this browser only (kept out of the project file)
  const handleSaveApiKey = () => {
    saveClaudeApiKey(apiKeyInput);
    setSavedApiKey(apiKeyInput.trim());
    setStatusMessage('Claude APIキーをブラウザ内に保存しました。');
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Add term to sacred glossary
  const handleAddGlossaryTerm = () => {
    if (!newJaTerm.trim() || !newEnTerm.trim()) return;

    const newItem: GlossaryItem = {
      id: `glossary_${Date.now()}`,
      japanese: newJaTerm.trim(),
      english: newEnTerm.trim(),
    };

    onUpdateProject({
      ...project,
      glossary: [...project.glossary, newItem],
      updatedAt: new Date().toISOString(),
    });

    setNewJaTerm('');
    setNewEnTerm('');
  };

  const handleDeleteGlossaryTerm = (id: string) => {
    onUpdateProject({
      ...project,
      glossary: project.glossary.filter((g) => g.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  // Write translations into the latest project (translating takes seconds per line and the user
  // may keep editing). A line whose Japanese was changed or that was deleted meanwhile is left alone.
  const applyTranslations = (results: { id: string; ja: string; en: string }[]) => {
    onUpdateProject((prev) => ({
      ...prev,
      subtitles: prev.subtitles.map((s) => {
        const result = results.find((r) => r.id === s.id);
        return result && s.text.ja === result.ja ? { ...s, text: { ...s.text, en: result.en } } : s;
      }),
      updatedAt: new Date().toISOString(),
    }));
  };

  // Translate a single subtitle
  const handleTranslateSingle = async (sub: MultilingualSubtitleItem, index: number) => {
    setTranslatingIndex(index);
    try {
      const en = await translateWithClaude(sub.text.ja, savedApiKey, model, project.glossary);
      applyTranslations([{ id: sub.id, ja: sub.text.ja, en }]);
    } catch (err: any) {
      alert(`翻訳エラー: ${err.message}`);
    } finally {
      setTranslatingIndex(null);
    }
  };

  // Translate all subtitles batch
  const handleTranslateAll = async () => {
    if (project.subtitles.length === 0) return;
    setIsTranslatingAll(true);
    setStatusMessage('Claude APIで英語に翻訳中...');

    const lines = project.subtitles.map((sub, index) => ({ sub, index })).filter(({ sub }) => sub.text.ja);
    const results: { id: string; ja: string; en: string }[] = [];
    try {
      for (const { sub, index } of lines) {
        setTranslatingIndex(index);
        const en = await translateWithClaude(sub.text.ja, savedApiKey, model, project.glossary);
        results.push({ id: sub.id, ja: sub.text.ja, en });
      }

      setStatusMessage('すべての解説テロップの英語翻訳が完了しました！');
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (e: any) {
      setStatusMessage(null);
      alert(`${results.length}行を翻訳したところでエラーが発生しました（翻訳済みの行は反映されます）:\n${e.message}`);
    } finally {
      // Keep the lines that finished, even if a later line failed
      if (results.length > 0) {
        applyTranslations(results);
      }
      setIsTranslatingAll(false);
      setTranslatingIndex(null);
    }
  };

  // Update text directly in line-by-line review
  const handleTextChange = (subId: string, lang: SupportedLanguage, value: string) => {
    const updated = project.subtitles.map((s) => {
      if (s.id !== subId) return s;
      return {
        ...s,
        text: {
          ...s.text,
          [lang]: value,
        },
      };
    });
    onUpdateProject({
      ...project,
      subtitles: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-6 text-sm text-[#E2E8F0]">
      {/* 1. Claude API Key Settings */}
      <div className="bg-[#121722] border border-[#222c3d] rounded-lg p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#D4AF37] flex items-center space-x-1.5">
            <Key className="w-4 h-4" />
            <span>Claude API 設定 (ブラウザ内保管)</span>
          </span>
          <span className="text-[10px] text-gray-400">Anthropic Messages API</span>
        </div>

        <p className="text-[11px] text-[#8A99AD] leading-relaxed">
          APIキーはこのブラウザ内にのみ保存され、翻訳時にAnthropicのAPIへ直接送信されます。プロジェクトの保存ファイル（JSON）には含まれません。
        </p>

        <div className="flex items-center space-x-2">
          <input
            type="password"
            placeholder="sk-ant-api03-..."
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="flex-1 bg-[#1a2331] border border-[#2d3a4e] rounded px-3 py-1.5 text-xs text-white outline-none focus:border-[#D4AF37] font-mono"
          />
          <button
            onClick={handleSaveApiKey}
            className="px-3 py-1.5 bg-[#D4AF37] hover:brightness-110 text-[#0B0D11] text-xs font-semibold rounded shrink-0 transition-all"
          >
            保存
          </button>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <label htmlFor="claude-model" className="text-[#8A99AD] shrink-0">
            翻訳モデル:
          </label>
          <select
            id="claude-model"
            value={model}
            onChange={(e) => {
              const next = e.target.value as ClaudeModelId;
              setModel(next);
              saveClaudeModel(next);
            }}
            className="flex-1 bg-[#1a2331] border border-[#2d3a4e] rounded px-2 py-1.5 text-xs text-white outline-none focus:border-[#D4AF37]"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#151a23]">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {statusMessage && (
          <div className="text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded px-2.5 py-1 flex items-center space-x-1">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* 2. Sacred Sanctuary Glossary (用語集) */}
      <div className="bg-[#121722] border border-[#222c3d] rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#D4AF37] flex items-center space-x-1.5">
            <BookOpen className="w-4 h-4" />
            <span>神社・聖地 固有名詞 用語集 ({project.glossary.length}件)</span>
          </span>
          <span className="text-[10px] text-amber-300/80">表記ゆれ防止</span>
        </div>

        <p className="text-[11px] text-[#8A99AD] leading-relaxed">
          御祭神や聖地名の表記ルールを登録すると、Claude翻訳時に自動的に指定表記で統一されます。
        </p>

        {/* Existing Glossary Items */}
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {project.glossary.map((g) => (
            <div
              key={g.id}
              className="bg-[#18202d] border border-[#263345] rounded p-2 text-xs flex items-center justify-between"
            >
              <div className="space-y-0.5 truncate">
                <div className="font-semibold text-white truncate font-serif-jp">{g.japanese}</div>
                <div className="text-[10px] text-[#A0AEC0] truncate">
                  EN: <span className="text-[#93C5FD]">{g.english}</span>
                </div>
              </div>
              <button
                onClick={() => handleDeleteGlossaryTerm(g.id)}
                className="text-gray-500 hover:text-red-400 p-1 shrink-0"
                title="削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add new term */}
        <div className="pt-2 border-t border-[#202938] space-y-2">
          <span className="text-[11px] font-medium text-gray-300 block">新規用語の登録:</span>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              placeholder="日本語 (例: 天照大御神)"
              value={newJaTerm}
              onChange={(e) => setNewJaTerm(e.target.value)}
              className="bg-[#1a2331] border border-[#2b384c] rounded px-2 py-1 text-xs text-white"
            />
            <input
              type="text"
              placeholder="英語 (Amaterasu-Ōmikami)"
              value={newEnTerm}
              onChange={(e) => setNewEnTerm(e.target.value)}
              className="bg-[#1a2331] border border-[#2b384c] rounded px-2 py-1 text-xs text-white"
            />
          </div>
          <button
            onClick={handleAddGlossaryTerm}
            className="w-full py-1 bg-[#1e293b] hover:bg-[#28374f] text-[#E2E8F0] border border-[#334155] rounded text-xs flex items-center justify-center space-x-1"
          >
            <Plus className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>用語を追加</span>
          </button>
        </div>
      </div>

      {/* 3. Batch Translate & SRT Download Actions */}
      <div className="flex items-center space-x-2">
        <button
          onClick={handleTranslateAll}
          disabled={isTranslatingAll}
          className="flex-1 py-2 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded shadow flex items-center justify-center space-x-1.5 disabled:opacity-50"
        >
          {isTranslatingAll ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-[#0B0D11]" />
              <span>翻訳中 ({translatingIndex !== null ? `${translatingIndex + 1}/${project.subtitles.length}` : ''})...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-[#0B0D11]" />
              <span>全テロップを一括翻訳 (EN)</span>
            </>
          )}
        </button>
      </div>

      {/* SRT Download Section */}
      <div className="bg-[#131924] border border-[#242f40] rounded-lg p-3 space-y-2">
        <span className="text-xs font-semibold text-[#CBD5E1] flex items-center space-x-1">
          <FileText className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>YouTube用 SRT字幕ファイルの書き出し</span>
        </span>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => downloadSRTFile(project.subtitles, 'ja', project.title)}
            className="py-1.5 px-2 bg-[#1b2434] hover:bg-[#232f44] border border-[#32435e] rounded text-xs text-white flex items-center justify-center space-x-1"
          >
            <Download className="w-3 h-3 text-[#D4AF37]" />
            <span>日本語 SRT</span>
          </button>
          <button
            onClick={() => downloadSRTFile(project.subtitles, 'en', project.title)}
            className="py-1.5 px-2 bg-[#1b2434] hover:bg-[#232f44] border border-[#32435e] rounded text-xs text-white flex items-center justify-center space-x-1"
          >
            <Download className="w-3 h-3 text-[#60A5FA]" />
            <span>英語 SRT</span>
          </button>
        </div>
      </div>

      {/* 4. Line-by-Line Review & Inline Editing */}
      <div className="space-y-3">
        <span className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider block">
          行ごとの翻訳確認・直接修正 ({project.subtitles.length}行)
        </span>

        <div className="space-y-3">
          {project.subtitles.map((sub, idx) => (
            <div
              key={sub.id}
              className="bg-[#121620] border border-[#212a38] rounded-lg p-3 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between text-[11px] text-[#718096] border-b border-[#1b222e] pb-1.5">
                <span className="font-mono text-[#D4AF37]">
                  #{idx + 1} ({sub.startTime}s - {(sub.startTime + sub.duration).toFixed(1)}s)
                </span>
                <button
                  onClick={() => handleTranslateSingle(sub, idx)}
                  disabled={translatingIndex === idx}
                  className="flex items-center space-x-1 text-[#60A5FA] hover:text-[#93C5FD] transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${translatingIndex === idx ? 'animate-spin' : ''}`} />
                  <span>この行だけ再翻訳</span>
                </button>
              </div>

              {/* Japanese Original */}
              <div>
                <span className="text-[10px] text-[#D4AF37] block mb-0.5">🇯🇵 日本語（原文）:</span>
                <input
                  type="text"
                  value={sub.text.ja}
                  onChange={(e) => handleTextChange(sub.id, 'ja', e.target.value)}
                  className="w-full bg-[#18202d] border border-[#283547] rounded px-2.5 py-1.5 text-white font-serif-jp text-xs outline-none focus:border-[#D4AF37]"
                />
              </div>

              {/* English Translation */}
              <div>
                <span className="text-[10px] text-[#60A5FA] block mb-0.5">🇬🇧 英語（English）:</span>
                <input
                  type="text"
                  value={sub.text.en || ''}
                  onChange={(e) => handleTextChange(sub.id, 'en', e.target.value)}
                  placeholder="English translation..."
                  className="w-full bg-[#18202d] border border-[#283547] rounded px-2.5 py-1.5 text-white text-xs outline-none focus:border-[#60A5FA]"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
