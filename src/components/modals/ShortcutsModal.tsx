import React from 'react';
import { X, Keyboard, Command, Scissors, Play, Trash2, ArrowLeft, ArrowRight, RotateCcw, Mic, Volume2 } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', desc: '再生 / 一時停止の切り替え', icon: <Play className="w-4 h-4 text-[#D4AF37]" /> },
    { key: 'S', desc: '再生ヘッド位置で選択アイテムを分割 (Split)', icon: <Scissors className="w-4 h-4 text-[#D4AF37]" /> },
    { key: 'Delete / Backspace', desc: '選択中のアイテムを削除', icon: <Trash2 className="w-4 h-4 text-red-400" /> },
    { key: '← / →', desc: '1コマ (1/30秒) 前後へスキップ', icon: <ArrowLeft className="w-4 h-4 text-blue-400" /> },
    { key: 'Home / End', desc: '動画の先頭 / 末尾へジャンプ', icon: <RotateCcw className="w-4 h-4 text-blue-400" /> },
    { key: 'Ctrl + Z / Cmd + Z', desc: '直前の操作を元に戻す (Undo)', icon: <Command className="w-4 h-4 text-amber-400" /> },
    { key: 'Ctrl + Y / Cmd + Shift + Z', desc: 'やり直し (Redo)', icon: <Command className="w-4 h-4 text-amber-400" /> },
    { key: 'R', desc: 'マイク録音の開始 / 停止 (Voiceover)', icon: <Mic className="w-4 h-4 text-red-400" /> },
    { key: '?', desc: 'このショートカット一覧の表示', icon: <Keyboard className="w-4 h-4 text-purple-400" /> },
    { key: 'Esc', desc: '開いているモーダルを閉じる', icon: <X className="w-4 h-4 text-gray-400" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-[#121620] border border-[#2d3a4e] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#222d3d] bg-[#161c28]">
          <div className="flex items-center space-x-2 text-[#D4AF37]">
            <Keyboard className="w-5 h-5" />
            <h3 className="font-semibold text-sm">キーボードショートカット一覧</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#20293a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-5 space-y-2.5 max-h-[75vh] overflow-y-auto">
          {shortcuts.map((sc, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2.5 rounded-lg bg-[#18202d] border border-[#243144] hover:bg-[#1d2737] transition-colors"
            >
              <div className="flex items-center space-x-2.5 text-xs text-[#E2E8F0]">
                {sc.icon}
                <span>{sc.desc}</span>
              </div>
              <kbd className="px-2.5 py-1 bg-[#0c1017] border border-[#314159] rounded text-[11px] font-mono text-[#D4AF37] shadow-sm">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#141924] border-t border-[#222d3d] text-right">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#D4AF37] text-black font-semibold text-xs rounded hover:brightness-110 transition-all shadow-md"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
