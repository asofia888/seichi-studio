import React, { useRef, useEffect, useState } from 'react';
import { ProjectData } from '../../types';
import { canvasRenderer } from '../../services/canvasRenderer';
import {
  X,
  Download,
  Camera,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface ThumbnailModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData;
  currentTime: number;
}

export const ThumbnailModal: React.FC<ThumbnailModalProps> = ({
  isOpen,
  onClose,
  project,
  currentTime,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [title, setTitle] = useState(project.title.split(' ')[0] || '戸隠神社 奥社');
  const [subtitle, setSubtitle] = useState('樹齢四百年の杉並木と神話の杜');
  const [badge, setBadge] = useState('聖地巡礼');
  const [fontSize, setFontSize] = useState(84);
  const [goldIntensity, setGoldIntensity] = useState(true);

  const isLandscape = project.aspectRatio === '16:9';
  const width = isLandscape ? 1280 : 720;
  const height = isLandscape ? 720 : 1280;

  // The photo under the playhead may still be loading when the modal opens; redraw once it is ready
  const [imageReadyTick, setImageReadyTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const clip = canvasRenderer.getActiveClip(project, currentTime);
    if (clip?.type === 'image' && clip.dataUrl) {
      canvasRenderer.preloadImage(clip.dataUrl).then(() => setImageReadyTick((n) => n + 1)).catch(() => {});
    }
  }, [isOpen, project, currentTime]);

  // Render thumbnail canvas
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Render the video frame at full resolution on its own canvas, then scale it to the thumbnail size
    //    (rendering straight into this canvas would resize it to 1920x1080 and misplace the overlays)
    const frame = document.createElement('canvas');
    const frameCtx = frame.getContext('2d');
    if (!frameCtx) return;
    canvasRenderer.renderFrame(frameCtx, project, currentTime, 'ja', false);
    ctx.drawImage(frame, 0, 0, width, height);

    // 2. Add dramatic thumbnail shading (Dark gradient overlay for text legibility)
    const grad = ctx.createLinearGradient(0, height * 0.4, 0, height);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.7, 'rgba(5, 7, 10, 0.7)');
    grad.addColorStop(1, 'rgba(5, 7, 10, 0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 3. Render Vermilion Seal Badge (朱印・角丸ラベル)
    if (badge) {
      const bx = isLandscape ? 60 : 40;
      const by = isLandscape ? height - 260 : height - 420;
      ctx.fillStyle = '#C84B31';
      ctx.beginPath();
      ctx.roundRect(bx, by, 160, 42, 6);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 22px 'Noto Serif JP', serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`⛩️ ${badge}`, bx + 80, by + 30);
    }

    // 4. Render Main Title with Gold Leaf Glow
    const tx = isLandscape ? 60 : width / 2;
    const ty = isLandscape ? height - 160 : height - 280;

    ctx.save();
    ctx.font = `bold ${fontSize}px 'Shippori Mincho', 'Noto Serif JP', serif`;
    ctx.textAlign = isLandscape ? 'left' : 'center';

    // Deep shadow for contrast
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;

    // Gold gradient text or pure white
    if (goldIntensity) {
      const textGrad = ctx.createLinearGradient(0, ty - fontSize, 0, ty);
      textGrad.addColorStop(0, '#FFFFFF');
      textGrad.addColorStop(0.5, '#F7E7B4');
      textGrad.addColorStop(1, '#D4AF37');
      ctx.fillStyle = textGrad;
    } else {
      ctx.fillStyle = '#FFFFFF';
    }

    ctx.fillText(title, tx, ty);

    // Outer thin gold stroke
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeText(title, tx, ty);
    ctx.restore();

    // 5. Render Catchy Subtitle
    if (subtitle) {
      const sy = isLandscape ? height - 90 : height - 190;
      ctx.save();
      ctx.font = `600 ${isLandscape ? 34 : 32}px 'Shippori Mincho', serif`;
      ctx.textAlign = isLandscape ? 'left' : 'center';
      ctx.fillStyle = '#F7F6F2';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 10;
      ctx.fillText(subtitle, tx, sy);
      ctx.restore();
    }
  }, [isOpen, project, currentTime, title, subtitle, badge, fontSize, goldIntensity, isLandscape, width, height, imageReadyTick]);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${project.title.replace(/[/\\?%*:|"<>]/g, '_')}_thumbnail.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121620] border border-[#2b384c] rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-12 border-b border-[#212937] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-[#D4AF37] font-semibold text-sm">
            <Camera className="w-4 h-4" />
            <span>YouTube サムネイル作成（フレーム切り出し＆文字入れ）</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-4 gap-4">
          {/* Canvas Preview Area */}
          <div className="flex-1 bg-black rounded-lg border border-[#232c3d] flex items-center justify-center p-2 overflow-hidden">
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full object-contain rounded shadow-lg"
            />
          </div>

          {/* Settings Sidebar */}
          <div className="w-full md:w-80 flex flex-col justify-between space-y-4 text-xs text-[#E2E8F0] overflow-y-auto">
            <div className="space-y-3">
              <div>
                <label className="text-[#D4AF37] block font-semibold mb-1">
                  メイン聖地名（大きく表示）
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#1b2332] border border-[#2c3d56] rounded px-3 py-1.5 text-white font-serif-jp text-sm outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="text-gray-300 block mb-1">サブキャッチコピー</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full bg-[#1b2332] border border-[#2c3d56] rounded px-3 py-1.5 text-white outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="text-gray-300 block mb-1">朱印ラベル（バッジ）</label>
                <input
                  type="text"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  className="w-full bg-[#1b2332] border border-[#2c3d56] rounded px-3 py-1.5 text-white outline-none focus:border-[#D4AF37]"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {['聖地巡礼', 'パワースポット', '神秘の杜', '参拝完全ガイド', '開運祈願'].map((b) => (
                    <button
                      key={b}
                      onClick={() => setBadge(b)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                        badge === b
                          ? 'bg-amber-950/70 border-amber-500 text-amber-200'
                          : 'bg-[#141b25] border-[#253245] text-gray-400 hover:text-white'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-gray-300 mb-1">
                  <span>文字サイズ:</span>
                  <span className="font-mono text-[#D4AF37]">{fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="48"
                  max="120"
                  step="2"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[#2b3a4f] accent-[#D4AF37]"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#202938]">
                <span className="text-gray-300">黄金グラデーション文字</span>
                <input
                  type="checkbox"
                  checked={goldIntensity}
                  onChange={(e) => setGoldIntensity(e.target.checked)}
                  className="rounded text-[#D4AF37]"
                />
              </div>

              <div className="text-[11px] text-gray-400 bg-[#161c27] p-2 rounded">
                ※ 現在のタイムライン再生位置（{currentTime.toFixed(1)}s）の映像フレームが背景として使われます。
              </div>
            </div>

            {/* Download Button */}
            <button
              onClick={handleDownload}
              className="w-full py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded shadow-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#0B0D11]" />
              <span>サムネイル画像を保存 ({width}x{height} PNG)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
