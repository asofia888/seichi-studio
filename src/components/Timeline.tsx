import React, { useRef, useState, useEffect } from 'react';
import { ProjectData, VideoClipItem, MultilingualSubtitleItem, AudioTrackItem } from '../types';
import { WaveformVisualizer } from './WaveformVisualizer';
import {
  Film,
  Type,
  Mic,
  Music,
  Wind,
  Plus,
  Trash2,
  MapPin,
  Sparkles,
  Scissors,
  Magnet,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface TimelineProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onSelectTrackItem: (type: string, id: string) => void;
  selectedItemId: string | null;
  onDeleteClip: (id: string) => void;
  onDeleteSubtitle: (id: string) => void;
  onDeleteAudio?: (id: string) => void;
  onSplitAtPlayhead?: () => void;
}

type DragMode = 'move' | 'trim-start' | 'trim-end';

interface DragState {
  itemType: 'clip' | 'subtitle' | 'audio' | 'access';
  itemId: string;
  mode: DragMode;
  startX: number;
  initialStartTime: number;
  initialDuration: number;
  initialTrimStart: number;
}

export const Timeline: React.FC<TimelineProps> = ({
  project,
  onUpdateProject,
  currentTime,
  onSeek,
  onSelectTrackItem,
  selectedItemId,
  onDeleteClip,
  onDeleteSubtitle,
  onDeleteAudio,
  onSplitAtPlayhead,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollWrapperRef = useRef<HTMLDivElement | null>(null);

  // Timeline UI States
  const [zoomLevel, setZoomLevel] = useState<number>(1.0); // 1.0x to 4.0x
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [ghostPreview, setGhostPreview] = useState<{ startTime: number; duration: number } | null>(null);

  // Guard against a non-finite duration: the tick loop below would never terminate
  const duration = Number.isFinite(project.duration) ? Math.max(10, project.duration) : 10;

  // Muted tracks state helper
  const mutedTracks = project.mutedTracks || {};

  const handleToggleMute = (trackKey: 'video' | 'subtitles' | 'narration' | 'ambience' | 'bgm') => {
    const updatedMuted = {
      ...mutedTracks,
      [trackKey]: !mutedTracks[trackKey],
    };
    onUpdateProject({
      ...project,
      mutedTracks: updatedMuted,
      updatedAt: new Date().toISOString(),
    });
  };

  // Convert client coordinate X to timeline seconds
  const getSecondsFromClientX = (clientX: number): number => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    return ratio * duration;
  };

  // Handle scrubber click / seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState) return;
    const time = getSecondsFromClientX(e.clientX);
    onSeek(time);
  };

  const getPositionPercent = (time: number) => {
    return (time / duration) * 100;
  };

  const getWidthPercent = (dur: number) => {
    return (dur / duration) * 100;
  };

  // Collect potential snap points (playhead, 0, start/end of all clips)
  const getSnapPoints = (excludeId?: string): number[] => {
    const points = [0, currentTime, duration];
    project.videoClips.forEach((c) => {
      if (c.id !== excludeId) {
        points.push(c.startTime, c.startTime + c.duration);
      }
    });
    project.subtitles.forEach((s) => {
      if (s.id !== excludeId) {
        points.push(s.startTime, s.startTime + s.duration);
      }
    });
    project.audioTracks.forEach((a) => {
      if (a.id !== excludeId) {
        points.push(a.startTime, a.startTime + a.duration);
      }
    });
    return points;
  };

  // Apply snap logic if within threshold
  const applySnap = (targetTime: number, excludeId?: string, thresholdSec = 0.4): number => {
    if (!snapEnabled) return targetTime;
    const points = getSnapPoints(excludeId);
    let closest = targetTime;
    let minDiff = thresholdSec;
    for (const p of points) {
      const diff = Math.abs(p - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }
    return closest;
  };

  // Drag interaction handlers
  const startDrag = (
    e: React.MouseEvent,
    itemType: 'clip' | 'subtitle' | 'audio' | 'access',
    itemId: string,
    mode: DragMode,
    initialStartTime: number,
    initialDuration: number,
    initialTrimStart = 0
  ) => {
    e.stopPropagation();
    onSelectTrackItem(itemType, itemId);

    setDragState({
      itemType,
      itemId,
      mode,
      startX: e.clientX,
      initialStartTime,
      initialDuration,
      initialTrimStart,
    });

    setGhostPreview({
      startTime: initialStartTime,
      duration: initialDuration,
    });
  };

  // Global mousemove and mouseup listeners for drag and trim operations
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pixelsPerSec = rect.width / duration;
      const deltaSec = (e.clientX - dragState.startX) / pixelsPerSec;

      if (dragState.mode === 'move') {
        let newStart = Math.max(0, dragState.initialStartTime + deltaSec);
        newStart = applySnap(newStart, dragState.itemId);
        // Ensure within timeline bounds
        newStart = Math.min(duration - 0.5, newStart);
        setGhostPreview({
          startTime: newStart,
          duration: dragState.initialDuration,
        });
      } else if (dragState.mode === 'trim-start') {
        let proposedStart = Math.max(0, dragState.initialStartTime + deltaSec);
        proposedStart = applySnap(proposedStart, dragState.itemId);
        const maxStart = dragState.initialStartTime + dragState.initialDuration - 0.5;
        proposedStart = Math.min(maxStart, proposedStart);
        const newDuration = dragState.initialStartTime + dragState.initialDuration - proposedStart;
        setGhostPreview({
          startTime: proposedStart,
          duration: Math.max(0.5, newDuration),
        });
      } else if (dragState.mode === 'trim-end') {
        let proposedEnd = dragState.initialStartTime + dragState.initialDuration + deltaSec;
        proposedEnd = applySnap(proposedEnd, dragState.itemId);
        const minEnd = dragState.initialStartTime + 0.5;
        proposedEnd = Math.max(minEnd, proposedEnd);
        const newDuration = proposedEnd - dragState.initialStartTime;
        setGhostPreview({
          startTime: dragState.initialStartTime,
          duration: Math.max(0.5, newDuration),
        });
      }
    };

    const handleMouseUp = () => {
      if (ghostPreview && dragState) {
        // Apply changes to project state
        const { itemType, itemId, initialStartTime, initialTrimStart } = dragState;
        const { startTime, duration: newDur } = ghostPreview;

        if (itemType === 'clip') {
          const updatedClips = project.videoClips.map((c) => {
            if (c.id !== itemId) return c;
            const deltaStart = startTime - initialStartTime;
            return {
              ...c,
              startTime: Math.round(startTime * 100) / 100,
              duration: Math.round(newDur * 100) / 100,
              trimStart: Math.max(0, initialTrimStart + (dragState.mode === 'trim-start' ? deltaStart : 0)),
            };
          });
          onUpdateProject({
            ...project,
            videoClips: updatedClips,
            duration: Math.max(project.duration, startTime + newDur + 1),
            updatedAt: new Date().toISOString(),
          });
        } else if (itemType === 'subtitle') {
          const updatedSubs = project.subtitles.map((s) => {
            if (s.id !== itemId) return s;
            return {
              ...s,
              startTime: Math.round(startTime * 100) / 100,
              duration: Math.round(newDur * 100) / 100,
            };
          });
          onUpdateProject({
            ...project,
            subtitles: updatedSubs,
            updatedAt: new Date().toISOString(),
          });
        } else if (itemType === 'audio') {
          const updatedAudio = project.audioTracks.map((a) => {
            if (a.id !== itemId) return a;
            const deltaStart = startTime - initialStartTime;
            return {
              ...a,
              startTime: Math.round(startTime * 100) / 100,
              duration: Math.round(newDur * 100) / 100,
              trimStart: Math.max(0, initialTrimStart + (dragState.mode === 'trim-start' ? deltaStart : 0)),
            };
          });
          onUpdateProject({
            ...project,
            audioTracks: updatedAudio,
            duration: Math.max(project.duration, startTime + newDur + 1),
            updatedAt: new Date().toISOString(),
          });
        } else if (itemType === 'access') {
          const updatedAccess = project.accessCards.map((acc) => {
            if (acc.id !== itemId) return acc;
            return {
              ...acc,
              startTime: Math.round(startTime * 100) / 100,
              duration: Math.round(newDur * 100) / 100,
            };
          });
          onUpdateProject({
            ...project,
            accessCards: updatedAccess,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      setDragState(null);
      setGhostPreview(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, ghostPreview, duration, project, snapEnabled]);

  // Split selected clip at current playhead position
  const handleSplitCurrent = () => {
    if (!selectedItemId) {
      alert('分割するアイテム（動画クリップ、字幕、音声トラック）をタイムライン上で選択してください。');
      return;
    }

    // 1. Try Video Clip
    const targetClip = project.videoClips.find(
      (c) => c.id === selectedItemId && currentTime > c.startTime + 0.3 && currentTime < c.startTime + c.duration - 0.3
    );
    if (targetClip) {
      const splitPoint = currentTime;
      const firstDuration = splitPoint - targetClip.startTime;
      const secondDuration = targetClip.duration - firstDuration;

      const clipA: VideoClipItem = {
        ...targetClip,
        duration: Math.round(firstDuration * 100) / 100,
      };

      const clipB: VideoClipItem = {
        ...targetClip,
        id: `clip_${Date.now()}_b`,
        name: `${targetClip.name} (分割)`,
        startTime: Math.round(splitPoint * 100) / 100,
        duration: Math.round(secondDuration * 100) / 100,
        trimStart: (targetClip.trimStart || 0) + firstDuration,
      };

      const updatedClips = project.videoClips.flatMap((c) => (c.id === targetClip.id ? [clipA, clipB] : [c]));
      onUpdateProject({
        ...project,
        videoClips: updatedClips,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    // 2. Try Subtitle
    const targetSub = project.subtitles.find(
      (s) => s.id === selectedItemId && currentTime > s.startTime + 0.3 && currentTime < s.startTime + s.duration - 0.3
    );
    if (targetSub) {
      const firstDuration = currentTime - targetSub.startTime;
      const secondDuration = targetSub.duration - firstDuration;

      const subA: MultilingualSubtitleItem = {
        ...targetSub,
        duration: Math.round(firstDuration * 100) / 100,
      };

      const subB: MultilingualSubtitleItem = {
        ...targetSub,
        id: `sub_${Date.now()}_b`,
        startTime: Math.round(currentTime * 100) / 100,
        duration: Math.round(secondDuration * 100) / 100,
      };

      const updatedSubs = project.subtitles.flatMap((s) => (s.id === targetSub.id ? [subA, subB] : [s]));
      onUpdateProject({
        ...project,
        subtitles: updatedSubs,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    // 3. Try Audio Track
    const targetAudio = project.audioTracks.find(
      (a) => a.id === selectedItemId && currentTime > a.startTime + 0.3 && currentTime < a.startTime + a.duration - 0.3
    );
    if (targetAudio) {
      const firstDuration = currentTime - targetAudio.startTime;
      const secondDuration = targetAudio.duration - firstDuration;

      const audioA: AudioTrackItem = {
        ...targetAudio,
        duration: Math.round(firstDuration * 100) / 100,
      };

      const audioB: AudioTrackItem = {
        ...targetAudio,
        id: `audio_${Date.now()}_b`,
        name: `${targetAudio.name} (分割)`,
        startTime: Math.round(currentTime * 100) / 100,
        duration: Math.round(secondDuration * 100) / 100,
        trimStart: (targetAudio.trimStart || 0) + firstDuration,
      };

      const updatedAudio = project.audioTracks.flatMap((a) => (a.id === targetAudio.id ? [audioA, audioB] : [a]));
      onUpdateProject({
        ...project,
        audioTracks: updatedAudio,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    alert('選択中のアイテムが現在の再生位置（赤線）と交差していないか、端に近すぎるため分割できません。');
  };

  // Generate dynamic time tick markers
  const ticks = [];
  const step = duration > 100 ? 10 : duration > 40 ? 5 : 2;
  for (let t = 0; t <= duration; t += step) {
    ticks.push(t);
  }

  return (
    <div className="h-72 bg-[#0c0f15] border-t border-[#1d2430] flex flex-col select-none">
      {/* Timeline Toolbar Header */}
      <div className="h-8 bg-[#131722] border-b border-[#202735] px-4 flex items-center justify-between text-xs text-[#8c97a8]">
        {/* Left: Title & Editing Tools */}
        <div className="flex items-center space-x-3">
          <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5">
            <span>⏱️ タイムライン</span>
          </span>

          <div className="h-4 w-px bg-[#262f3f]" />

          {/* Split at playhead button */}
          <button
            onClick={handleSplitCurrent}
            className="flex items-center space-x-1 px-2.5 py-0.5 bg-[#1b2332] hover:bg-[#253248] text-[#E2E8F0] border border-[#2f3d54] rounded text-[11px] transition-colors"
            title="再生ヘッド位置で選択クリップを分割 (ショートカット: S)"
          >
            <Scissors className="w-3 h-3 text-[#D4AF37]" />
            <span>分割 (S)</span>
          </button>

          {/* Delete selected button */}
          {selectedItemId && (
            <button
              onClick={() => {
                if (project.videoClips.some((c) => c.id === selectedItemId)) {
                  onDeleteClip(selectedItemId);
                } else if (project.subtitles.some((s) => s.id === selectedItemId)) {
                  onDeleteSubtitle(selectedItemId);
                } else if (onDeleteAudio && project.audioTracks.some((a) => a.id === selectedItemId)) {
                  onDeleteAudio(selectedItemId);
                }
              }}
              className="flex items-center space-x-1 px-2 py-0.5 bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/60 rounded text-[11px] transition-colors"
              title="選択中のアイテムを削除 (Delete / Backspace)"
            >
              <Trash2 className="w-3 h-3 text-red-400" />
              <span>削除</span>
            </button>
          )}

          {/* Snap toggle */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] border transition-colors ${
              snapEnabled
                ? 'bg-amber-950/70 border-amber-600/70 text-amber-300'
                : 'bg-[#1b2332] border-[#2f3d54] text-gray-400'
            }`}
            title="クリップ吸着（スナップ機能）のON/OFF"
          >
            <Magnet className="w-3 h-3" />
            <span>スナップ {snapEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Right: Zoom controls and Legend */}
        <div className="flex items-center space-x-4 text-[11px]">
          {/* Zoom controls */}
          <div className="flex items-center space-x-1.5 bg-[#171e2b] px-2 py-0.5 rounded border border-[#253042]">
            <ZoomOut
              className="w-3 h-3 text-gray-400 hover:text-white cursor-pointer"
              onClick={() => setZoomLevel((z) => Math.max(1.0, z - 0.5))}
            />
            <span className="font-mono text-[10px] text-gray-300 w-8 text-center">{zoomLevel.toFixed(1)}x</span>
            <ZoomIn
              className="w-3 h-3 text-gray-400 hover:text-white cursor-pointer"
              onClick={() => setZoomLevel((z) => Math.min(3.5, z + 0.5))}
            />
          </div>

          <div className="h-4 w-px bg-[#262f3f]" />

          {/* Legend */}
          <div className="hidden lg:flex items-center space-x-3 text-[10px]">
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-[#D4AF37] rounded-sm inline-block" />
              <span>テロップ</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-[#3B82F6] rounded-sm inline-block" />
              <span>映像・写真</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-[#EF4444] rounded-sm inline-block" />
              <span>録音音声</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-[#8B5CF6] rounded-sm inline-block" />
              <span>雅楽BGM</span>
            </span>
          </div>

          <span className="font-mono text-[#D4AF37]">総尺: {Math.floor(duration)}s</span>
        </div>
      </div>

      {/* Main Track Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Headers (Left sidebar with Mute & Solo icons) */}
        <div className="w-40 bg-[#0f131b] border-r border-[#1f2634] flex flex-col text-xs text-[#9aa0a6] shrink-0 font-medium">
          {/* Header ruler label */}
          <div className="h-6 border-b border-[#1b222d] px-2.5 flex items-center justify-between text-[10px] text-gray-500 font-mono">
            <span>トラック</span>
            <span>操作</span>
          </div>

          {/* Track 1: Telops */}
          <div className="h-11 border-b border-[#1b222d] px-2 flex items-center justify-between text-[#E8D595]">
            <div className="flex items-center space-x-1.5 truncate">
              <Type className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
              <span className="truncate text-[11px]">テロップ/案内</span>
            </div>
            <button
              onClick={() => handleToggleMute('subtitles')}
              className={`p-1 rounded hover:bg-[#1a2332] transition-colors ${
                mutedTracks.subtitles ? 'text-red-400' : 'text-gray-400 hover:text-white'
              }`}
              title={mutedTracks.subtitles ? 'テロップ非表示中（クリックで表示）' : 'テロップを非表示'}
            >
              {mutedTracks.subtitles ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Track 2: Visuals */}
          <div className="h-11 border-b border-[#1b222d] px-2 flex items-center justify-between text-[#93C5FD]">
            <div className="flex items-center space-x-1.5 truncate">
              <Film className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
              <span className="truncate text-[11px]">映像・写真</span>
            </div>
            <button
              onClick={() => handleToggleMute('video')}
              className={`p-1 rounded hover:bg-[#1a2332] transition-colors ${
                mutedTracks.video ? 'text-red-400' : 'text-gray-400 hover:text-white'
              }`}
              title={mutedTracks.video ? '映像非表示中（クリックで表示）' : '映像を非表示'}
            >
              {mutedTracks.video ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Track 3: Narration */}
          <div className="h-11 border-b border-[#1b222d] px-2 flex items-center justify-between text-[#FCA5A5]">
            <div className="flex items-center space-x-1.5 truncate">
              <Mic className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
              <span className="truncate text-[11px]">ナレーション</span>
            </div>
            <button
              onClick={() => handleToggleMute('narration')}
              className={`p-1 rounded hover:bg-[#1a2332] transition-colors ${
                mutedTracks.narration ? 'text-red-400' : 'text-gray-400 hover:text-white'
              }`}
              title={mutedTracks.narration ? 'ナレーションミュート中' : 'ナレーションをミュート'}
            >
              {mutedTracks.narration ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Track 4: Ambience */}
          <div className="h-11 border-b border-[#1b222d] px-2 flex items-center justify-between text-[#A7F3D0]">
            <div className="flex items-center space-x-1.5 truncate">
              <Wind className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
              <span className="truncate text-[11px]">自然・環境音</span>
            </div>
            <button
              onClick={() => handleToggleMute('ambience')}
              className={`p-1 rounded hover:bg-[#1a2332] transition-colors ${
                mutedTracks.ambience ? 'text-red-400' : 'text-gray-400 hover:text-white'
              }`}
              title={mutedTracks.ambience ? '環境音ミュート中' : '環境音をミュート'}
            >
              {mutedTracks.ambience ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Track 5: BGM */}
          <div className="h-11 px-2 flex items-center justify-between text-[#DDD6FE]">
            <div className="flex items-center space-x-1.5 truncate">
              <Music className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
              <span className="truncate text-[11px]">雅楽・BGM</span>
            </div>
            <button
              onClick={() => handleToggleMute('bgm')}
              className={`p-1 rounded hover:bg-[#1a2332] transition-colors ${
                mutedTracks.bgm ? 'text-red-400' : 'text-gray-400 hover:text-white'
              }`}
              title={mutedTracks.bgm ? 'BGMミュート中' : 'BGMをミュート'}
            >
              {mutedTracks.bgm ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Tracks Content Scrollable Area */}
        <div
          ref={scrollWrapperRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#090b10]"
        >
          <div
            ref={containerRef}
            onClick={handleTimelineClick}
            className="h-full relative cursor-pointer"
            style={{ width: `${Math.max(100, zoomLevel * 100)}%`, minWidth: '100%' }}
          >
            {/* Ruler Ticks */}
            <div className="h-6 border-b border-[#1c232f] relative bg-[#11151f]">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 border-l border-[#283243] flex items-center pl-1 text-[9px] text-[#718096] font-mono select-none"
                  style={{ left: `${getPositionPercent(t)}%` }}
                >
                  {Math.floor(t)}s
                </div>
              ))}
            </div>

            {/* Track 1: Subtitles / Sanctuary Cards / Access Cards */}
            <div className="h-11 border-b border-[#161c27] relative px-1 flex items-center">
              {/* Opening Tag */}
              {project.branding.opDuration > 0 && (
                <div
                  className="absolute h-9 bg-amber-950/70 border border-amber-600/70 rounded px-1.5 flex items-center text-[10px] text-amber-200 overflow-hidden select-none"
                  style={{
                    left: '0%',
                    width: `${getWidthPercent(project.branding.opDuration)}%`,
                  }}
                >
                  ⛩️ OP
                </div>
              )}

              {/* Subtitles */}
              {project.subtitles.map((sub) => {
                const isSelected = selectedItemId === sub.id;
                const isBeingDragged = dragState?.itemId === sub.id;
                const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : sub.startTime;
                const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : sub.duration;

                return (
                  <div
                    key={sub.id}
                    onMouseDown={(e) => startDrag(e, 'subtitle', sub.id, 'move', sub.startTime, sub.duration)}
                    className={`group absolute h-9 rounded px-2 flex items-center justify-between text-[11px] truncate cursor-move transition-all border ${
                      sub.category === 'sanctuary_header'
                        ? 'bg-[#291e12] border-[#D4AF37] text-[#F7E7B4]'
                        : sub.category === 'etiquette_tip'
                        ? 'bg-[#2b1717] border-[#C84B31] text-[#FECACA]'
                        : 'bg-[#1b2230] border-[#384860] text-[#E2E8F0]'
                    } ${isSelected ? 'ring-2 ring-white shadow-xl z-20 brightness-110' : 'hover:brightness-125'}`}
                    style={{
                      left: `${getPositionPercent(displayStart)}%`,
                      width: `${getWidthPercent(displayDur)}%`,
                    }}
                    title={sub.text.ja}
                  >
                    {/* Left Trim Handle */}
                    <div
                      onMouseDown={(e) => startDrag(e, 'subtitle', sub.id, 'trim-start', sub.startTime, sub.duration)}
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 z-30 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="開始位置をトリミング"
                    />

                    <span className="truncate flex-1 select-none pointer-events-none">
                      {sub.category === 'sanctuary_header' && '⛩️ '}
                      {sub.category === 'etiquette_tip' && '📜 '}
                      {sub.text.ja}
                    </span>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) => startDrag(e, 'subtitle', sub.id, 'trim-end', sub.startTime, sub.duration)}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 z-30 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="終了位置をトリミング"
                    />
                  </div>
                );
              })}

              {/* Access Cards */}
              {project.accessCards.map((acc) => {
                const isSelected = selectedItemId === acc.id;
                const isBeingDragged = dragState?.itemId === acc.id;
                const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : acc.startTime;
                const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : acc.duration;

                return (
                  <div
                    key={acc.id}
                    onMouseDown={(e) => startDrag(e, 'access', acc.id, 'move', acc.startTime, acc.duration)}
                    className={`group absolute h-9 rounded px-2 flex items-center text-[11px] truncate bg-[#1a2d24] border border-[#22c55e] text-[#86efac] cursor-move ${
                      isSelected ? 'ring-2 ring-white shadow-xl z-20' : 'hover:brightness-125'
                    }`}
                    style={{
                      left: `${getPositionPercent(displayStart)}%`,
                      width: `${getWidthPercent(displayDur)}%`,
                    }}
                  >
                    {/* Left Trim Handle */}
                    <div
                      onMouseDown={(e) => startDrag(e, 'access', acc.id, 'trim-start', acc.startTime, acc.duration)}
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 z-30 opacity-0 group-hover:opacity-100"
                    />

                    <MapPin className="w-3 h-3 mr-1 text-[#4ade80] shrink-0 pointer-events-none" />
                    <span className="truncate select-none pointer-events-none">
                      地図: {acc.sanctuaryName.ja}
                    </span>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) => startDrag(e, 'access', acc.id, 'trim-end', acc.startTime, acc.duration)}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 z-30 opacity-0 group-hover:opacity-100"
                    />
                  </div>
                );
              })}

              {/* Ending Tag */}
              {project.branding.edDuration > 0 && (
                <div
                  className="absolute h-9 bg-amber-950/70 border border-amber-600/70 rounded px-1.5 flex items-center text-[10px] text-amber-200 overflow-hidden select-none"
                  style={{
                    left: `${getPositionPercent(project.duration - project.branding.edDuration)}%`,
                    width: `${getWidthPercent(project.branding.edDuration)}%`,
                  }}
                >
                  ⛩️ ED
                </div>
              )}
            </div>

            {/* Track 2: Video & Photo Clips */}
            <div className="h-11 border-b border-[#161c27] relative px-1 flex items-center">
              {project.videoClips.map((clip) => {
                const isSelected = selectedItemId === clip.id;
                const isBeingDragged = dragState?.itemId === clip.id;
                const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : clip.startTime;
                const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : clip.duration;

                return (
                  <div
                    key={clip.id}
                    onMouseDown={(e) => startDrag(e, 'clip', clip.id, 'move', clip.startTime, clip.duration, clip.trimStart)}
                    className={`group absolute h-9 rounded px-2 flex items-center justify-between text-[11px] truncate bg-[#162942] border border-[#2563EB] text-[#BFDBFE] cursor-move transition-all ${
                      isSelected ? 'ring-2 ring-white shadow-xl z-20 brightness-110' : 'hover:brightness-125'
                    }`}
                    style={{
                      left: `${getPositionPercent(displayStart)}%`,
                      width: `${getWidthPercent(displayDur)}%`,
                    }}
                    title={clip.name}
                  >
                    {/* Left Trim Handle */}
                    <div
                      onMouseDown={(e) =>
                        startDrag(e, 'clip', clip.id, 'trim-start', clip.startTime, clip.duration, clip.trimStart)
                      }
                      className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-blue-400/40 hover:bg-blue-300 z-30 rounded-l opacity-0 group-hover:opacity-100 transition-opacity"
                      title="開始位置をトリミング"
                    />

                    <span className="truncate flex items-center space-x-1 select-none pointer-events-none">
                      <Film className="w-3 h-3 mr-1 inline shrink-0" />
                      <span className="truncate">{clip.name}</span>
                      {clip.kenBurns?.enabled && (
                        <span className="text-[9px] bg-blue-500/30 text-blue-200 px-1 rounded ml-1 shrink-0">
                          KB
                        </span>
                      )}
                    </span>

                    {/* Right Trim Handle */}
                    <div
                      onMouseDown={(e) =>
                        startDrag(e, 'clip', clip.id, 'trim-end', clip.startTime, clip.duration, clip.trimStart)
                      }
                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-blue-400/40 hover:bg-blue-300 z-30 rounded-r opacity-0 group-hover:opacity-100 transition-opacity"
                      title="終了位置をトリミング"
                    />
                  </div>
                );
              })}
            </div>

            {/* Track 3: Narration Track */}
            <div className="h-11 border-b border-[#161c27] relative px-1 flex items-center">
              {project.audioTracks
                .filter((a) => a.type === 'narration')
                .map((audio) => {
                  const isSelected = selectedItemId === audio.id;
                  const isBeingDragged = dragState?.itemId === audio.id;
                  const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : audio.startTime;
                  const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : audio.duration;

                  return (
                    <div
                      key={audio.id}
                      onMouseDown={(e) => startDrag(e, 'audio', audio.id, 'move', audio.startTime, audio.duration, audio.trimStart)}
                      className={`group absolute h-9 rounded px-2 flex items-center justify-between text-[11px] bg-red-950/80 border border-red-500 text-red-100 truncate cursor-move transition-all overflow-hidden ${
                        isSelected ? 'ring-2 ring-[#D4AF37] border-[#D4AF37] shadow-xl z-20 brightness-110' : 'hover:brightness-125'
                      }`}
                      style={{
                        left: `${getPositionPercent(displayStart)}%`,
                        width: `${getWidthPercent(displayDur)}%`,
                      }}
                    >
                      {/* Left Trim Handle */}
                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-start', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-red-400/40 hover:bg-red-300 z-30 opacity-0 group-hover:opacity-100"
                      />

                      {/* Waveform Visualizer Background */}
                      <div className="absolute inset-0 z-0">
                        <WaveformVisualizer
                          waveform={audio.waveform}
                          color="#F87171"
                          volume={audio.volume}
                        />
                      </div>

                      <div className="relative z-10 flex items-center space-x-1 truncate font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] select-none pointer-events-none">
                        <Mic className="w-3 h-3 mr-1 shrink-0 text-red-300" />
                        <span className="truncate">{audio.name}</span>
                      </div>
                      <span className="relative z-10 text-[9px] bg-black/70 px-1 rounded text-red-200 font-mono shrink-0 ml-1">
                        {Math.round(audio.volume * 100)}%
                      </span>

                      {/* Right Trim Handle */}
                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-end', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-red-400/40 hover:bg-red-300 z-30 opacity-0 group-hover:opacity-100"
                      />
                    </div>
                  );
                })}
            </div>

            {/* Track 4: Ambience Sound Track */}
            <div className="h-11 border-b border-[#161c27] relative px-1 flex items-center">
              {project.audioTracks
                .filter((a) => a.type === 'ambience')
                .map((audio) => {
                  const isSelected = selectedItemId === audio.id;
                  const isBeingDragged = dragState?.itemId === audio.id;
                  const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : audio.startTime;
                  const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : audio.duration;

                  return (
                    <div
                      key={audio.id}
                      onMouseDown={(e) => startDrag(e, 'audio', audio.id, 'move', audio.startTime, audio.duration, audio.trimStart)}
                      className={`group absolute h-9 rounded px-2 flex items-center justify-between text-[11px] bg-emerald-950/70 border border-emerald-600/70 text-emerald-100 truncate cursor-move overflow-hidden ${
                        isSelected ? 'ring-2 ring-[#D4AF37] border-[#D4AF37] shadow-xl z-20 brightness-110' : 'hover:brightness-125'
                      }`}
                      style={{
                        left: `${getPositionPercent(displayStart)}%`,
                        width: `${getWidthPercent(displayDur)}%`,
                      }}
                    >
                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-start', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-emerald-400/40 hover:bg-emerald-300 z-30 opacity-0 group-hover:opacity-100"
                      />

                      {/* Waveform Visualizer Background */}
                      <div className="absolute inset-0 z-0">
                        <WaveformVisualizer
                          waveform={audio.waveform}
                          color="#34D399"
                          volume={audio.volume}
                        />
                      </div>

                      <div className="relative z-10 flex items-center space-x-1 truncate font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] select-none pointer-events-none">
                        <Wind className="w-3 h-3 mr-1 shrink-0 text-emerald-300" />
                        <span className="truncate">{audio.name}</span>
                      </div>
                      <span className="relative z-10 text-[9px] bg-black/70 px-1 rounded text-emerald-200 font-mono shrink-0 ml-1">
                        {Math.round(audio.volume * 100)}%
                      </span>

                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-end', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-emerald-400/40 hover:bg-emerald-300 z-30 opacity-0 group-hover:opacity-100"
                      />
                    </div>
                  );
                })}
            </div>

            {/* Track 5: BGM Track */}
            <div className="h-11 relative px-1 flex items-center">
              {project.audioTracks
                .filter((a) => a.type === 'bgm')
                .map((audio) => {
                  const isSelected = selectedItemId === audio.id;
                  const isBeingDragged = dragState?.itemId === audio.id;
                  const displayStart = isBeingDragged && ghostPreview ? ghostPreview.startTime : audio.startTime;
                  const displayDur = isBeingDragged && ghostPreview ? ghostPreview.duration : audio.duration;

                  const isNarrationNow = project.audioTracks.some(
                    (t) =>
                      t.type === 'narration' &&
                      currentTime >= t.startTime &&
                      currentTime < t.startTime + t.duration
                  );

                  return (
                    <div
                      key={audio.id}
                      onMouseDown={(e) => startDrag(e, 'audio', audio.id, 'move', audio.startTime, audio.duration, audio.trimStart)}
                      className={`group absolute h-9 rounded px-2 flex items-center justify-between text-[11px] bg-indigo-950/70 border border-indigo-500/70 text-indigo-100 truncate cursor-move overflow-hidden ${
                        isSelected ? 'ring-2 ring-[#D4AF37] border-[#D4AF37] shadow-xl z-20 brightness-110' : 'hover:brightness-125'
                      }`}
                      style={{
                        left: `${getPositionPercent(displayStart)}%`,
                        width: `${getWidthPercent(displayDur)}%`,
                      }}
                    >
                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-start', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-indigo-400/40 hover:bg-indigo-300 z-30 opacity-0 group-hover:opacity-100"
                      />

                      {/* Waveform Visualizer Background with Auto-Ducking */}
                      <div className="absolute inset-0 z-0">
                        <WaveformVisualizer
                          waveform={audio.waveform}
                          color="#818CF8"
                          volume={audio.volume}
                          isDucked={isNarrationNow && audio.autoDucking?.enabled !== false}
                          duckVolume={audio.autoDucking?.duckVolume ?? 0.25}
                        />
                      </div>

                      <div className="relative z-10 flex items-center space-x-1 truncate font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] select-none pointer-events-none">
                        <Music className="w-3 h-3 mr-1 shrink-0 text-indigo-300" />
                        <span className="truncate">{audio.name}</span>
                      </div>

                      <div className="relative z-10 flex items-center space-x-1 shrink-0 ml-1">
                        {audio.autoDucking?.enabled && (
                          <span
                            className={`text-[9px] px-1 rounded transition-colors ${
                              isNarrationNow
                                ? 'bg-amber-500 text-black font-bold animate-pulse'
                                : 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                            }`}
                          >
                            {isNarrationNow ? '減衰中' : 'ダッキング'}
                          </span>
                        )}
                        <span className="text-[9px] bg-black/70 px-1 rounded text-indigo-200 font-mono">
                          {Math.round(audio.volume * 100)}%
                        </span>
                      </div>

                      <div
                        onMouseDown={(e) =>
                          startDrag(e, 'audio', audio.id, 'trim-end', audio.startTime, audio.duration, audio.trimStart)
                        }
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-indigo-400/40 hover:bg-indigo-300 z-30 opacity-0 group-hover:opacity-100"
                      />
                    </div>
                  );
                })}
            </div>

            {/* Playhead Red Indicator Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[#C84B31] pointer-events-none z-30 shadow-lg"
              style={{ left: `${getPositionPercent(currentTime)}%` }}
            >
              <div className="w-3 h-3 -ml-[5px] -mt-1 bg-[#C84B31] rotate-45 rounded-sm shadow-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
