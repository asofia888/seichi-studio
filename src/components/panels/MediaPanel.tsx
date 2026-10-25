import React, { useRef } from 'react';
import { ProjectData, TransitionType, VideoClipItem } from '../../types';
import type { ProjectUpdate } from '../../services/projectHistory';
import { saveMediaFile } from '../../services/storage';
import { notify } from '../../services/notifications';
import { DEFAULT_VIGNETTE } from '../../services/canvasRenderer';
import { clipSpeed, isOverlayClip } from '../../services/composition';
import {
  clipEditLimits,
  moveClipInOrder,
  moveClipToTrack,
  openOverlaySpan,
  rippleDeleteClip,
  setClipSpeed,
} from '../../services/timelineEdit';
import {
  Upload,
  Plus,
  Trash2,
  Sliders,
  Sparkles,
  Image as ImageIcon,
  Film,
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const DEFAULT_TRANSITION_SEC = 0.8;
// A photo laid over the main track as B-roll shows this long
const OVERLAY_PHOTO_SEC = 4;
const TRANSITION_CHOICES: { type: TransitionType | 'cut'; label: string }[] = [
  { type: 'cut', label: 'カット' },
  { type: 'dissolve', label: 'ディゾルブ' },
  { type: 'fade_black', label: '黒フェード' },
  { type: 'fade_white', label: '白フェード' },
];
const COLOR_CONTROLS = [
  { key: 'brightness', label: '明るさ' },
  { key: 'contrast', label: 'コントラスト' },
  { key: 'saturation', label: '彩度' },
  { key: 'temperature', label: '色温度（− 青み ／ ＋ 暖かみ）' },
] as const;
const NEUTRAL_COLOR = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

/** Length of a video in seconds, or null if the browser cannot read it */
function readVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (video.duration !== Infinity) return finish(video.duration);
      // WebM files recorded in a browser carry no duration; seeking to the end makes the browser work it out
      video.ondurationchange = () => {
        if (Number.isFinite(video.duration)) finish(video.duration);
      };
      video.currentTime = Number.MAX_SAFE_INTEGER;
      setTimeout(() => finish(NaN), 5000);
    };
    video.onerror = () => finish(NaN);
    video.src = url;
  });
}

interface MediaPanelProps {
  project: ProjectData;
  onUpdateProject: (update: ProjectUpdate) => void;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  currentTime: number;
}

export const MediaPanel: React.FC<MediaPanelProps> = ({
  project,
  onUpdateProject,
  selectedClipId,
  onSelectClip,
  currentTime,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Set by the B-roll button: the files picked next are laid over the main track at the playhead
  const addAsOverlayRef = useRef(false);

  const selectedClip = project.videoClips.find((c) => c.id === selectedClipId);
  const vignette = project.vignette ?? DEFAULT_VIGNETTE;

  // Handle local file upload (images or videos)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const asOverlay = addAsOverlayRef.current;
    addAsOverlayRef.current = false;
    const overlayAt = currentTime;

    // startTime is first the offset from the end of the timeline; it becomes absolute when placed below
    const newClips: VideoClipItem[] = [];
    let offset = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.type.startsWith('video');
      // If the file cannot be kept in this browser, it is still usable until the page is reloaded
      const blobKey = await saveMediaFile(file).catch(() => {
        notify(`「${file.name}」をブラウザに保存できませんでした。ページを再読み込みすると、この素材は表示されなくなります。`, 'error');
        return undefined;
      });
      const url = URL.createObjectURL(file);
      // Videos use their real length (10s if it cannot be read); photos show for 8s (4s as B-roll)
      const sourceDuration = isVideo ? await readVideoDuration(url) : null;
      const clipDuration = isVideo ? sourceDuration ?? 10 : asOverlay ? OVERLAY_PHOTO_SEC : 8;

      newClips.push({
        id: `clip_${Date.now()}_${i}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        type: isVideo ? 'video' : 'image',
        dataUrl: url,
        blobKey,
        startTime: offset,
        duration: clipDuration,
        trimStart: 0,
        trimEnd: clipDuration,
        ...(sourceDuration ? { sourceDuration } : {}),
        // B-roll covers the picture but lets the main clip's voice carry on, and eases in and out
        ...(asOverlay
          ? { track: 'overlay' as const, volume: 0, transition: { type: 'dissolve' as const, duration: 0.5 } }
          : {}),
        kenBurns: !isVideo
          ? {
              enabled: true,
              scaleStart: 1.0,
              scaleEnd: 1.15,
              panX: 2,
              panY: -1,
            }
          : undefined,
      });

      offset += clipDuration;
    }
    if (newClips.length === 0) return;

    if (asOverlay) {
      // One after another from the playhead, each cut short where an existing B-roll clip begins
      onUpdateProject((prev) => {
        let next = prev;
        let at = overlayAt;
        for (const clip of newClips) {
          const span = openOverlaySpan(next, at, clip.duration);
          if (!span) break;
          next = { ...next, videoClips: [...next.videoClips, { ...clip, startTime: span.start, duration: span.duration }] };
          at = span.start + span.duration;
        }
        if (next === prev) notify('再生位置の後ろに、Bロールを置ける空きがありません。', 'error');
        return { ...next, updatedAt: new Date().toISOString() };
      });
      onSelectClip(newClips[0].id);
      return;
    }

    // Storing the files takes a moment, so place the clips after the end of the latest project
    onUpdateProject((prev) => {
      const mainClips = prev.videoClips.filter((c) => !isOverlayClip(c));
      const start = mainClips.length > 0
        ? Math.max(...mainClips.map((c) => c.startTime + c.duration))
        : 3; // after OP
      return {
        ...prev,
        videoClips: [...prev.videoClips, ...newClips.map((c) => ({ ...c, startTime: start + c.startTime }))],
        updatedAt: new Date().toISOString(),
      };
    });
    onSelectClip(newClips[0].id);
  };

  // Add artistic sacred gradient placeholder image
  const handleAddSampleSacredPhoto = (name: string, hue1: string, hue2: string) => {
    // Generate high-resolution procedural canvas image for shrine testing
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 1920;
    offCanvas.height = 1080;
    const ctx = offCanvas.getContext('2d')!;

    // Forest / shrine gradient
    const grad = ctx.createLinearGradient(0, 0, 1920, 1080);
    grad.addColorStop(0, hue1);
    grad.addColorStop(0.5, hue2);
    grad.addColorStop(1, '#0b0f14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1920, 1080);

    // Decorative torii motif
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(700, 400);
    ctx.bezierCurveTo(900, 370, 1020, 370, 1220, 400);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = "bold 64px 'Shippori Mincho', serif";
    ctx.textAlign = 'center';
    ctx.fillText(name, 960, 560);

    const dataUrl = offCanvas.toDataURL('image/jpeg', 0.9);

    const mainClips = project.videoClips.filter((c) => !isOverlayClip(c));
    const curStartTime = mainClips.length > 0
      ? Math.max(...mainClips.map((c) => c.startTime + c.duration))
      : 3;

    const newClip: VideoClipItem = {
      id: `clip_${Date.now()}`,
      name,
      type: 'image',
      dataUrl,
      startTime: curStartTime,
      duration: 10,
      trimStart: 0,
      trimEnd: 10,
      kenBurns: {
        enabled: true,
        scaleStart: 1.0,
        scaleEnd: 1.15,
        panX: 3,
        panY: -2,
      },
    };

    onUpdateProject({
      ...project,
      videoClips: [...project.videoClips, newClip],
      updatedAt: new Date().toISOString(),
    });
    onSelectClip(newClip.id);
  };

  const handleUpdateSelectedClip = (patch: Partial<VideoClipItem>) => {
    if (!selectedClip) return;
    const updated = project.videoClips.map((c) =>
      c.id === selectedClip.id ? { ...c, ...patch } : c
    );
    onUpdateProject({
      ...project,
      videoClips: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  // What follows on the main track moves up, so no empty stretch is left behind
  const handleDeleteClip = (id: string) => onUpdateProject(rippleDeleteClip(project, id));

  const handleMoveInOrder = (id: string, direction: -1 | 1) => {
    const moved = moveClipInOrder(project, id, direction);
    if (moved) onUpdateProject(moved);
  };

  const handleToggleTrack = () => {
    if (!selectedClip) return;
    const target = isOverlayClip(selectedClip) ? 'main' : 'overlay';
    const moved = moveClipToTrack(project, selectedClip.id, target);
    if (!moved) {
      notify(
        target === 'overlay'
          ? '同じ時間にほかのBロールがあるため移せません。Bロールの位置をずらしてください。'
          : '同じ時間に本編のクリップがあるため戻せません。本編に空きを作ってください。',
        'error'
      );
      return;
    }
    onUpdateProject(moved);
  };

  const handleSetTransition = (type: TransitionType | 'cut') => {
    if (!selectedClip) return;
    handleUpdateSelectedClip({
      transition: type === 'cut' ? undefined : { type, duration: selectedClip.transition?.duration ?? DEFAULT_TRANSITION_SEC },
    });
  };

  // The selected clip's transition on every clip of the main track (each one's way in from the clip before)
  const handleApplyTransitionToAll = () => {
    if (!selectedClip) return;
    const transition = selectedClip.transition;
    onUpdateProject({
      ...project,
      videoClips: project.videoClips.map((c) => (isOverlayClip(c) ? c : { ...c, transition })),
      updatedAt: new Date().toISOString(),
    });
    notify(transition ? '本編のすべてのつなぎに同じ設定を使いました。' : '本編のすべてのつなぎをカットにしました。');
  };

  const selectedLimits = selectedClip ? clipEditLimits(project, selectedClip) : null;
  const sortedClips = [...project.videoClips].sort(
    (a, b) => Number(isOverlayClip(a)) - Number(isOverlayClip(b)) || a.startTime - b.startTime
  );

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-5 text-sm text-[#E2E8F0]">
      {/* Upload button area */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5">
            <Film className="w-4 h-4" />
            <span>動画クリップ・写真の追加</span>
          </span>
          <span className="text-xs text-[#8A99AD]">{project.videoClips.length}件</span>
        </div>

        <button
          onClick={() => {
            addAsOverlayRef.current = false;
            fileInputRef.current?.click();
          }}
          className="w-full py-3 border-2 border-dashed border-[#2f3b4c] hover:border-[#D4AF37] rounded-lg bg-[#141a24] hover:bg-[#192230] flex flex-col items-center justify-center space-y-1 transition-colors group cursor-pointer"
        >
          <Upload className="w-5 h-5 text-[#8A99AD] group-hover:text-[#D4AF37]" />
          <span className="text-xs text-[#CBD5E1] group-hover:text-white font-medium">
            PCから動画・写真を選択
          </span>
          <span className="text-[10px] text-[#64748B]">MP4, MOV, WebM, JPG, PNG対応</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => {
            addAsOverlayRef.current = true;
            fileInputRef.current?.click();
          }}
          className="mt-1.5 w-full py-1.5 border border-[#3b3f73] hover:border-[#818CF8] rounded bg-[#15162a] hover:bg-[#1c1e38] flex items-center justify-center space-x-1.5 text-[11px] text-[#C7D2FE] transition-colors"
          title="再生位置から、本編の上に重ねる映像（Bロール）として追加します。本編の声はそのまま聞こえます"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Bロールとして再生位置に重ねる</span>
        </button>

        {/* Quick Sample Sacred Photos */}
        <div className="mt-2.5">
          <span className="text-[11px] text-[#8A99AD] block mb-1">サンプル写真を追加（テスト用）:</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => handleAddSampleSacredPhoto('奥社 杉並木の参道', '#10281e', '#1e3a2b')}
              className="px-2 py-1 bg-[#16211c] hover:bg-[#1e2f27] border border-[#2b4c3b] rounded text-[11px] text-[#A7F3D0] truncate text-left"
            >
              🌲 杉並木の参道
            </button>
            <button
              onClick={() => handleAddSampleSacredPhoto('随神門（朱塗りの楼門）', '#361b17', '#241413')}
              className="px-2 py-1 bg-[#241715] hover:bg-[#331f1c] border border-[#522b26] rounded text-[11px] text-[#FECACA] truncate text-left"
            >
              ⛩️ 朱塗りの随神門
            </button>
            <button
              onClick={() => handleAddSampleSacredPhoto('奥社拝殿と神域の岩峰', '#192330', '#111722')}
              className="px-2 py-1 bg-[#141b25] hover:bg-[#1d2735] border border-[#2c3d53] rounded text-[11px] text-[#BFDBFE] truncate text-left"
            >
              ⛰️ 奥社拝殿と岩峰
            </button>
            <button
              onClick={() => handleAddSampleSacredPhoto('手水舎（清流と神水）', '#11222b', '#0e181e')}
              className="px-2 py-1 bg-[#13222a] hover:bg-[#1c303c] border border-[#2b4b5c] rounded text-[11px] text-[#BAE6FD] truncate text-left"
            >
              💧 手水舎の清流
            </button>
          </div>
        </div>
      </div>

      {/* Clip List */}
      <div>
        <span className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider block mb-2">
          タイムライン上のクリップ一覧
        </span>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {sortedClips.map((clip) => {
            const isSelected = clip.id === selectedClipId;
            const overlay = isOverlayClip(clip);
            const trackClips = sortedClips.filter((c) => isOverlayClip(c) === overlay);
            const index = trackClips.indexOf(clip);
            return (
              <div
                key={clip.id}
                onClick={() => onSelectClip(clip.id)}
                className={`p-2 rounded border flex items-center justify-between cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#1e2838] border-[#D4AF37] text-white'
                    : 'bg-[#12161f] border-[#202734] hover:bg-[#181f2c] text-[#CBD5E1]'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className="text-[11px] text-[#718096] font-mono">{overlay ? `B${index + 1}` : `${index + 1}.`}</span>
                  {overlay ? (
                    <Layers className="w-3.5 h-3.5 text-[#818CF8] shrink-0" />
                  ) : clip.type === 'video' ? (
                    <Film className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-[#34D399] shrink-0" />
                  )}
                  <span className="text-xs truncate font-medium">{clip.name}</span>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-[10px] text-[#8A99AD] font-mono">
                    {clip.startTime}s - {Math.round((clip.startTime + clip.duration) * 100) / 100}s
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveInOrder(clip.id, -1);
                    }}
                    disabled={index === 0}
                    className="p-0.5 hover:text-white text-gray-500 rounded disabled:opacity-30"
                    title="ひとつ前と入れ替える"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveInOrder(clip.id, 1);
                    }}
                    disabled={index === trackClips.length - 1}
                    className="p-0.5 hover:text-white text-gray-500 rounded disabled:opacity-30"
                    title="ひとつ後と入れ替える"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClip(clip.id);
                    }}
                    className="p-1 hover:text-red-400 text-gray-500 rounded"
                    title={overlay ? '削除' : '削除（後ろのクリップを詰める）'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vignette over every photo and video */}
      <div className="border border-[#263142] rounded-lg p-3 bg-[#131822] space-y-1.5 text-xs">
        <div className="flex justify-between text-[#8A99AD]">
          <label htmlFor="vignette-strength">周辺減光（画面の四隅を暗くする）</label>
          <span className="font-mono text-[#D4AF37]">{vignette > 0 ? `${Math.round(vignette * 100)}%` : 'オフ'}</span>
        </div>
        <input
          id="vignette-strength"
          type="range"
          min="0"
          max="0.8"
          step="0.05"
          value={vignette}
          onChange={(e) => {
            const value = parseFloat(e.target.value);
            onUpdateProject((prev) => ({ ...prev, vignette: value, updatedAt: new Date().toISOString() }));
          }}
          className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
        />
        <p className="text-[10px] text-[#64748B] leading-relaxed">
          すべての写真・動画にかかります。素材の色をそのまま見せたいときは 0〜30% 程度に弱めてください。
        </p>
      </div>

      {/* Selected Clip Inspector & Ken Burns Settings */}
      {selectedClip && (
        <div className="border border-[#263142] rounded-lg p-3 bg-[#131822] space-y-3">
          <div className="flex items-center justify-between border-b border-[#212937] pb-2">
            <span className="text-xs font-semibold text-[#D4AF37] flex items-center space-x-1">
              <Sliders className="w-3.5 h-3.5" />
              <span>クリップ設定: {selectedClip.name}</span>
            </span>
            <span className="text-[10px] text-gray-400 uppercase">{selectedClip.type}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[#8A99AD] block mb-1">開始秒 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={selectedClip.startTime}
                onChange={(e) => {
                  // Between the neighbouring clips on the same track
                  const wanted = Math.max(0, parseFloat(e.target.value) || 0);
                  const latest = selectedLimits!.latestEnd - selectedClip.duration;
                  handleUpdateSelectedClip({ startTime: Math.max(selectedLimits!.earliestStart, Math.min(latest, wanted)) });
                }}
                className="w-full bg-[#1c2433] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[#8A99AD] block mb-1">表示尺 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={selectedClip.duration}
                onChange={(e) => {
                  // Up to the next clip on the same track, and (for a video) the end of its source
                  const wanted = Math.max(1, parseFloat(e.target.value) || 1);
                  const longest = selectedLimits!.latestTail - selectedClip.startTime;
                  handleUpdateSelectedClip({ duration: Math.round(Math.min(longest, wanted) * 100) / 100 });
                }}
                className="w-full bg-[#1c2433] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
          </div>

          {/* Which track: the main sequence or B-roll laid over it */}
          <div className="pt-2 border-t border-[#212937] flex items-center justify-between text-xs">
            <span className="text-[#8A99AD]">
              {isOverlayClip(selectedClip) ? 'Bロール（本編の上に重ねる）' : '本編'}
            </span>
            <button
              onClick={handleToggleTrack}
              className="px-2 py-0.5 rounded border border-[#3b3f73] bg-[#15162a] hover:bg-[#1c1e38] text-[11px] text-[#C7D2FE]"
            >
              {isOverlayClip(selectedClip) ? '本編に戻す' : 'Bロールに移す'}
            </button>
          </div>

          {/* How the clip begins */}
          <div className="pt-2 border-t border-[#212937] text-xs space-y-1.5">
            <span className="text-[#8A99AD] block">
              {isOverlayClip(selectedClip) ? '出入りのつなぎ' : '前のクリップからのつなぎ'}
            </span>
            <div className="grid grid-cols-4 gap-1">
              {TRANSITION_CHOICES.filter((c) => !isOverlayClip(selectedClip) || c.type === 'cut' || c.type === 'dissolve').map(
                (choice) => {
                  const current = selectedClip.transition?.type ?? 'cut';
                  return (
                    <button
                      key={choice.type}
                      onClick={() => handleSetTransition(choice.type)}
                      className={`py-1 rounded border text-[10px] transition-colors ${
                        current === choice.type
                          ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] font-semibold'
                          : 'bg-[#121722] border-[#222c3d] text-gray-300 hover:bg-[#1a2333]'
                      }`}
                    >
                      {choice.label}
                    </button>
                  );
                }
              )}
            </div>
            {selectedClip.transition && (
              <div>
                <div className="flex justify-between text-[#8A99AD]">
                  <label htmlFor="transition-duration">長さ</label>
                  <span className="font-mono text-[#D4AF37]">{selectedClip.transition.duration.toFixed(1)}秒</span>
                </div>
                <input
                  id="transition-duration"
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.1"
                  value={selectedClip.transition.duration}
                  onChange={(e) =>
                    handleUpdateSelectedClip({
                      transition: { ...selectedClip.transition!, duration: parseFloat(e.target.value) },
                    })
                  }
                  className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
                />
              </div>
            )}
            {!isOverlayClip(selectedClip) && (
              <button
                onClick={handleApplyTransitionToAll}
                className="w-full py-1 rounded border border-[#2b3749] bg-[#121722] hover:bg-[#1a2333] text-[10px] text-gray-300"
              >
                このつなぎを本編のすべてのクリップに使う
              </button>
            )}
            <p className="text-[10px] text-[#64748B] leading-relaxed">
              {isOverlayClip(selectedClip)
                ? 'ディゾルブにすると、Bロールが本編からふわっと現れ、ふわっと消えます。'
                : '切り替わりの前後半分ずつにかかります。前にクリップがないときは、黒（白）からのフェードインになります。'}
            </p>
          </div>

          {/* Speed */}
          {selectedClip.type === 'video' && (
            <div className="pt-2 border-t border-[#212937] text-xs space-y-1">
              <div className="flex justify-between items-center text-[#8A99AD]">
                <label htmlFor="clip-speed">再生速度</label>
                <select
                  id="clip-speed"
                  value={clipSpeed(selectedClip)}
                  onChange={(e) => onUpdateProject(setClipSpeed(project, selectedClip.id, parseFloat(e.target.value)))}
                  className="bg-[#1c2433] border border-[#2b3749] rounded px-2 py-0.5 text-white font-mono text-xs"
                >
                  {SPEEDS.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}x{speed < 1 ? '（スロー）' : speed > 1 ? '（早送り）' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-[#64748B] leading-relaxed">
                映る範囲はそのままで、長さが変わります（本編では後ろのクリップも一緒にずれます）。元の音は高さも変わるので、気になるときは下の音量を0%にしてください。
              </p>
            </div>
          )}

          {/* Colour correction */}
          <div className="pt-2 border-t border-[#212937] text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[#8A99AD]">色補正</span>
              {selectedClip.color && (
                <button
                  onClick={() => handleUpdateSelectedClip({ color: undefined })}
                  className="text-[10px] text-gray-400 hover:text-red-300"
                >
                  元に戻す
                </button>
              )}
            </div>
            {COLOR_CONTROLS.map(({ key, label }) => {
              const value = selectedClip.color?.[key] ?? 0;
              return (
                <div key={key}>
                  <div className="flex justify-between text-[11px] text-[#8A99AD]">
                    <label htmlFor={`color-${key}`}>{label}</label>
                    <span className="font-mono text-[#D4AF37]">{value > 0 ? `+${value}` : value}</span>
                  </div>
                  <input
                    id={`color-${key}`}
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={value}
                    onChange={(e) =>
                      handleUpdateSelectedClip({
                        color: { ...NEUTRAL_COLOR, ...selectedClip.color, [key]: parseInt(e.target.value, 10) },
                      })
                    }
                    className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
                  />
                </div>
              );
            })}
          </div>

          {/* Original sound recorded with the video */}
          {selectedClip.type === 'video' && (
            <div className="pt-2 border-t border-[#212937] text-xs space-y-1">
              <div className="flex justify-between text-[#8A99AD]">
                <span>動画の元音声の音量</span>
                <span className="font-mono text-[#D4AF37]">{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={selectedClip.volume ?? 1}
                onChange={(e) => handleUpdateSelectedClip({ volume: parseFloat(e.target.value) })}
                className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
              />
            </div>
          )}

          {/* Ken Burns effect toggle for photos */}
          {selectedClip.type === 'image' && (
            <div className="pt-2 border-t border-[#212937] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#E2E8F0] flex items-center space-x-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>ケン・バーンズ効果 (写真のゆっくりズーム)</span>
                </span>
                <input
                  type="checkbox"
                  checked={selectedClip.kenBurns?.enabled ?? true}
                  onChange={(e) =>
                    handleUpdateSelectedClip({
                      kenBurns: {
                        ...(selectedClip.kenBurns || {
                          scaleStart: 1.0,
                          scaleEnd: 1.15,
                          panX: 2,
                          panY: -1,
                        }),
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="rounded text-[#D4AF37] focus:ring-0"
                />
              </div>

              {selectedClip.kenBurns?.enabled && (
                <div className="space-y-2 bg-[#171f2c] p-2.5 rounded border border-[#232f42]">
                  {/* Preset Motion Selector */}
                  <div>
                    <span className="text-[11px] text-[#A0AEC0] block mb-1 font-medium">動作プリセット:</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'zoom_in', name: '⛩️ 鳥居・本殿へズームイン', start: 1.0, end: 1.25, px: 0, py: 0 },
                        { id: 'zoom_out', name: '🌲 全景へ引き (ズームアウト)', start: 1.25, end: 1.0, px: 0, py: 0 },
                        { id: 'pan_right', name: '➡️ 参道パン (左→右)', start: 1.12, end: 1.12, px: -4, py: 0 },
                        { id: 'pan_left', name: '⬅️ 参道パン (右→左)', start: 1.12, end: 1.12, px: 4, py: 0 },
                        { id: 'tilt_up', name: '⬆️ 巨木・鳥居仰ぎ見 (下→上)', start: 1.15, end: 1.15, px: 0, py: 4 },
                        { id: 'subtle_drift', name: '✨ 御神気 (ゆったり微動)', start: 1.0, end: 1.08, px: 2, py: 1 },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() =>
                            handleUpdateSelectedClip({
                              kenBurns: {
                                ...selectedClip.kenBurns!,
                                preset: preset.id as any,
                                scaleStart: preset.start,
                                scaleEnd: preset.end,
                                panX: preset.px,
                                panY: preset.py,
                              },
                            })
                          }
                          className={`px-2 py-1 text-left rounded text-[10px] truncate border transition-colors ${
                            selectedClip.kenBurns?.preset === preset.id
                              ? 'bg-amber-950/70 border-amber-500 text-amber-200'
                              : 'bg-[#121722] border-[#222c3d] text-gray-300 hover:bg-[#1a2333]'
                          }`}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Click-to-Focus Reticle on Image */}
                  {selectedClip.dataUrl && (
                    <div className="pt-2 border-t border-[#232f42]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-[#A0AEC0] font-medium">
                          🎯 注視点 (写真をクリックしてズーム中心を設定):
                        </span>
                        {selectedClip.kenBurns?.focusPoint && (
                          <button
                            onClick={() =>
                              handleUpdateSelectedClip({
                                kenBurns: {
                                  ...selectedClip.kenBurns!,
                                  focusPoint: undefined,
                                },
                              })
                            }
                            className="text-[10px] text-gray-400 hover:text-red-300"
                          >
                            中央にリセット
                          </button>
                        )}
                      </div>

                      <div
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickX = (e.clientX - rect.left) / rect.width;
                          const clickY = (e.clientY - rect.top) / rect.height;
                          handleUpdateSelectedClip({
                            kenBurns: {
                              ...selectedClip.kenBurns!,
                              focusPoint: {
                                x: Math.round(clickX * 100) / 100,
                                y: Math.round(clickY * 100) / 100,
                              },
                            },
                          });
                        }}
                        className="relative w-full h-28 bg-black rounded border border-[#2b3749] overflow-hidden cursor-crosshair group shadow-inner"
                      >
                        <img
                          src={selectedClip.dataUrl}
                          alt="preview"
                          className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity pointer-events-none"
                        />

                        {/* Reticle Target Marker */}
                        <div
                          className="absolute w-5 h-5 -ml-2.5 -mt-2.5 pointer-events-none flex items-center justify-center"
                          style={{
                            left: `${(selectedClip.kenBurns?.focusPoint?.x ?? 0.5) * 100}%`,
                            top: `${(selectedClip.kenBurns?.focusPoint?.y ?? 0.5) * 100}%`,
                          }}
                        >
                          <div className="w-5 h-5 rounded-full border-2 border-[#D4AF37] bg-amber-500/30 animate-pulse" />
                          <div className="absolute w-1 h-1 bg-[#D4AF37] rounded-full" />
                        </div>

                        <div className="absolute bottom-1 right-1 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-mono text-amber-300">
                          {selectedClip.kenBurns?.focusPoint
                            ? `(${Math.round(selectedClip.kenBurns.focusPoint.x * 100)}%, ${Math.round(
                                selectedClip.kenBurns.focusPoint.y * 100
                              )}%)`
                            : '中心 (50%, 50%)'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Manual Scale Sliders */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-[#8A99AD] block">開始倍率: {selectedClip.kenBurns.scaleStart}x</span>
                      <input
                        type="range"
                        min="1.0"
                        max="1.35"
                        step="0.02"
                        value={selectedClip.kenBurns.scaleStart}
                        onChange={(e) =>
                          handleUpdateSelectedClip({
                            kenBurns: {
                              ...selectedClip.kenBurns!,
                              scaleStart: parseFloat(e.target.value),
                            },
                          })
                        }
                        className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <span className="text-[#8A99AD] block">終了倍率: {selectedClip.kenBurns.scaleEnd}x</span>
                      <input
                        type="range"
                        min="1.0"
                        max="1.35"
                        step="0.02"
                        value={selectedClip.kenBurns.scaleEnd}
                        onChange={(e) =>
                          handleUpdateSelectedClip({
                            kenBurns: {
                              ...selectedClip.kenBurns!,
                              scaleEnd: parseFloat(e.target.value),
                            },
                          })
                        }
                        className="w-full h-1 bg-[#253245] accent-[#D4AF37]"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
