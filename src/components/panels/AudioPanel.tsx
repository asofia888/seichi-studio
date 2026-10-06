import React, { useRef, useState } from 'react';
import { ProjectData, AudioTrackItem } from '../../types';
import { audioEngine, LOUDNESS_PROFILES, LoudnessProfile } from '../../services/audioEngine';
import { saveMediaBlob } from '../../services/storage';
import { WaveformVisualizer } from '../WaveformVisualizer';
import {
  Mic,
  MicOff,
  Music,
  Wind,
  Volume2,
  Sliders,
  Trash2,
  Upload,
  Plus,
  Play,
  Pause,
  AlertCircle,
  Sparkles,
  Gauge,
  Check,
  CheckCircle2,
  SlidersHorizontal,
  ArrowRight,
  Info,
  Scissors,
  Clock,
  ArrowLeftRight,
  MoveHorizontal,
  RotateCcw,
  Crosshair,
} from 'lucide-react';

interface AudioPanelProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  currentTime: number;
  isRecordingMic: boolean;
  onToggleRecordMic: () => void;
  selectedAudioId?: string | null;
  onSelectAudio?: (id: string | null) => void;
}

export const AudioPanel: React.FC<AudioPanelProps> = ({
  project,
  onUpdateProject,
  currentTime,
  isRecordingMic,
  onToggleRecordMic,
  selectedAudioId,
  onSelectAudio,
}) => {
  const bgmFileInputRef = useRef<HTMLInputElement | null>(null);
  const ambienceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<'youtube' | 'sacred_calm' | 'shorts'>('youtube');
  const [normalizationNotice, setNormalizationNotice] = useState<string | null>(null);
  const [recentSummary, setRecentSummary] = useState<
    { trackName: string; type: string; oldVol: number; newVol: number; gainDeltaDb: number }[] | null
  >(null);

  const bgmTrack = project.audioTracks.find((t) => t.type === 'bgm');
  const ambienceTrack = project.audioTracks.find((t) => t.type === 'ambience');
  const narrationTracks = project.audioTracks.filter((t) => t.type === 'narration');

  const currentProfile = LOUDNESS_PROFILES[selectedProfile];

  // Active track for trimming and timing inspection
  const activeTrack =
    project.audioTracks.find((t) => t.id === selectedAudioId) ||
    project.audioTracks[0] ||
    null;

  // Loudness calculations for real-time monitoring
  const bgmLoudness = bgmTrack ? audioEngine.calculateLoudness(bgmTrack) : null;
  const ambienceLoudness = ambienceTrack ? audioEngine.calculateLoudness(ambienceTrack) : null;
  const primaryNarrLoudness = narrationTracks.length > 0 ? audioEngine.calculateLoudness(narrationTracks[0]) : null;

  const handleUpdateTrack = (id: string, patch: Partial<AudioTrackItem>) => {
    const updated = project.audioTracks.map((t) =>
      t.id === id ? { ...t, ...patch } : t
    );
    onUpdateProject({
      ...project,
      audioTracks: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteTrack = (id: string) => {
    const updated = project.audioTracks.filter((t) => t.id !== id);
    onUpdateProject({
      ...project,
      audioTracks: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  // Perform full-project loudness normalization
  const handleNormalizeAll = () => {
    const result = audioEngine.normalizeAllTracks(project.audioTracks, selectedProfile);
    onUpdateProject({
      ...project,
      audioTracks: result.updatedTracks,
      updatedAt: new Date().toISOString(),
    });

    setRecentSummary(result.summary);
    setNormalizationNotice(
      `【${currentProfile.name}】基準に全トラックの音量を自動補正しました！`
    );
    setTimeout(() => setNormalizationNotice(null), 5000);
  };

  // Perform single track normalization
  const handleNormalizeSingleTrack = (trackId: string, targetLufs: number) => {
    const track = project.audioTracks.find((t) => t.id === trackId);
    if (!track) return;
    const result = audioEngine.normalizeTrack(track, targetLufs);
    const updatedTracks = project.audioTracks.map((t) => (t.id === trackId ? result.updatedTrack : t));
    onUpdateProject({
      ...project,
      audioTracks: updatedTracks,
      updatedAt: new Date().toISOString(),
    });

    const sign = result.gainDeltaDb >= 0 ? `+${result.gainDeltaDb}` : `${result.gainDeltaDb}`;
    setNormalizationNotice(
      `「${track.name}」を目標値 ${targetLufs} LUFS に自動補正 (${sign} dB / 音量 ${Math.round(result.updatedTrack.volume * 100)}%)`
    );
    setTimeout(() => setNormalizationNotice(null), 4000);
  };

  const handleUploadAudio = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'bgm' | 'ambience'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const blobKey = `audio_${Date.now()}`;
    await saveMediaBlob(blobKey, file);
    const url = URL.createObjectURL(file);
    const waveform = await audioEngine.extractWaveform(file, 50);

    const newTrack: AudioTrackItem = {
      id: `audio_${type}_${Date.now()}`,
      name: file.name.replace(/\.[^/.]+$/, ''),
      type,
      startTime: 0,
      duration: project.duration,
      volume: type === 'bgm' ? 0.65 : 0.45,
      dataUrl: url,
      blobKey,
      waveform,
      autoDucking:
        type === 'bgm'
          ? {
              enabled: true,
              duckVolume: 0.25,
              fadeSec: 0.4,
            }
          : undefined,
    };

    // Replace or add
    const existingIndex = project.audioTracks.findIndex((t) => t.type === type);
    let updated: AudioTrackItem[];
    if (existingIndex >= 0) {
      updated = [...project.audioTracks];
      updated[existingIndex] = newTrack;
    } else {
      updated = [...project.audioTracks, newTrack];
    }

    onUpdateProject({
      ...project,
      audioTracks: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-5 text-sm text-[#E2E8F0]">
      {/* ⚡ 1. Loudness Normalization Control Hub */}
      <div className="bg-gradient-to-b from-[#18202d] to-[#121822] border border-[#2d3a4e] rounded-xl p-3.5 space-y-3.5 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5 text-xs">
            <Gauge className="w-4 h-4 text-[#D4AF37]" />
            <span>ラウドネスノーマライゼーション (自動基準化)</span>
          </span>
          <span className="text-[10px] font-mono bg-[#D4AF37]/15 text-[#F7E7B4] border border-[#D4AF37]/30 px-1.5 py-0.5 rounded">
            LUFS基準
          </span>
        </div>

        <p className="text-[11px] text-[#94A3B8] leading-relaxed">
          YouTube等の配信プラットフォーム基準に合わせて、ナレーション・BGM・環境音の音量をワンクリックで黄金比率に自動最適化します。
        </p>

        {/* Profile Tabs */}
        <div className="space-y-1.5">
          <label className="text-[11px] text-gray-300 font-medium block">
            目標ラウドネス基準プロファイル:
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['youtube', 'sacred_calm', 'shorts'] as const).map((key) => {
              const prof = LOUDNESS_PROFILES[key];
              const isSelected = selectedProfile === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedProfile(key)}
                  className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#251e15] border-[#D4AF37] text-[#F7E7B4] shadow-md ring-1 ring-[#D4AF37]/40'
                      : 'bg-[#141b25] border-[#222e3e] text-gray-400 hover:text-gray-200 hover:bg-[#1a2330]'
                  }`}
                >
                  <div className="font-semibold text-[11px] truncate">{prof.name}</div>
                  <div className="text-[10px] font-mono mt-0.5 opacity-80">{prof.badge}</div>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-[#A0AEC0] bg-[#0f141d] p-2 rounded border border-[#1e2634] leading-relaxed">
            <span className="text-[#D4AF37] font-semibold">{currentProfile.name}: </span>
            {currentProfile.description}
          </div>
        </div>

        {/* Live LUFS Balance Levels Indicator */}
        <div className="bg-[#0c1017] p-2.5 rounded-lg border border-[#1f2837] space-y-2 text-xs">
          <div className="flex items-center justify-between text-[11px] text-gray-400 border-b border-[#1b2330] pb-1">
            <span>現在の推定音量レベル (LUFS)</span>
            <span className="text-[10px] text-[#93C5FD]">基準目標</span>
          </div>

          {/* Voice/Narration row */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-red-300 flex items-center space-x-1">
                <Mic className="w-3 h-3 text-red-400" />
                <span>主音声 (ナレーション)</span>
              </span>
              <span className="font-mono text-gray-300">
                {primaryNarrLoudness ? `${primaryNarrLoudness.estimatedLufs} LUFS` : '未録音'}
                <span className="text-[#64748B] ml-1.5 font-normal">/ 目標 {currentProfile.narrationTargetLufs} LUFS</span>
              </span>
            </div>
            <div className="w-full bg-[#1e2838] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-red-500 h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(5, ((primaryNarrLoudness?.estimatedLufs ?? -30) + 40) * 3))}%`,
                }}
              />
            </div>
          </div>

          {/* BGM row */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-indigo-300 flex items-center space-x-1">
                <Music className="w-3 h-3 text-indigo-400" />
                <span>BGM (雅楽・瞑想旋律)</span>
              </span>
              <span className="font-mono text-gray-300">
                {bgmLoudness ? `${bgmLoudness.estimatedLufs} LUFS` : '無効'}
                <span className="text-[#64748B] ml-1.5 font-normal">/ 目標 {currentProfile.bgmTargetLufs} LUFS</span>
              </span>
            </div>
            <div className="w-full bg-[#1e2838] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-indigo-400 h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(5, ((bgmLoudness?.estimatedLufs ?? -35) + 40) * 3))}%`,
                }}
              />
            </div>
          </div>

          {/* Ambience row */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-emerald-300 flex items-center space-x-1">
                <Wind className="w-3 h-3 text-emerald-400" />
                <span>自然音 (風・せせらぎ)</span>
              </span>
              <span className="font-mono text-gray-300">
                {ambienceLoudness ? `${ambienceLoudness.estimatedLufs} LUFS` : '無効'}
                <span className="text-[#64748B] ml-1.5 font-normal">/ 目標 {currentProfile.ambienceTargetLufs} LUFS</span>
              </span>
            </div>
            <div className="w-full bg-[#1e2838] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-400 h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(5, ((ambienceLoudness?.estimatedLufs ?? -38) + 40) * 3))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Normalize All Action Button */}
        <button
          onClick={handleNormalizeAll}
          className="w-full py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#E5C07B] hover:brightness-110 text-[#0B0D11] text-xs font-bold rounded-lg shadow-md flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-[#0B0D11]" />
          <span>全トラックを一括ノーマライズ ({currentProfile.name})</span>
        </button>

        {/* Feedback Alert Toast */}
        {normalizationNotice && (
          <div className="bg-emerald-950/60 border border-emerald-500/60 rounded-lg p-2.5 text-xs text-emerald-200 flex items-start space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-tight">{normalizationNotice}</span>
          </div>
        )}

        {/* Recent Adjustments Breakdown Summary */}
        {recentSummary && recentSummary.length > 0 && (
          <div className="bg-[#10141d] p-2 rounded border border-[#202938] space-y-1 text-[11px]">
            <span className="text-gray-400 block font-medium">調整詳細:</span>
            {recentSummary.map((item, idx) => {
              const sign = item.gainDeltaDb >= 0 ? `+${item.gainDeltaDb}` : `${item.gainDeltaDb}`;
              return (
                <div key={idx} className="flex justify-between items-center text-gray-300 font-mono">
                  <span className="truncate max-w-[140px] text-gray-200">{item.trackName}</span>
                  <span>
                    {Math.round(item.oldVol * 100)}% → <span className="text-[#D4AF37] font-semibold">{Math.round(item.newVol * 100)}%</span> ({sign}dB)
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ✂️ 2. Audio Trimming & Timing Control (オーディオトリミング・時間調整スライダー) */}
      <div className="bg-[#131924] border border-[#242f40] rounded-xl p-3.5 space-y-3.5 shadow-md">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5 text-xs">
            <Scissors className="w-4 h-4 text-[#D4AF37]" />
            <span>オーディオトリミング & 時間調整</span>
          </span>
          {activeTrack && (
            <span className="text-[10px] font-mono text-[#A0AEC0] bg-[#1a2332] px-2 py-0.5 rounded border border-[#26354b]">
              {activeTrack.startTime.toFixed(1)}s 〜 {(activeTrack.startTime + activeTrack.duration).toFixed(1)}s
            </span>
          )}
        </div>

        <p className="text-[11px] text-[#8A99AD] leading-relaxed">
          タイムライン上の音声クリップを選択し、開始時間・長さ・冒頭無音カットをスライダーで視覚的に調整できます。
        </p>

        {project.audioTracks.length === 0 ? (
          <div className="text-center py-4 text-xs text-gray-400 border border-dashed border-[#263345] rounded-lg">
            音声トラックがありません。ナレーションを録音するか、BGMを読み込んでください。
          </div>
        ) : (
          <div className="space-y-3">
            {/* Track Selector Pills */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-400 uppercase font-medium">調整対象トラックを選択:</label>
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
                {project.audioTracks.map((tr) => {
                  const isCur = activeTrack?.id === tr.id;
                  return (
                    <button
                      key={tr.id}
                      onClick={() => onSelectAudio?.(tr.id)}
                      className={`px-2.5 py-1 rounded-md text-xs flex items-center space-x-1.5 shrink-0 border transition-all cursor-pointer ${
                        isCur
                          ? 'bg-[#292015] border-[#D4AF37] text-[#F7E7B4] shadow-sm font-semibold ring-1 ring-[#D4AF37]/30'
                          : 'bg-[#151c27] border-[#222d3d] text-gray-400 hover:text-gray-200 hover:bg-[#1a2332]'
                      }`}
                    >
                      {tr.type === 'narration' && <Mic className="w-3 h-3 text-red-400 shrink-0" />}
                      {tr.type === 'bgm' && <Music className="w-3 h-3 text-indigo-400 shrink-0" />}
                      {tr.type === 'ambience' && <Wind className="w-3 h-3 text-emerald-400 shrink-0" />}
                      <span className="truncate max-w-[120px]">{tr.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTrack && (
              <div className="bg-[#0e131d] border border-[#202b3c] rounded-lg p-3 space-y-3 text-xs">
                {/* Visual Mini-Timeline Span Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                    <span>0.0s</span>
                    <span className="text-[#D4AF37] font-semibold">{activeTrack.name} ({activeTrack.duration.toFixed(1)}秒間)</span>
                    <span>{Math.floor(project.duration)}s</span>
                  </div>

                  <div className="relative h-9 w-full bg-[#080b11] rounded-md border border-[#1e2738] overflow-hidden">
                    {/* Active Trimmed Region */}
                    <div
                      className="absolute top-0 bottom-0 rounded overflow-hidden flex items-center border transition-all duration-100"
                      style={{
                        left: `${(activeTrack.startTime / Math.max(1, project.duration)) * 100}%`,
                        width: `${Math.max(2, (activeTrack.duration / Math.max(1, project.duration)) * 100)}%`,
                        borderColor: activeTrack.type === 'narration' ? '#EF4444' : activeTrack.type === 'bgm' ? '#818CF8' : '#34D399',
                        backgroundColor: activeTrack.type === 'narration' ? 'rgba(239, 68, 68, 0.22)' : activeTrack.type === 'bgm' ? 'rgba(129, 140, 248, 0.22)' : 'rgba(52, 211, 153, 0.22)',
                      }}
                    >
                      <WaveformVisualizer
                        waveform={activeTrack.waveform}
                        color={activeTrack.type === 'narration' ? '#F87171' : activeTrack.type === 'bgm' ? '#818CF8' : '#34D399'}
                        volume={activeTrack.volume}
                      />
                    </div>

                    {/* Red Playhead Needle */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-[#C84B31] pointer-events-none z-10"
                      style={{ left: `${(currentTime / Math.max(1, project.duration)) * 100}%` }}
                    >
                      <div className="w-2.5 h-2.5 -ml-[4px] -mt-0.5 bg-[#C84B31] rotate-45 rounded-xs shadow" />
                    </div>
                  </div>
                </div>

                {/* Quick Playhead Snapping Action Buttons */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    onClick={() => {
                      const newStart = Math.max(0, Math.min(project.duration - 0.5, Math.floor(currentTime * 10) / 10));
                      handleUpdateTrack(activeTrack.id, { startTime: newStart });
                    }}
                    className="py-1 px-2 bg-[#172130] hover:bg-[#202d42] border border-[#2a3c57] rounded text-[11px] text-[#93C5FD] flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                    title="現在位置に音声クリップの開始時間を移動"
                  >
                    <Crosshair className="w-3 h-3 text-[#60A5FA]" />
                    <span>再生位置 ({currentTime.toFixed(1)}s) から開始</span>
                  </button>

                  <button
                    onClick={() => {
                      if (currentTime > activeTrack.startTime) {
                        const newDuration = Math.max(0.5, Math.floor((currentTime - activeTrack.startTime) * 10) / 10);
                        handleUpdateTrack(activeTrack.id, { duration: newDuration });
                      }
                    }}
                    className="py-1 px-2 bg-[#26171b] hover:bg-[#361e24] border border-[#522b34] rounded text-[11px] text-[#FCA5A5] flex items-center justify-center space-x-1 cursor-pointer transition-colors"
                    title="現在位置でクリップをカット（終了）"
                  >
                    <Scissors className="w-3 h-3 text-red-400" />
                    <span>再生位置 ({currentTime.toFixed(1)}s) で終了</span>
                  </button>
                </div>

                {/* Slider 1: 開始時間 (startTime) */}
                <div className="space-y-1.5 pt-2 border-t border-[#1a2332]">
                  <div className="flex justify-between items-center text-gray-300">
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>① タイムライン開始時間:</span>
                    </span>
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={Math.max(0, project.duration - 0.5)}
                        value={activeTrack.startTime}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value) || 0);
                          handleUpdateTrack(activeTrack.id, { startTime: val });
                        }}
                        className="w-16 bg-[#182130] border border-[#2b3a4f] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
                      />
                      <span className="text-gray-400 font-mono">秒</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, project.duration - 0.5)}
                    step="0.1"
                    value={activeTrack.startTime}
                    onChange={(e) =>
                      handleUpdateTrack(activeTrack.id, { startTime: parseFloat(e.target.value) })
                    }
                    className="w-full h-1.5 bg-[#1f293a] accent-[#D4AF37] cursor-pointer"
                  />

                  <div className="flex justify-end space-x-1 text-[10px]">
                    <button
                      onClick={() => handleUpdateTrack(activeTrack.id, { startTime: 0 })}
                      className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                    >
                      先頭 (0.0s)
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateTrack(activeTrack.id, {
                          startTime: Math.max(0, Math.round((activeTrack.startTime - 0.5) * 10) / 10),
                        })
                      }
                      className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                    >
                      -0.5秒
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateTrack(activeTrack.id, {
                          startTime: Math.round((activeTrack.startTime + 0.5) * 10) / 10,
                        })
                      }
                      className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                    >
                      +0.5秒
                    </button>
                  </div>
                </div>

                {/* Slider 2: 長さ・デュレーション (duration) */}
                <div className="space-y-1.5 pt-2 border-t border-[#1a2332]">
                  <div className="flex justify-between items-center text-gray-300">
                    <span className="flex items-center space-x-1">
                      <MoveHorizontal className="w-3.5 h-3.5 text-[#60A5FA]" />
                      <span>② クリップの長さ (再生時間):</span>
                    </span>
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max={Math.max(project.duration, 120)}
                        value={activeTrack.duration}
                        onChange={(e) => {
                          const val = Math.max(0.5, parseFloat(e.target.value) || 0.5);
                          handleUpdateTrack(activeTrack.id, { duration: val });
                        }}
                        className="w-16 bg-[#182130] border border-[#2b3a4f] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
                      />
                      <span className="text-gray-400 font-mono">秒</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0.5"
                    max={Math.max(project.duration, 60)}
                    step="0.1"
                    value={activeTrack.duration}
                    onChange={(e) =>
                      handleUpdateTrack(activeTrack.id, { duration: parseFloat(e.target.value) })
                    }
                    className="w-full h-1.5 bg-[#1f293a] accent-[#60A5FA] cursor-pointer"
                  />

                  <div className="flex justify-end space-x-1 text-[10px]">
                    <button
                      onClick={() =>
                        handleUpdateTrack(activeTrack.id, {
                          duration: Math.max(0.5, Math.round((activeTrack.duration - 1.0) * 10) / 10),
                        })
                      }
                      className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                    >
                      -1.0秒
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateTrack(activeTrack.id, {
                          duration: Math.round((activeTrack.duration + 1.0) * 10) / 10,
                        })
                      }
                      className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                    >
                      +1.0秒
                    </button>
                  </div>
                </div>

                {/* Slider 3: 音源冒頭カット (trimStart) */}
                <div className="space-y-1.5 pt-2 border-t border-[#1a2332]">
                  <div className="flex justify-between items-center text-gray-300">
                    <span className="flex items-center space-x-1" title="録音開始時の無音や息継ぎをスキップ">
                      <Scissors className="w-3.5 h-3.5 text-amber-400" />
                      <span>③ 音源の冒頭カット (息継ぎ・無音スキップ):</span>
                    </span>
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="10"
                        value={activeTrack.trimStart || 0}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value) || 0);
                          handleUpdateTrack(activeTrack.id, { trimStart: val });
                        }}
                        className="w-16 bg-[#182130] border border-[#2b3a4f] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
                      />
                      <span className="text-gray-400 font-mono">秒</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="5.0"
                    step="0.05"
                    value={activeTrack.trimStart || 0}
                    onChange={(e) =>
                      handleUpdateTrack(activeTrack.id, { trimStart: parseFloat(e.target.value) })
                    }
                    className="w-full h-1.5 bg-[#1f293a] accent-amber-400 cursor-pointer"
                  />

                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>※ 音源ファイルの先頭から指定秒数スキップして再生</span>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => handleUpdateTrack(activeTrack.id, { trimStart: 0 })}
                        className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                      >
                        0.0s (カットなし)
                      </button>
                      <button
                        onClick={() => handleUpdateTrack(activeTrack.id, { trimStart: 0.2 })}
                        className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                      >
                        +0.2s
                      </button>
                      <button
                        onClick={() => handleUpdateTrack(activeTrack.id, { trimStart: 0.5 })}
                        className="px-1.5 py-0.5 bg-[#161f2c] hover:bg-[#202b3d] text-gray-300 rounded border border-[#243347] cursor-pointer"
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                </div>

                {/* Slider 4: フェードイン・フェードアウト時間 (Fade In & Fade Out) */}
                <div className="space-y-2 pt-2 border-t border-[#1a2332]">
                  <div className="flex justify-between items-center text-gray-300">
                    <span className="flex items-center space-x-1">
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>④ フェード設定 (余韻・滑らかな立ち上がり):</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 bg-[#111722] p-2 rounded-lg border border-[#1d2737]">
                    {/* Fade In */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-gray-300">
                        <span>フェードイン:</span>
                        <span className="font-mono text-emerald-300">
                          {(activeTrack.fadeInSec ?? (activeTrack.type === 'narration' ? 0.05 : 1.5)).toFixed(1)}秒
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="4.0"
                        step="0.1"
                        value={activeTrack.fadeInSec ?? (activeTrack.type === 'narration' ? 0.05 : 1.5)}
                        onChange={(e) =>
                          handleUpdateTrack(activeTrack.id, { fadeInSec: parseFloat(e.target.value) })
                        }
                        className="w-full h-1 bg-[#1f293a] accent-emerald-400 cursor-pointer"
                      />
                      <div className="flex space-x-1 text-[9px]">
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeInSec: 0 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          なし
                        </button>
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeInSec: 1.0 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          1.0s
                        </button>
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeInSec: 2.0 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          2.0s
                        </button>
                      </div>
                    </div>

                    {/* Fade Out */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-gray-300">
                        <span>フェードアウト:</span>
                        <span className="font-mono text-emerald-300">
                          {(activeTrack.fadeOutSec ?? (activeTrack.type === 'narration' ? 0.1 : 2.0)).toFixed(1)}秒
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="5.0"
                        step="0.1"
                        value={activeTrack.fadeOutSec ?? (activeTrack.type === 'narration' ? 0.1 : 2.0)}
                        onChange={(e) =>
                          handleUpdateTrack(activeTrack.id, { fadeOutSec: parseFloat(e.target.value) })
                        }
                        className="w-full h-1 bg-[#1f293a] accent-emerald-400 cursor-pointer"
                      />
                      <div className="flex space-x-1 text-[9px]">
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeOutSec: 0 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          なし
                        </button>
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeOutSec: 1.5 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          1.5s
                        </button>
                        <button
                          onClick={() => handleUpdateTrack(activeTrack.id, { fadeOutSec: 3.0 })}
                          className="px-1 py-0.5 bg-[#17202c] hover:bg-[#202c3d] text-gray-400 rounded cursor-pointer"
                        >
                          3.0s (余韻)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Final Status Readout */}
                <div className="bg-[#121924] p-2 rounded border border-[#1d2736] flex justify-between items-center text-[11px] text-gray-300">
                  <span className="text-gray-400">タイムライン再生区間:</span>
                  <span className="font-mono text-[#F7E7B4] font-semibold">
                    {activeTrack.startTime.toFixed(1)}s 〜 {(activeTrack.startTime + activeTrack.duration).toFixed(1)}s (有効長: {activeTrack.duration.toFixed(1)}s)
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Microphone Narration Booth */}
      <div className="bg-[#141924] border border-[#232d3d] rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#EF4444] flex items-center space-x-1.5 text-xs">
            <Mic className="w-4 h-4 text-red-400" />
            <span>ブラウザ直接 ナレーション収録</span>
          </span>
          <span className="text-[10px] text-gray-400 font-mono">現在位置: {currentTime.toFixed(1)}s</span>
        </div>

        <p className="text-[11px] text-[#8A99AD] leading-relaxed">
          「録音開始」を押してマイクに向かって話すと、現在の再生位置にナレーション音声が自動でタイムライン配置されます。
        </p>

        <button
          onClick={onToggleRecordMic}
          className={`w-full py-2.5 rounded-lg font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md cursor-pointer ${
            isRecordingMic
              ? 'bg-red-600 text-white animate-pulse shadow-red-500/40'
              : 'bg-[#291717] hover:bg-[#3d1e1e] border border-[#782828] text-red-200'
          }`}
        >
          {isRecordingMic ? (
            <>
              <MicOff className="w-4 h-4" />
              <span>● 録音を停止してタイムラインに配置</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-red-400" />
              <span>マイク録音を開始（{currentTime.toFixed(1)}sから）</span>
            </>
          )}
        </button>

        {/* Narration Clips List with Track Normalization */}
        {narrationTracks.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[#1f2735]">
            <span className="text-[11px] text-gray-400 block font-medium">録音済みナレーション一覧:</span>
            {narrationTracks.map((narr) => {
              const narrLoud = audioEngine.calculateLoudness(narr);
              return (
                <div
                  key={narr.id}
                  className="bg-[#1b1717] border border-[#3d2424] rounded-lg p-2.5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="truncate flex items-center space-x-2">
                      <Mic className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate font-medium text-white">{narr.name}</span>
                      <span className="text-[10px] text-gray-500 font-mono">
                        ({narr.startTime}s - {(narr.startTime + narr.duration).toFixed(1)}s)
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteTrack(narr.id)}
                      className="text-gray-500 hover:text-red-400 p-1 cursor-pointer"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-300">
                    <span className="font-mono text-red-300">
                      音量: {Math.round(narr.volume * 100)}% ({narrLoud.estimatedLufs} LUFS)
                    </span>
                    <button
                      onClick={() => handleNormalizeSingleTrack(narr.id, currentProfile.narrationTargetLufs)}
                      className="px-2 py-0.5 bg-[#2a1d1d] hover:bg-[#382626] border border-red-500/50 text-red-200 rounded text-[10px] flex items-center space-x-1 cursor-pointer transition-colors"
                      title="このナレーションクリップのみを目標LUFSに自動補正"
                    >
                      <Gauge className="w-3 h-3 text-red-400" />
                      <span>{currentProfile.narrationTargetLufs} LUFSにノーマライズ</span>
                    </button>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={narr.volume}
                    onChange={(e) => handleUpdateTrack(narr.id, { volume: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-[#3d2424] accent-red-500"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. BGM & Automatic Ducking Settings */}
      <div className="bg-[#141924] border border-[#232d3d] rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5 text-xs">
            <Music className="w-4 h-4 text-[#A78BFA]" />
            <span>雅楽・瞑想BGM & 自動ダッキング</span>
          </span>
          <span className="text-[10px] bg-amber-400/10 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded">
            Auto-Ducking
          </span>
        </div>

        <p className="text-[11px] text-[#8A99AD] leading-relaxed">
          ナレーション再生時、BGM音量を自動で滑らかに下げることで、語りの声が澄んで明瞭に聞こえるよう自動調整されます。
        </p>

        {bgmTrack && (
          <div className="space-y-3 text-xs bg-[#192130] p-2.5 rounded border border-[#263345]">
            <div>
              <div className="flex justify-between items-center text-gray-300 mb-1">
                <span>
                  通常時 BGM音量: <span className="font-mono text-[#D4AF37]">{Math.round(bgmTrack.volume * 100)}%</span>
                  {bgmLoudness && (
                    <span className="text-[10px] text-gray-400 ml-1.5 font-mono">({bgmLoudness.estimatedLufs} LUFS)</span>
                  )}
                </span>
                <button
                  onClick={() => handleNormalizeSingleTrack(bgmTrack.id, currentProfile.bgmTargetLufs)}
                  className="px-2 py-0.5 bg-[#202738] hover:bg-[#2b354c] border border-indigo-400/50 text-indigo-200 rounded text-[10px] flex items-center space-x-1 cursor-pointer transition-colors"
                  title="BGMのみを目標LUFSに自動補正"
                >
                  <Gauge className="w-3 h-3 text-indigo-400" />
                  <span>{currentProfile.bgmTargetLufs} LUFSにノーマライズ</span>
                </button>
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bgmTrack.volume}
                onChange={(e) => handleUpdateTrack(bgmTrack.id, { volume: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-[#2b3a4f] accent-[#D4AF37]"
              />

              {/* BGM Waveform Visualizer Preview */}
              <div className="h-6 w-full bg-[#111722] rounded mt-2 px-1 border border-[#1f2838] overflow-hidden flex items-center">
                <WaveformVisualizer
                  waveform={bgmTrack.waveform}
                  color="#818CF8"
                  volume={bgmTrack.volume}
                />
              </div>
            </div>

            {/* Auto Ducking Toggle & Level */}
            <div className="pt-2 border-t border-[#263345] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-300 font-medium">ナレーション中の音量低下 (ダッキング)</span>
                <input
                  type="checkbox"
                  checked={bgmTrack.autoDucking?.enabled ?? true}
                  onChange={(e) =>
                    handleUpdateTrack(bgmTrack.id, {
                      autoDucking: {
                        ...(bgmTrack.autoDucking || { duckVolume: 0.2, fadeSec: 0.4 }),
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="rounded text-[#D4AF37]"
                />
              </div>

              {bgmTrack.autoDucking?.enabled && (
                <div>
                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                    <span>ナレーション発話時のBGM倍率:</span>
                    <span className="font-mono text-amber-300">
                      {Math.round((bgmTrack.autoDucking.duckVolume ?? 0.2) * 100)}% に減衰
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.5"
                    step="0.05"
                    value={bgmTrack.autoDucking.duckVolume ?? 0.2}
                    onChange={(e) =>
                      handleUpdateTrack(bgmTrack.id, {
                        autoDucking: {
                          ...bgmTrack.autoDucking!,
                          duckVolume: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full h-1 bg-[#2b3a4f] accent-amber-400"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => bgmFileInputRef.current?.click()}
          className="w-full py-1.5 bg-[#1e2736] hover:bg-[#283547] border border-[#334257] rounded text-xs text-gray-200 flex items-center justify-center space-x-1 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-[#A78BFA]" />
          <span>手持ちのBGM音源（MP3, WAV等）を読み込む</span>
        </button>
        <input
          ref={bgmFileInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleUploadAudio(e, 'bgm')}
          className="hidden"
        />
      </div>

      {/* 4. Ambience & Nature Sound */}
      <div className="bg-[#141924] border border-[#232d3d] rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#10B981] flex items-center space-x-1.5 text-xs">
            <Wind className="w-4 h-4 text-emerald-400" />
            <span>自然音・環境音（せせらぎ／鳥の声／風）</span>
          </span>
        </div>

        {ambienceTrack && (
          <div className="bg-[#192130] p-2.5 rounded border border-[#263345] space-y-2 text-xs">
            <div className="flex justify-between items-center text-gray-300">
              <span>
                環境音音量: <span className="font-mono text-emerald-400">{Math.round(ambienceTrack.volume * 100)}%</span>
                {ambienceLoudness && (
                  <span className="text-[10px] text-gray-400 ml-1.5 font-mono">({ambienceLoudness.estimatedLufs} LUFS)</span>
                )}
              </span>
              <button
                onClick={() => handleNormalizeSingleTrack(ambienceTrack.id, currentProfile.ambienceTargetLufs)}
                className="px-2 py-0.5 bg-[#172620] hover:bg-[#21382e] border border-emerald-500/50 text-emerald-200 rounded text-[10px] flex items-center space-x-1 cursor-pointer transition-colors"
                title="自然音のみを目標LUFSに自動補正"
              >
                <Gauge className="w-3 h-3 text-emerald-400" />
                <span>{currentProfile.ambienceTargetLufs} LUFSにノーマライズ</span>
              </button>
            </div>

            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ambienceTrack.volume}
              onChange={(e) =>
                handleUpdateTrack(ambienceTrack.id, { volume: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 bg-[#2b3a4f] accent-emerald-400"
            />

            {/* Ambience Waveform Visualizer Preview */}
            <div className="h-6 w-full bg-[#111722] rounded mt-2 px-1 border border-[#1f2838] overflow-hidden flex items-center">
              <WaveformVisualizer
                waveform={ambienceTrack.waveform}
                color="#34D399"
                volume={ambienceTrack.volume}
              />
            </div>
          </div>
        )}

        <button
          onClick={() => ambienceFileInputRef.current?.click()}
          className="w-full py-1.5 bg-[#1e2736] hover:bg-[#283547] border border-[#334257] rounded text-xs text-gray-200 flex items-center justify-center space-x-1 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-emerald-400" />
          <span>自然音の音源ファイルを読み込む</span>
        </button>
        <input
          ref={ambienceFileInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleUploadAudio(e, 'ambience')}
          className="hidden"
        />
      </div>
    </div>
  );
};
