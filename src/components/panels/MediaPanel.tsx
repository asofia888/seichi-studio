import React, { useRef } from 'react';
import { ProjectData, VideoClipItem } from '../../types';
import type { ProjectUpdate } from '../../services/projectHistory';
import { saveMediaFile } from '../../services/storage';
import { notify } from '../../services/notifications';
import {
  Upload,
  Plus,
  Trash2,
  Sliders,
  Sparkles,
  Image as ImageIcon,
  Film,
} from 'lucide-react';

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
}

export const MediaPanel: React.FC<MediaPanelProps> = ({
  project,
  onUpdateProject,
  selectedClipId,
  onSelectClip,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedClip = project.videoClips.find((c) => c.id === selectedClipId);

  // Handle local file upload (images or videos)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

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
      // Videos use their real length (10s if it cannot be read); photos show for 8s
      const clipDuration = isVideo ? (await readVideoDuration(url)) ?? 10 : 8;

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

    // Storing the files takes a moment, so place the clips after the end of the latest project
    onUpdateProject((prev) => {
      const start = prev.videoClips.length > 0
        ? Math.max(...prev.videoClips.map((c) => c.startTime + c.duration))
        : 3; // after OP
      return {
        ...prev,
        videoClips: [...prev.videoClips, ...newClips.map((c) => ({ ...c, startTime: start + c.startTime }))],
        duration: Math.max(prev.duration, start + offset + prev.branding.edDuration),
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

    const curStartTime = project.videoClips.length > 0
      ? Math.max(...project.videoClips.map((c) => c.startTime + c.duration))
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
      duration: Math.max(project.duration, curStartTime + 10 + project.branding.edDuration),
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

  const handleDeleteClip = (id: string) => {
    const updated = project.videoClips.filter((c) => c.id !== id);
    onUpdateProject({
      ...project,
      videoClips: updated,
      updatedAt: new Date().toISOString(),
    });
  };

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
          onClick={() => fileInputRef.current?.click()}
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
          {project.videoClips.map((clip, index) => {
            const isSelected = clip.id === selectedClipId;
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
                  <span className="text-[11px] text-[#718096] font-mono">{index + 1}.</span>
                  {clip.type === 'video' ? (
                    <Film className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-[#34D399] shrink-0" />
                  )}
                  <span className="text-xs truncate font-medium">{clip.name}</span>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-[10px] text-[#8A99AD] font-mono">
                    {clip.startTime}s - {clip.startTime + clip.duration}s
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClip(clip.id);
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
                onChange={(e) =>
                  handleUpdateSelectedClip({ startTime: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="w-full bg-[#1c2433] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[#8A99AD] block mb-1">表示尺 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={selectedClip.duration}
                onChange={(e) =>
                  handleUpdateSelectedClip({ duration: Math.max(1, parseFloat(e.target.value) || 1) })
                }
                className="w-full bg-[#1c2433] border border-[#2b3749] rounded px-2 py-1 text-white font-mono"
              />
            </div>
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
