import React, { useRef, useEffect, useState } from 'react';
import { ProjectData, SupportedLanguage } from '../types';
import { canvasRenderer } from '../services/canvasRenderer';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Mic,
  MicOff,
  Volume2,
  HelpCircle,
  Activity,
} from 'lucide-react';

interface VideoPreviewProps {
  project: ProjectData;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  previewLang: SupportedLanguage;
  isRecordingMic: boolean;
  onToggleRecordMic: () => void;
  onOpenShortcuts?: () => void;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  project,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  previewLang,
  isRecordingMic,
  onToggleRecordMic,
  onOpenShortcuts,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Simulated live VU meter level states (Left & Right channel)
  const [vuLevelL, setVuLevelL] = useState<number>(0);
  const [vuLevelR, setVuLevelR] = useState<number>(0);

  // Re-render canvas whenever currentTime, project, or language changes
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    canvasRenderer.renderFrame(ctx, project, currentTime, previewLang, isPlaying);
  }, [currentTime, project, previewLang, isPlaying]);

  // Audio VU Meter animation loop
  useEffect(() => {
    if (!isPlaying) {
      setVuLevelL(0);
      setVuLevelR(0);
      return;
    }

    let frameId: number;
    const updateVUMeter = () => {
      // Find active tracks at current time
      const activeAudio = project.audioTracks.filter(
        (t) => currentTime >= t.startTime && currentTime < t.startTime + t.duration
      );

      const isNarrationSpeaking = activeAudio.some((t) => t.type === 'narration');

      let combinedVol = 0;
      for (const t of activeAudio) {
        if (project.mutedTracks?.[t.type]) continue;
        if (t.type === 'bgm' && isNarrationSpeaking && t.autoDucking?.enabled !== false) {
          combinedVol += t.volume * (t.autoDucking?.duckVolume ?? 0.25);
        } else {
          combinedVol += t.volume;
        }
      }

      // Add gentle dynamic rhythm fluctuations
      const baseLevel = Math.min(1.0, combinedVol * 0.75);
      const jitterL = Math.sin(Date.now() * 0.015) * 0.15 + (Math.random() - 0.5) * 0.08;
      const jitterR = Math.cos(Date.now() * 0.017) * 0.15 + (Math.random() - 0.5) * 0.08;

      const levelL = Math.max(0, Math.min(0.98, baseLevel + jitterL));
      const levelR = Math.max(0, Math.min(0.98, baseLevel + jitterR));

      setVuLevelL(levelL);
      setVuLevelR(levelR);

      frameId = requestAnimationFrame(updateVUMeter);
    };

    frameId = requestAnimationFrame(updateVUMeter);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, currentTime, project.audioTracks, project.mutedTracks]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  };

  const handleStep = (delta: number) => {
    const next = Math.max(0, Math.min(project.duration, currentTime + delta));
    onSeek(next);
  };

  const isLandscape = project.aspectRatio === '16:9';

  return (
    <div className="flex-1 flex flex-col bg-[#0b0d11] items-center justify-between p-3 select-none overflow-hidden border-b border-[#1f2631]">
      {/* Aspect Ratio Container */}
      <div className="w-full flex-1 flex items-center justify-center relative min-h-0">
        <div
          className={`relative border border-[#26303d] rounded-md shadow-2xl bg-black overflow-hidden flex items-center justify-center ${
            isLandscape ? 'aspect-video max-h-[92%] w-auto max-w-[96%]' : 'aspect-[9/16] max-h-[96%] w-auto'
          }`}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain pointer-events-none"
          />

          {/* Recording Badge on Canvas */}
          {isRecordingMic && (
            <div className="absolute top-4 left-4 flex items-center space-x-2 bg-red-950/80 border border-red-500/80 px-3 py-1 rounded-full animate-pulse z-10">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              <span className="text-xs font-semibold text-red-200">ナレーション録音中...</span>
            </div>
          )}

          {/* Aspect ratio watermark */}
          <div className="absolute top-3 right-3 text-[10px] text-white/40 tracking-wider font-mono bg-black/60 px-2 py-0.5 rounded">
            {project.aspectRatio} • {isLandscape ? '1920x1080' : '1080x1920'}
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="w-full max-w-4xl bg-[#131821] border border-[#222b38] rounded-lg px-4 py-2 mt-2 flex items-center justify-between space-x-3 shadow-lg">
        {/* Playback Transport Buttons */}
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onSeek(0)}
            className="p-1.5 text-[#9aa0a6] hover:text-[#D4AF37] hover:bg-[#1a2330] rounded transition-colors"
            title="先頭へ戻る (Home)"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleStep(-1 / 30)}
            className="p-1.5 text-[#9aa0a6] hover:text-[#D4AF37] hover:bg-[#1a2330] rounded transition-colors"
            title="1コマ戻る (←)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={onTogglePlay}
            className={`p-2 rounded-full transition-all shadow-md mx-1 ${
              isPlaying
                ? 'bg-[#c84b31] text-white hover:bg-[#d8583d]'
                : 'bg-[#D4AF37] text-[#0B0D11] hover:brightness-110'
            }`}
            title={isPlaying ? '一時停止 (Space)' : '再生 (Space)'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          <button
            onClick={() => handleStep(1 / 30)}
            className="p-1.5 text-[#9aa0a6] hover:text-[#D4AF37] hover:bg-[#1a2330] rounded transition-colors"
            title="1コマ進む (→)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSeek(project.duration)}
            className="p-1.5 text-[#9aa0a6] hover:text-[#D4AF37] hover:bg-[#1a2330] rounded transition-colors"
            title="末尾へ移動 (End)"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>

        {/* Scrub Bar & Time display */}
        <div className="flex-1 flex items-center space-x-3">
          <input
            type="range"
            min="0"
            max={project.duration}
            step="0.05"
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="flex-1 h-1.5 bg-[#253040] rounded-lg appearance-none cursor-pointer accent-[#D4AF37]"
          />

          <div className="font-mono text-xs text-[#aeb5c0] w-28 text-right select-none shrink-0">
            <span className="text-[#F7F6F2] font-semibold">{formatTime(currentTime)}</span>
            <span className="text-[#64748b]"> / {formatTime(project.duration)}</span>
          </div>
        </div>

        {/* Real-time Stereo VU Meter */}
        <div className="hidden sm:flex items-center space-x-1.5 px-2 py-1 bg-[#0b0e14] border border-[#202735] rounded font-mono text-[9px] shrink-0">
          <Activity className="w-3 h-3 text-[#D4AF37]" />
          <div className="flex flex-col space-y-1 w-16">
            {/* L Channel */}
            <div className="h-1.5 w-full bg-[#1b222f] rounded-full overflow-hidden flex">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${vuLevelL * 100}%`,
                  background:
                    vuLevelL > 0.85
                      ? 'linear-gradient(to right, #10B981, #F59E0B, #EF4444)'
                      : vuLevelL > 0.65
                      ? 'linear-gradient(to right, #10B981, #F59E0B)'
                      : '#10B981',
                }}
              />
            </div>
            {/* R Channel */}
            <div className="h-1.5 w-full bg-[#1b222f] rounded-full overflow-hidden flex">
              <div
                className="h-full transition-all duration-75 rounded-full"
                style={{
                  width: `${vuLevelR * 100}%`,
                  background:
                    vuLevelR > 0.85
                      ? 'linear-gradient(to right, #10B981, #F59E0B, #EF4444)'
                      : vuLevelR > 0.65
                      ? 'linear-gradient(to right, #10B981, #F59E0B)'
                      : '#10B981',
                }}
              />
            </div>
          </div>
          <span className="text-[9px] text-gray-400 font-mono w-7 text-right">
            {isPlaying ? `${Math.round((vuLevelL - 1) * 36)}dB` : '-∞'}
          </span>
        </div>

        {/* Narration Quick Mic Button */}
        <div className="flex items-center space-x-1.5 pl-2 border-l border-[#253040]">
          <button
            onClick={onToggleRecordMic}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              isRecordingMic
                ? 'bg-red-600 text-white animate-pulse shadow-red-500/50 shadow-md'
                : 'bg-[#1e2735] text-[#e2e8f0] hover:bg-[#283547] hover:text-white border border-[#374457]'
            }`}
            title="現在位置からナレーションをマイク録音 (R)"
          >
            {isRecordingMic ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-red-400" />}
            <span>{isRecordingMic ? '録音停止' : '録音'}</span>
          </button>

          {/* Shortcuts Help */}
          {onOpenShortcuts && (
            <button
              onClick={onOpenShortcuts}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1a2330] rounded transition-colors"
              title="キーボードショートカット一覧 (?)"
            >
              <HelpCircle className="w-4 h-4 text-[#A0AEC0]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
