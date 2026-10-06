import React, { useState } from 'react';
import { ProjectData, ChapterItem } from '../../types';
import { generateYouTubeDescription } from '../../services/srtExporter';
import {
  ListOrdered,
  Plus,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Bookmark,
} from 'lucide-react';

interface ChaptersPanelProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  currentTime: number;
}

export const ChaptersPanel: React.FC<ChaptersPanelProps> = ({
  project,
  onUpdateProject,
  currentTime,
}) => {
  const [copied, setCopied] = useState(false);
  const [newTitleJa, setNewTitleJa] = useState('');

  const handleAddChapterAtCurrent = () => {
    const title = newTitleJa.trim() || `チャプター (${Math.floor(currentTime)}s)`;
    const newChapter: ChapterItem = {
      id: `ch_${Date.now()}`,
      timeSec: Math.floor(currentTime),
      title: {
        ja: title,
        en: title,
        th: title,
      },
    };

    const updated = [...project.chapters, newChapter].sort((a, b) => a.timeSec - b.timeSec);
    onUpdateProject({
      ...project,
      chapters: updated,
      updatedAt: new Date().toISOString(),
    });
    setNewTitleJa('');
  };

  const handleDeleteChapter = (id: string) => {
    onUpdateProject({
      ...project,
      chapters: project.chapters.filter((c) => c.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateChapter = (id: string, patch: Partial<ChapterItem>) => {
    const updated = project.chapters.map((c) =>
      c.id === id ? { ...c, ...patch } : c
    );
    onUpdateProject({
      ...project,
      chapters: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  // Generate full YouTube description
  const primaryAccess = project.accessCards[0];
  const descriptionText = generateYouTubeDescription(project.chapters, project.title, {
    name: primaryAccess ? primaryAccess.sanctuaryName.ja : project.title,
    address: primaryAccess ? primaryAccess.address.ja : '',
    deities: '御祭神情報は動画内テロップをご参照ください',
  });

  const handleCopyDescription = () => {
    navigator.clipboard.writeText(descriptionText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-6 text-sm text-[#E2E8F0]">
      {/* 1. Add Chapter */}
      <div className="bg-[#141924] border border-[#232d3d] rounded-lg p-3.5 space-y-3">
        <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5 text-xs">
          <ListOrdered className="w-4 h-4" />
          <span>チャプターの追加（現在位置: {Math.floor(currentTime)}s）</span>
        </span>

        <div className="flex space-x-2">
          <input
            type="text"
            placeholder="例: 樹齢四百年の杉並木と随神門"
            value={newTitleJa}
            onChange={(e) => setNewTitleJa(e.target.value)}
            className="flex-1 bg-[#1a2331] border border-[#2b384c] rounded px-3 py-1.5 text-xs text-white outline-none focus:border-[#D4AF37]"
          />
          <button
            onClick={handleAddChapterAtCurrent}
            className="px-3 py-1.5 bg-[#D4AF37] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded flex items-center space-x-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>追加</span>
          </button>
        </div>
      </div>

      {/* 2. Chapters List */}
      <div>
        <span className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider block mb-2">
          チャプター一覧 ({project.chapters.length}件)
        </span>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {project.chapters.map((ch) => {
            const mins = Math.floor(ch.timeSec / 60);
            const secs = Math.floor(ch.timeSec % 60);
            const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            return (
              <div
                key={ch.id}
                className="bg-[#121620] border border-[#212937] rounded p-2 flex items-center justify-between text-xs"
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className="font-mono text-[#D4AF37] bg-[#1a2230] px-1.5 py-0.5 rounded text-[11px]">
                    {timeStr}
                  </span>
                  <input
                    type="text"
                    value={ch.title.ja}
                    onChange={(e) =>
                      handleUpdateChapter(ch.id, {
                        title: { ...ch.title, ja: e.target.value },
                      })
                    }
                    className="bg-transparent border-b border-transparent focus:border-[#D4AF37] text-white outline-none text-xs w-52 truncate"
                  />
                </div>

                <button
                  onClick={() => handleDeleteChapter(ch.id)}
                  className="text-gray-500 hover:text-red-400 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. YouTube Description Preview & Copy */}
      <div className="bg-[#141924] border border-[#232d3d] rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#CBD5E1] flex items-center space-x-1.5 text-xs">
            <Bookmark className="w-4 h-4 text-[#60A5FA]" />
            <span>YouTube概要欄 タイムスタンプ生成</span>
          </span>
          <button
            onClick={handleCopyDescription}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-[#1e293b] hover:bg-[#28374e] border border-[#334155] rounded text-emerald-400 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'コピー完了！' : '全文コピー'}</span>
          </button>
        </div>

        <p className="text-[11px] text-[#8A99AD]">
          YouTubeにアップロードする際、動画の概要欄にそのまま貼り付けることで動画内にチャプターが自動反映されます。
        </p>

        <textarea
          rows={7}
          readOnly
          value={descriptionText}
          className="w-full bg-[#0d1017] border border-[#202938] rounded p-2.5 text-xs text-gray-300 font-mono resize-none leading-relaxed"
        />
      </div>
    </div>
  );
};
