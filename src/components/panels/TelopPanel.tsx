import React, { useState } from 'react';
import { ProjectData, MultilingualSubtitleItem, SubtitleCategory } from '../../types';
import {
  Type,
  Plus,
  Trash2,
  Bookmark,
  MessageSquare,
  Sparkles,
  HelpCircle,
} from 'lucide-react';

interface TelopPanelProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  selectedSubId: string | null;
  onSelectSubtitle: (id: string) => void;
  currentTime: number;
}

export const TelopPanel: React.FC<TelopPanelProps> = ({
  project,
  onUpdateProject,
  selectedSubId,
  onSelectSubtitle,
  currentTime,
}) => {
  const [activeCategory, setActiveCategory] = useState<SubtitleCategory>('commentary');

  const selectedSub = project.subtitles.find((s) => s.id === selectedSubId);

  // Add new telop at current playhead time
  const handleAddTelop = (category: SubtitleCategory) => {
    let newSub: MultilingualSubtitleItem;

    if (category === 'sanctuary_header') {
      newSub = {
        id: `sub_${Date.now()}`,
        startTime: Math.floor(currentTime * 10) / 10,
        duration: 7,
        category: 'sanctuary_header',
        text: { ja: '新規 聖地名', en: '' },
        sanctuaryMeta: {
          name: { ja: '新規 聖地名', en: '' },
          location: { ja: '都道府県・市区町村', en: '' },
          deity: { ja: '御祭神名', en: '' },
          blessing: { ja: '開運・心願成就', en: '' },
        },
      };
    } else if (category === 'etiquette_tip') {
      newSub = {
        id: `sub_${Date.now()}`,
        startTime: Math.floor(currentTime * 10) / 10,
        duration: 6,
        category: 'etiquette_tip',
        text: { ja: '参拝作法の心得を入力', en: '' },
        etiquetteTip: {
          title: { ja: '参拝の作法心得', en: 'Worship Etiquette' },
          detail: { ja: '二礼二拍手一礼の作法で静かに拝礼します。', en: '' },
        },
      };
    } else {
      newSub = {
        id: `sub_${Date.now()}`,
        startTime: Math.floor(currentTime * 10) / 10,
        duration: 6,
        category: 'commentary',
        text: { ja: '静謐な神域の解説文をここに入力します。', en: '' },
      };
    }

    const updated = [...project.subtitles, newSub].sort((a, b) => a.startTime - b.startTime);
    onUpdateProject({
      ...project,
      subtitles: updated,
      updatedAt: new Date().toISOString(),
    });
    onSelectSubtitle(newSub.id);
  };

  const handleUpdateSelected = (patch: Partial<MultilingualSubtitleItem>) => {
    if (!selectedSub) return;
    const updated = project.subtitles.map((s) =>
      s.id === selectedSub.id ? { ...s, ...patch } : s
    );
    onUpdateProject({
      ...project,
      subtitles: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDelete = (id: string) => {
    const updated = project.subtitles.filter((s) => s.id !== id);
    onUpdateProject({
      ...project,
      subtitles: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-5 text-sm text-[#E2E8F0]">
      {/* Telop Template Buttons */}
      <div>
        <span className="text-xs font-semibold text-[#D4AF37] uppercase tracking-wider block mb-2 flex items-center space-x-1.5">
          <Type className="w-4 h-4" />
          <span>定型テロップの追加（現在位置 {currentTime.toFixed(1)}s）</span>
        </span>

        <div className="grid grid-cols-1 gap-2">
          {/* Template 1: 聖地名カード */}
          <button
            onClick={() => handleAddTelop('sanctuary_header')}
            className="p-2.5 bg-[#1e1913] hover:bg-[#2c241b] border border-[#785b28] rounded-lg text-left transition-all flex items-start space-x-2.5 group cursor-pointer"
          >
            <Bookmark className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[#F7E7B4] group-hover:text-white">
                ① 聖地名カード（名称・所在地・御祭神・ご利益）
              </div>
              <div className="text-[11px] text-[#A39276] mt-0.5">
                神社名や御祭神を格調高く金枠の銘板風に表示
              </div>
            </div>
          </button>

          {/* Template 2: 解説テロップ */}
          <button
            onClick={() => handleAddTelop('commentary')}
            className="p-2.5 bg-[#141b25] hover:bg-[#1c2635] border border-[#2b3d54] rounded-lg text-left transition-all flex items-start space-x-2.5 group cursor-pointer"
          >
            <MessageSquare className="w-4 h-4 text-[#60A5FA] shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[#BFDBFE] group-hover:text-white">
                ② 解説テロップ（下部字幕）
              </div>
              <div className="text-[11px] text-[#7E96B5] mt-0.5">
                漆黒半透明の帯と上品な明朝体による解説テロップ
              </div>
            </div>
          </button>

          {/* Template 3: 参拝作法注釈 */}
          <button
            onClick={() => handleAddTelop('etiquette_tip')}
            className="p-2.5 bg-[#201515] hover:bg-[#2e1d1d] border border-[#6b3131] rounded-lg text-left transition-all flex items-start space-x-2.5 group cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#F87171] shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[#FECACA] group-hover:text-white">
                ③ 参拝のポイント／作法の注釈
              </div>
              <div className="text-[11px] text-[#B87D7D] mt-0.5">
                朱色の札による「手水の清め」「二礼二拍手一礼」等の作法案内
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Telop List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider">
            配置済みテロップ一覧 ({project.subtitles.length}件)
          </span>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {project.subtitles.map((sub, index) => {
            const isSelected = sub.id === selectedSubId;
            return (
              <div
                key={sub.id}
                onClick={() => onSelectSubtitle(sub.id)}
                className={`p-2 rounded border flex items-center justify-between cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#1e2838] border-[#D4AF37] text-white'
                    : 'bg-[#12161f] border-[#202734] hover:bg-[#181f2c] text-[#CBD5E1]'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className="text-[10px] text-[#718096] font-mono">{sub.startTime}s</span>
                  <span className="text-xs truncate font-medium">
                    {sub.category === 'sanctuary_header' && '⛩️ [聖地] '}
                    {sub.category === 'etiquette_tip' && '📜 [作法] '}
                    {sub.text.ja}
                  </span>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(sub.id);
                    }}
                    className="p-1 hover:text-red-400 text-gray-500 rounded"
                    title="削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Telop Editor */}
      {selectedSub && (
        <div className="border border-[#293548] rounded-lg p-3 bg-[#131924] space-y-3">
          <div className="flex items-center justify-between border-b border-[#212b3c] pb-2">
            <span className="text-xs font-semibold text-[#D4AF37]">
              選択中のテロップ編集 ({selectedSub.category})
            </span>
            <span className="text-[10px] text-gray-400 font-mono">
              {selectedSub.startTime}s 〜 {(selectedSub.startTime + selectedSub.duration).toFixed(1)}s
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[#8A99AD] block mb-1">開始時間 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={selectedSub.startTime}
                onChange={(e) =>
                  handleUpdateSelected({ startTime: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[#8A99AD] block mb-1">表示秒数 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={selectedSub.duration}
                onChange={(e) =>
                  handleUpdateSelected({ duration: Math.max(1, parseFloat(e.target.value) || 1) })
                }
                className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
          </div>

          {/* Form depending on template category */}
          {selectedSub.category === 'sanctuary_header' && selectedSub.sanctuaryMeta && (
            <div className="space-y-2 text-xs pt-1">
              <div>
                <label className="text-[#D4AF37] block font-medium mb-1">聖地名 (日本語)</label>
                <input
                  type="text"
                  value={selectedSub.sanctuaryMeta.name.ja}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleUpdateSelected({
                      text: { ...selectedSub.text, ja: val },
                      sanctuaryMeta: {
                        ...selectedSub.sanctuaryMeta!,
                        name: { ...selectedSub.sanctuaryMeta!.name, ja: val },
                      },
                    });
                  }}
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2.5 py-1.5 text-white font-serif-jp"
                />
              </div>

              <div>
                <label className="text-[#CBD5E1] block mb-1">所在地 (住所・地域)</label>
                <input
                  type="text"
                  value={selectedSub.sanctuaryMeta.location.ja}
                  onChange={(e) =>
                    handleUpdateSelected({
                      sanctuaryMeta: {
                        ...selectedSub.sanctuaryMeta!,
                        location: { ...selectedSub.sanctuaryMeta!.location, ja: e.target.value },
                      },
                    })
                  }
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2.5 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-[#CBD5E1] block mb-1">御祭神 (主祭神・配神)</label>
                <input
                  type="text"
                  value={selectedSub.sanctuaryMeta.deity.ja}
                  onChange={(e) =>
                    handleUpdateSelected({
                      sanctuaryMeta: {
                        ...selectedSub.sanctuaryMeta!,
                        deity: { ...selectedSub.sanctuaryMeta!.deity, ja: e.target.value },
                      },
                    })
                  }
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2.5 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-[#CBD5E1] block mb-1">ご利益 (神徳)</label>
                <input
                  type="text"
                  value={selectedSub.sanctuaryMeta.blessing.ja}
                  onChange={(e) =>
                    handleUpdateSelected({
                      sanctuaryMeta: {
                        ...selectedSub.sanctuaryMeta!,
                        blessing: { ...selectedSub.sanctuaryMeta!.blessing, ja: e.target.value },
                      },
                    })
                  }
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2.5 py-1.5 text-white"
                />
              </div>
            </div>
          )}

          {selectedSub.category === 'commentary' && (
            <div className="text-xs pt-1">
              <label className="text-[#CBD5E1] block mb-1">解説テキスト (日本語)</label>
              <textarea
                rows={3}
                value={selectedSub.text.ja}
                onChange={(e) =>
                  handleUpdateSelected({
                    text: { ...selectedSub.text, ja: e.target.value },
                  })
                }
                className="w-full bg-[#1b2330] border border-[#2b3749] rounded p-2 text-white font-serif-jp resize-none leading-relaxed"
                placeholder="神域の歴史や静けさを伝える文章を入力..."
              />
            </div>
          )}

          {selectedSub.category === 'etiquette_tip' && selectedSub.etiquetteTip && (
            <div className="space-y-2 text-xs pt-1">
              <div>
                <label className="text-[#F87171] block font-medium mb-1">作法見出し</label>
                <input
                  type="text"
                  value={selectedSub.etiquetteTip.title.ja}
                  onChange={(e) =>
                    handleUpdateSelected({
                      etiquetteTip: {
                        ...selectedSub.etiquetteTip!,
                        title: { ...selectedSub.etiquetteTip!.title, ja: e.target.value },
                      },
                    })
                  }
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded px-2.5 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-[#CBD5E1] block mb-1">作法詳細・注釈</label>
                <textarea
                  rows={2}
                  value={selectedSub.etiquetteTip.detail.ja}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleUpdateSelected({
                      text: { ...selectedSub.text, ja: val },
                      etiquetteTip: {
                        ...selectedSub.etiquetteTip!,
                        detail: { ...selectedSub.etiquetteTip!.detail, ja: val },
                      },
                    });
                  }}
                  className="w-full bg-[#1b2330] border border-[#2b3749] rounded p-2 text-white resize-none"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
