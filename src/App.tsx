import React, { useState, useEffect, useLayoutEffect, useRef, useReducer, useCallback } from 'react';
import { ProjectData, SupportedLanguage } from './types';
import { createBlankProject, initialProjectData } from './services/sampleData';
import {
  cleanUpUnusedMedia,
  loadCurrentProject,
  newProjectSlot,
  openStoredProject,
  requestPersistentStorage,
  saveMediaBlob,
  saveProjectToStorage,
  setCurrentProjectSlot,
} from './services/storage';
import { audioEngine } from './services/audioEngine';
import { nudgeItem, resizeItem, rippleDeleteClip, splitItemAtTime, TimelineItemKind } from './services/timelineEdit';
import { historyReducer, createHistory, ProjectUpdate } from './services/projectHistory';
import { notify } from './services/notifications';
import { getPlayhead, setPlayhead, subscribePlayhead } from './services/playhead';

import { Header } from './components/Header';
import { VideoPreview } from './components/VideoPreview';
import { Timeline } from './components/Timeline';
import { Notifications } from './components/Notifications';

import { MediaPanel } from './components/panels/MediaPanel';
import { TelopPanel } from './components/panels/TelopPanel';
import { TranslationPanel } from './components/panels/TranslationPanel';
import { AccessCardPanel } from './components/panels/AccessCardPanel';
import { AudioPanel } from './components/panels/AudioPanel';
import { ChaptersPanel } from './components/panels/ChaptersPanel';

import { ThumbnailModal } from './components/modals/ThumbnailModal';
import { ExportModal } from './components/modals/ExportModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';
import { AutoEditModal } from './components/modals/AutoEditModal';
import { ProjectsModal } from './components/modals/ProjectsModal';

import {
  Film,
  Type,
  Globe,
  MapPin,
  Mic,
  ListOrdered,
} from 'lucide-react';

type SidebarTab = 'media' | 'telop' | 'translation' | 'access' | 'audio' | 'chapters';

const SIDEBAR_TABS: { id: SidebarTab; label: string; title: string; color: string; Icon: typeof Film }[] = [
  { id: 'media', label: '素材', title: '映像・写真', color: '#60A5FA', Icon: Film },
  { id: 'telop', label: 'テロップ', title: '定型テロップ', color: '#D4AF37', Icon: Type },
  { id: 'translation', label: '翻訳', title: '多言語字幕 & 用語集 (Claude API)', color: '#38BDF8', Icon: Globe },
  { id: 'access', label: '地図', title: 'アクセス地図案内', color: '#4ADE80', Icon: MapPin },
  { id: 'audio', label: '音声', title: 'ナレーション・音声', color: '#F87171', Icon: Mic },
  { id: 'chapters', label: '目次', title: 'チャプター & YouTube概要欄', color: '#A78BFA', Icon: ListOrdered },
];

// How far Alt + arrow keys move or resize the selected timeline item
const KEYBOARD_EDIT_STEP_SEC = 0.1;

// Wait this long after the last edit before writing the project to the browser's storage
const SAVE_DELAY_MS = 500;

export default function App() {
  // The project and its undo/redo history
  const [history, dispatchHistory] = useReducer(historyReducer, initialProjectData, createHistory);
  const project = history.present;
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [previewLang, setPreviewLang] = useState<SupportedLanguage>('ja');

  // Sidebar navigation
  const [activeTab, setActiveTab] = useState<SidebarTab>('telop');

  // Selection states
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

  // Only one item is selected at a time, so Delete and S always act on the highlighted item
  const selectItem = (kind: 'clip' | 'subtitle' | 'audio', id: string | null) => {
    setSelectedClipId(kind === 'clip' ? id : null);
    setSelectedSubId(kind === 'subtitle' ? id : null);
    setSelectedAudioId(kind === 'audio' ? id : null);
  };

  // Microphone recording state
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false);
  const recordStartTimeRef = useRef<number>(0);

  // Modals
  const [isThumbnailOpen, setIsThumbnailOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAutoEditOpen, setIsAutoEditOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const isModalOpen = isThumbnailOpen || isExportOpen || isShortcutsOpen || isAutoEditOpen || isProjectsOpen;

  // Restore cached project from previous session if available.
  // Nothing is saved until this finishes, so the sample project never overwrites saved work.
  const [isRestored, setIsRestored] = useState(false);
  // Where the project being edited is kept in the browser (several projects are stored side by side)
  const [slotId, setSlotId] = useState<string | null>(null);
  useEffect(() => {
    loadCurrentProject()
      .then(({ slotId: currentSlot, project: cached }) => {
        setSlotId(currentSlot);
        if (cached) {
          dispatchHistory({ type: 'load', project: cached });
          // Only with the saved project in hand, so files it uses are never taken for unused ones
          cleanUpUnusedMedia(cached).catch((e) => console.warn('Failed to clean up unused media:', e));
          // Saved work is here: ask the browser not to clear it on its own
          requestPersistentStorage();
        }
      })
      .catch((e) => {
        // The browser's storage cannot be read: the editor still works for this visit
        console.error('Failed to load the saved project:', e);
        setSlotId(newProjectSlot());
      })
      .finally(() => setIsRestored(true));
  }, []);

  // Save once edits pause (not on every keystroke), and right away when the tab is hidden or closed.
  // The refs are updated in a layout effect, which runs right after each update and before the
  // browser paints, so an edit followed immediately by closing or reloading the page is still saved.
  // The project and its slot change together (switching projects), so a save always pairs the right two.
  const latestProjectRef = useRef(project);
  const savedProjectRef = useRef<ProjectData | null>(null);
  const isRestoredRef = useRef(false);
  const slotIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    latestProjectRef.current = project;
    isRestoredRef.current = isRestored;
    slotIdRef.current = slotId;
  });
  const flushSave = useCallback((): Promise<void> => {
    const latest = latestProjectRef.current;
    const slot = slotIdRef.current;
    if (!isRestoredRef.current || !slot || latest === savedProjectRef.current) return Promise.resolve();
    savedProjectRef.current = latest;
    return saveProjectToStorage(latest, slot).catch((e) => console.warn('Failed to save project:', e));
  }, []);
  useEffect(() => {
    if (!isRestored) return;
    const timer = setTimeout(flushSave, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, slotId, isRestored, flushSave]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flushSave);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flushSave);
    };
  }, [flushSave]);

  const handleUpdateProject = useCallback((update: ProjectUpdate) => {
    dispatchHistory({ type: 'update', update, at: Date.now() });
  }, []);
  const handleUndo = () => dispatchHistory({ type: 'undo' });
  const handleRedo = () => dispatchHistory({ type: 'redo' });

  // Playback timer loop, paced by the audio clock so the picture stays with the sound.
  // The playhead is kept outside React (services/playhead): moving it redraws only the preview
  // and the playhead markers, not the whole editor, on every frame.
  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;
    let last = audioEngine.now();

    const loop = () => {
      const now = audioEngine.now();
      // When the audio clock starts running, skip one frame rather than compare two different clocks
      const delta = now.isAudioClock === last.isAudioClock ? Math.max(0, now.seconds - last.seconds) : 0;
      last = now;
      const next = getPlayhead() + delta;
      if (next >= project.duration) {
        setPlayhead(project.duration);
        setIsPlaying(false);
        audioEngine.pauseAll();
        return;
      }
      setPlayhead(next);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, project.duration]);

  // When the video gets shorter (e.g. its last clip was deleted), keep the playhead inside it
  useEffect(() => {
    setPlayhead((t) => Math.min(t, project.duration));
  }, [project.duration]);

  // Keep the sound with the playhead: as it moves, and when playback, the tracks or the mutes change
  useEffect(() => {
    const sync = () =>
      audioEngine.syncPlayback(getPlayhead(), isPlaying, project.audioTracks, project.videoClips, project.mutedTracks);
    sync();
    return subscribePlayhead(sync);
  }, [isPlaying, project.audioTracks, project.videoClips, project.mutedTracks]);

  // Spacebar play/pause and keyboard shortcuts.
  // The window listener is registered once and always calls the latest handler through a ref,
  // so shortcuts never act on stale state (e.g. "R" seeing an old isRecordingMic).
  const keyDownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyDownHandlerRef.current = (e: KeyboardEvent) => {
      // Typing in a form field or changing a dropdown must not trigger shortcuts
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      // While a dialog is open the editor behind it is out of reach: no shortcut may edit, play or
      // record there. Each dialog closes itself on Esc (unless it is busy).
      if (isModalOpen) {
        if (isShortcutsOpen && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
          e.preventDefault();
          setIsShortcutsOpen(false);
        }
        return;
      }
      // A button, tab or link reached with the keyboard is pressed with Space or Enter, as anywhere
      // else. (After a mouse click the focus is not shown, and Space plays as usual.)
      if (
        (e.code === 'Space' || e.key === 'Enter') &&
        target?.closest('button, a[href], summary, [role="button"]')?.matches(':focus-visible')
      ) {
        return;
      }
      const selectedKind: TimelineItemKind | null = selectedClipId ? 'clip' : selectedSubId ? 'subtitle' : selectedAudioId ? 'audio' : null;
      if (e.code === 'Space' || (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setIsPlaying((prev) => {
          if (prev) audioEngine.pauseAll();
          return !prev;
        });
      } else if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        // Move the selected item, or with Shift change its length, a tenth of a second at a time
        e.preventDefault();
        const id = selectedClipId || selectedSubId || selectedAudioId;
        if (!selectedKind || !id) {
          notify('動かすアイテム（クリップ、テロップ、音声）をタイムライン上で選択してください。');
          return;
        }
        const delta = e.code === 'ArrowLeft' ? -KEYBOARD_EDIT_STEP_SEC : KEYBOARD_EDIT_STEP_SEC;
        const edited = e.shiftKey ? resizeItem(project, selectedKind, id, delta) : nudgeItem(project, selectedKind, id, delta);
        if (edited) handleUpdateProject({ ...edited, updatedAt: new Date().toISOString() });
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / (project.fps || 30);
        setPlayhead((prev) => Math.max(0, prev - step));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / (project.fps || 30);
        setPlayhead((prev) => Math.min(project.duration, prev + step));
      } else if (e.code === 'Home') {
        e.preventDefault();
        setPlayhead(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        setPlayhead(project.duration);
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleToggleRecordMic();
      } else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsOpen(true);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          // What follows on the main track moves up, so no empty stretch is left behind
          handleUpdateProject(rippleDeleteClip(project, selectedClipId));
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

  // Split the selected clip / telop / audio clip at the playhead (timeline button and the S key)
  const handleSplitAtPlayhead = () => {
    const selectedId = selectedAudioId || selectedSubId || selectedClipId;
    if (!selectedId) {
      notify('分割するアイテム（動画クリップ、字幕、音声トラック）をタイムライン上で選択してください。');
      return;
    }
    const updated = splitItemAtTime(project, selectedId, getPlayhead());
    if (!updated) {
      notify('選択中のアイテムが現在の再生位置（赤線）と交差していないか、端に近すぎるため分割できません。');
      return;
    }
    handleUpdateProject(updated);
  };

  // Microphone recording toggle
  const handleToggleRecordMic = async () => {
    if (!isRecordingMic) {
      // Start recording
      try {
        recordStartTimeRef.current = getPlayhead();
        await audioEngine.startRecording();
        setIsRecordingMic(true);
        setIsPlaying(true); // Automatically advance playhead during voiceover
      } catch (err: any) {
        notify(`マイクの起動に失敗しました: ${err.message}`, 'error');
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
        await saveMediaBlob(blobKey, blob).catch(() =>
          notify('録音をブラウザに保存できませんでした。ページを再読み込みすると、この録音は鳴らなくなります。', 'error')
        );

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
          sourceDuration: duration,
          waveform,
        };

        // Applied to the latest project: edits made while recording or saving are kept.
        // A take that runs past the end makes the video longer (see fitDurationToContent).
        handleUpdateProject((prev) => ({
          ...prev,
          audioTracks: [...prev.audioTracks, newNarration],
        }));
      } catch (err: any) {
        notify(`録音停止時にエラーが発生しました: ${err.message}`, 'error');
        setIsRecordingMic(false);
      }
    }
  };

  // A dialog covers the transport controls, so playback stops when one opens
  // (a recording keeps running with its playhead: only R or the record button ends it)
  useEffect(() => {
    if (isModalOpen && !isRecordingMic) {
      setIsPlaying(false);
      audioEngine.pauseAll();
    }
  }, [isModalOpen, isRecordingMic]);

  // Put another project in the editor, kept in `slot`; its undo history starts empty
  const showProject = (loaded: ProjectData, slot: string) => {
    setIsPlaying(false);
    audioEngine.pauseAll();
    selectItem('clip', null);
    setPlayhead(0);
    dispatchHistory({ type: 'load', project: loaded });
    setSlotId(slot);
    setIsProjectsOpen(false);
  };

  const canSwitchProject = () => {
    if (isRecordingMic) notify('録音を止めてから、プロジェクトを切り替えてください。', 'error');
    return !isRecordingMic;
  };

  // Switch to another project stored in this browser; the one being edited is saved first
  const handleOpenProject = async (targetSlot: string): Promise<boolean> => {
    if (!canSwitchProject()) return false;
    try {
      await flushSave();
      const loaded = await openStoredProject(targetSlot);
      if (!loaded) throw new Error('nothing readable is stored in this slot');
      showProject(loaded, targetSlot);
      return true;
    } catch (e) {
      console.warn('Could not open the project:', e);
      notify('プロジェクトを開けませんでした。', 'error');
      return false;
    }
  };

  const handleNewProject = async () => {
    if (!canSwitchProject()) return;
    const slot = newProjectSlot();
    const blank = createBlankProject();
    try {
      await flushSave();
      // Stored right away, so it is in the project list even if the page is closed before an edit
      await saveProjectToStorage(blank, slot);
      await setCurrentProjectSlot(slot);
    } catch (e) {
      console.warn('Could not store the new project:', e);
      notify('新しいプロジェクトをブラウザに保存できませんでした。', 'error');
      return;
    }
    showProject(blank, slot);
  };

  // On a tab reached with the keyboard, the arrow keys go to the tab beside it (Home / End: the first / last)
  const handleTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.matches(':focus-visible')) return; // after a mouse click the arrow keys still move the playhead
    const index = SIDEBAR_TABS.findIndex((t) => t.id === activeTab);
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % SIDEBAR_TABS.length
        : e.key === 'ArrowLeft'
        ? (index + SIDEBAR_TABS.length - 1) % SIDEBAR_TABS.length
        : e.key === 'Home'
        ? 0
        : e.key === 'End'
        ? SIDEBAR_TABS.length - 1
        : -1;
    if (next < 0 || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveTab(SIDEBAR_TABS[next].id);
    document.getElementById(`tab-${SIDEBAR_TABS[next].id}`)?.focus();
  };

  const handleSelectTrackItem = (type: string, id: string) => {
    if (type === 'clip') {
      selectItem('clip', id);
      setActiveTab('media');
    } else if (type === 'subtitle') {
      selectItem('subtitle', id);
      setActiveTab('telop');
    } else if (type === 'access') {
      selectItem('clip', null); // access cards are not deletable/splittable from the keyboard
      setActiveTab('access');
    } else if (type === 'audio') {
      selectItem('audio', id);
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
        onOpenAutoEditModal={() => setIsAutoEditOpen(true)}
        onOpenProjectsModal={() => setIsProjectsOpen(true)}
        onOpenShortcutsModal={() => setIsShortcutsOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
      />

      {/* Main Workspace (Sidebar + Canvas Preview) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Navigation Tabs + Panel Body */}
        <div className="w-80 md:w-96 bg-[#10141c] border-r border-[#1f2735] flex flex-col shrink-0">
          {/* Tabs Bar */}
          <div
            role="tablist"
            aria-label="編集パネル"
            className="h-10 bg-[#0d1017] border-b border-[#1c2432] grid grid-cols-6 text-center text-xs"
          >
            {SIDEBAR_TABS.map(({ id, label, title, color, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="sidebar-panel"
                  onClick={() => setActiveTab(id)}
                  onKeyDown={handleTabKey}
                  className={`flex flex-col items-center justify-center transition-colors ${
                    isActive ? 'border-b-2 bg-[#141b26]' : 'text-gray-400 hover:text-gray-200'
                  }`}
                  style={isActive ? { color, borderColor: color } : undefined}
                  title={title}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs mt-0.5">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Panel Content Body */}
          <div id="sidebar-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-y-auto">
            {activeTab === 'media' && (
              <MediaPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedClipId={selectedClipId}
                onSelectClip={(id) => selectItem('clip', id)}
              />
            )}
            {activeTab === 'telop' && (
              <TelopPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                selectedSubId={selectedSubId}
                onSelectSubtitle={(id) => selectItem('subtitle', id)}
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
              />
            )}
            {activeTab === 'audio' && (
              <AudioPanel
                project={project}
                onUpdateProject={handleUpdateProject}
                isRecordingMic={isRecordingMic}
                onToggleRecordMic={handleToggleRecordMic}
                selectedAudioId={selectedAudioId}
                onSelectAudio={(id) => selectItem('audio', id)}
              />
            )}
            {activeTab === 'chapters' && (
              <ChaptersPanel
                project={project}
                onUpdateProject={handleUpdateProject}
              />
            )}
          </div>
        </div>

        {/* Center: Video Preview Canvas & Controls */}
        <VideoPreview
          project={project}
          isPlaying={isPlaying}
          onTogglePlay={() => {
            setIsPlaying((prev) => {
              if (prev) audioEngine.pauseAll();
              return !prev;
            });
          }}
          onSeek={setPlayhead}
          previewLang={previewLang}
          isRecordingMic={isRecordingMic}
          onToggleRecordMic={handleToggleRecordMic}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
        />
      </div>

      {/* Bottom: Multi-Track Timeline */}
      <Timeline
        onSplitAtPlayhead={handleSplitAtPlayhead}
        project={project}
        onUpdateProject={handleUpdateProject}
        onSeek={setPlayhead}
        onSelectTrackItem={handleSelectTrackItem}
        selectedItemId={selectedAudioId || selectedSubId || selectedClipId}
        onDeleteClip={(id) => {
          handleUpdateProject(rippleDeleteClip(project, id));
          setSelectedClipId(null);
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

      <ProjectsModal
        isOpen={isProjectsOpen}
        onClose={() => setIsProjectsOpen(false)}
        currentSlotId={slotId}
        currentProject={project}
        saveNow={flushSave}
        onOpenProject={handleOpenProject}
        onNewProject={handleNewProject}
      />

      <Notifications />

      <AutoEditModal
        isOpen={isAutoEditOpen}
        onClose={() => setIsAutoEditOpen(false)}
        project={project}
        onApply={(edited) => {
          setIsPlaying(false);
          audioEngine.pauseAll();
          selectItem('clip', null);
          setPlayhead(0);
          handleUpdateProject(edited);
        }}
      />
    </div>
  );
}
