/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { ProjectData, SupportedLanguage } from './types';
import { initialProjectData } from './services/sampleData';
import { loadLastProject, saveProjectToStorage, saveMediaBlob } from './services/storage';
import { audioEngine } from './services/audioEngine';

import { Header } from './components/Header';
import { VideoPreview } from './components/VideoPreview';
import { Timeline } from './components/Timeline';

import { MediaPanel } from './components/panels/MediaPanel';
import { TelopPanel } from './components/panels/TelopPanel';
import { TranslationPanel } from './components/panels/TranslationPanel';
import { AccessCardPanel } from './components/panels/AccessCardPanel';
import { AudioPanel } from './components/panels/AudioPanel';
import { ChaptersPanel } from './components/panels/ChaptersPanel';

import { ThumbnailModal } from './components/modals/ThumbnailModal';
import { ExportModal } from './components/modals/ExportModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';

import {
  Film,
  Type,
  Globe,
  MapPin,
  Mic,
  ListOrdered,
} from 'lucide-react';

type SidebarTab = 'media' | 'telop' | 'translation' | 'access' | 'audio' | 'chapters';

export default function App() {
  const [project, setProject] = useState<ProjectData>(initialProjectData);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [previewLang, setPreviewLang] = useState<SupportedLanguage>('ja');

  // Sidebar navigation
  const [activeTab, setActiveTab] = useState<SidebarTab>('telop');

  // Selection states
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

  // Microphone recording state
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false);
  const recordStartTimeRef = useRef<number>(0);

  // Modals
  const [isThumbnailOpen, setIsThumbnailOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Undo / Redo history stacks
  const [undoStack, setUndoStack] = useState<ProjectData[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectData[]>([]);

  // Restore cached project from previous session if available
  useEffect(() => {
    loadLastProject().then((cached) => {
      if (cached && cached.title) {
        setProject(cached);
      }
    });
  }, []);

  // Auto-save project changes to storage with history recording
  const handleUpdateProject = (updated: ProjectData, recordHistory = true) => {
    if (recordHistory) {
      setUndoStack((prev) => [...prev.slice(-25), project]);
      setRedoStack([]);
    }
    setProject(updated);
    saveProjectToStorage(updated).catch(() => {});
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, project]);
    setProject(previous);
    saveProjectToStorage(previous).catch(() => {});
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, project]);
    setProject(next);
    saveProjectToStorage(next).catch(() => {});
  };

  // Playback timer loop
  useEffect(() => {
    let animId: number;
    let lastTimestamp = performance.now();

    const loop = (now: number) => {
      if (isPlaying) {
        const delta = (now - lastTimestamp) / 1000;
        setCurrentTime((prev) => {
          const next = prev + delta;
          if (next >= project.duration) {
            setIsPlaying(false);
            audioEngine.pauseAll();
            return project.duration;
          }
          return next;
        });
      }
      lastTimestamp = now;
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, project.duration]);

  // Sync audio engine with playback, position, and mute states
  useEffect(() => {
    audioEngine.syncPlayback(currentTime, isPlaying, project.audioTracks, project.mutedTracks);
  }, [currentTime, isPlaying, project.audioTracks, project.mutedTracks]);

  // Spacebar play/pause and keyboard shortcuts.
  // The window listener is registered once and always calls the latest handler through a ref,
  // so shortcuts never act on stale state (e.g. "R" seeing an old isRecordingMic / currentTime).
  const keyDownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyDownHandlerRef.current = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => {
          if (prev) audioEngine.pauseAll();
          return !prev;
        });
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        setCurrentTime((prev) => Math.max(0, prev - step));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        setCurrentTime((prev) => Math.min(project.duration, prev + step));
      } else if (e.code === 'Home') {
        e.preventDefault();
        setCurrentTime(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        setCurrentTime(project.duration);
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleToggleRecordMic();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (e.code === 'Escape') {
        setIsThumbnailOpen(false);
        setIsExportOpen(false);
        setIsShortcutsOpen(false);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          handleUpdateProject({
            ...project,
            videoClips: project.videoClips.filter((c) => c.id !== selectedClipId),
          });
          setSelectedClipId(null);
        } else if (selectedSubId) {
          handleUpdateProject({
            ...project,
            subtitles: project.subtitles.filter((s) => s.id !== selectedSubId),
          });
          setSelectedSubId(null);
        } else if (selectedAudioId) {
          handleUpdateProject({
            ...project,
            audioTracks: project.audioTracks.filter((a) => a.id !== selectedAudioId),
          });
          setSelectedAudioId(null);
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
      }
    };
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyDownHandlerRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Microphone recording toggle
  const handleToggleRecordMic = async () => {
    if (!isRecordingMic) {
      // Start recording
      try {
        recordStartTimeRef.current = currentTime;
        await audioEngine.startRecording();
        setIsRecordingMic(true);
        setIsPlaying(true); // Automatically advance playhead during voiceover
      } catch (err: any) {
        alert(`マイクの起動に失敗しました: ${err.message}`);
      }
    } else {
      // Stop recording and place on timeline
      try {
        setIsPlaying(false);
        const { blob, url, duration } = await audioEngine.stopRecording();
        setIsRecordingMic(false);

        // Extract waveform from recorded microphone audio
        const waveform = await audioEngine.extractWaveform(blob, 40);

        // Keep the recording in IndexedDB so it survives a reload (the blob: URL does not).
        // If saving fails, the take is still usable in this session.
        const blobKey = `narration_${Date.now()}`;
        await saveMediaBlob(blobKey, blob).catch((e) => console.warn('Failed to store recording:', e));

        const newNarration = {
          id: `narration_${Date.now()}`,
          name: `録音 (${recordStartTimeRef.current.toFixed(1)}s) 🎙️`,
          type: 'narration' as const,
          startTime: recordStartTimeRef.current,
          duration: Math.max(1, duration),
          volume: 1.0,
          dataUrl: url,
          blobKey,
          isRecorded: true,
          waveform,
        };

        const updatedTracks = [...project.audioTracks, newNarration];
        handleUpdateProject({
          ...project,
          audioTracks: updatedTracks,
          duration: Math.max(project.duration, recordStartTimeRef.current + duration + 2),
        });
      } catch (err: any) {
        alert(`録音停止時にエラーが発生しました: ${err.message}`);
        setIsRecordingMic(false);
      }
    }
  };

  const handleSelectTrackItem = (type: string, id: string) => {
    if (type === 'clip') {
      setSelectedClipId(id);
      setActiveTab('media');
    } else if (type === 'subtitle') {
      setSelectedSubId(id);
      setActiveTab('telop');
    } else if (type === 'access') {
      setActiveTab('access');
    } else if (type === 'audio') {
      setSelectedAudioId(id);
      setActiveTab('audio');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0D11] text-[#E6E4DF] overflow-hidden select-none font-sans">
      {/* Header */}
      <Header
        project={project}
        onUpdateProject={handleUpdateProject}
        previewLang={previewLang}
        onChangePreviewLang={setPreviewLang}
        onOpenThumbnailModal={() => setIsThumbnailOpen(true)}
        onOpenExportModal={() => setIsExportOpen(true)}
        onOpenShortcutsModal={() => setIsShortcutsOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
      />

      {/* Main Workspace (Sidebar + Canvas Preview) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Navigation Tabs + Panel Body */}
        <div className="w-80 md:w-96 bg-[#10141c] border-r border-[#1f2735] flex flex-col shrink-0">
          {/* Tabs Bar */}
          <div className="h-10 bg-[#0d1017] border-b border-[#1c2432] grid grid-cols-6 text-center text-xs">
            <button
              onClick={() => setActiveTab('media')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'media'
                  ? 'text-[#60A5FA] border-b-2 border-[#60A5FA] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="映像・写真"
            >
              <Film className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">素材</span>
            </button>

            <button
              onClick={() => setActiveTab('telop')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'telop'
                  ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="定型テロップ"
            >
              <Type className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">テロップ</span>
            </button>

            <button
              onClick={() => setActiveTab('translation')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'translation'
                  ? 'text-[#38BDF8] border-b-2 border-[#38BDF8] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="多言語字幕 & 用語集 (Claude API)"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">翻訳</span>
            </button>

            <button
              onClick={() => setActiveTab('access')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'access'
                  ? 'text-[#4ADE80] border-b-2 border-[#4ADE80] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="アクセス地図案内"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">地図</span>
            </button>

            <button
              onClick={() => setActiveTab('audio')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'audio'
                  ? 'text-[#F87171] border-b-2 border-[#F87171] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="ナレーション・音声"
            >
              <Mic className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">音声</span>
            </button>

            <button
              onClick={() => setActiveTab('chapters')}
              className={`flex flex-col items-center justify-center transition-colors ${
                activeTab === 'chapters'
                  ? 'text-[#A78BFA] border-b-2 border-[#A78BFA] bg-[#141b26]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="チャプター & YouTube概要欄"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span className="text-[9px] mt-0.5">目次</span>
            </button>
          </div>

          {/* Panel Content Body */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'media' && (
              <MediaPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
              />
            )}
            {activeTab === 'telop' && (
              <TelopPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedSubId={selectedSubId}
                onSelectSubtitle={setSelectedSubId}
                currentTime={currentTime}
              />
            )}
            {activeTab === 'translation' && (
              <TranslationPanel
                project={project}
                onUpdateProject={handleUpdateProject}
              />
            )}
            {activeTab === 'access' && (
              <AccessCardPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                previewLang={previewLang}
                currentTime={currentTime}
              />
            )}
            {activeTab === 'audio' && (
              <AudioPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                currentTime={currentTime}
                isRecordingMic={isRecordingMic}
                onToggleRecordMic={handleToggleRecordMic}
                selectedAudioId={selectedAudioId}
                onSelectAudio={setSelectedAudioId}
              />
            )}
            {activeTab === 'chapters' && (
              <ChaptersPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                currentTime={currentTime}
              />
            )}
          </div>
        </div>

        {/* Center: Video Preview Canvas & Controls */}
        <VideoPreview
          project={project}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTogglePlay={() => {
            setIsPlaying((prev) => {
              if (prev) audioEngine.pauseAll();
              return !prev;
            });
          }}
          onSeek={(time) => setCurrentTime(time)}
          previewLang={previewLang}
          isRecordingMic={isRecordingMic}
          onToggleRecordMic={handleToggleRecordMic}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
        />
      </div>

      {/* Bottom: Multi-Track Timeline */}
      <Timeline
        project={project}
        onUpdateProject={handleUpdateProject}
        currentTime={currentTime}
        onSeek={(time) => setCurrentTime(time)}
        onSelectTrackItem={handleSelectTrackItem}
        selectedItemId={selectedAudioId || selectedSubId || selectedClipId}
        onDeleteClip={(id) => {
          handleUpdateProject({
            ...project,
            videoClips: project.videoClips.filter((c) => c.id !== id),
          });
        }}
        onDeleteSubtitle={(id) => {
          handleUpdateProject({
            ...project,
            subtitles: project.subtitles.filter((s) => s.id !== id),
          });
        }}
        onDeleteAudio={(id) => {
          handleUpdateProject({
            ...project,
            audioTracks: project.audioTracks.filter((a) => a.id !== id),
          });
        }}
      />

      {/* Modals */}
      <ThumbnailModal
        isOpen={isThumbnailOpen}
        onClose={() => setIsThumbnailOpen(false)}
        project={project}
        currentTime={currentTime}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        project={project}
      />

      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}
