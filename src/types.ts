/**
 * 聖地案内動画エディタ - 型定義
 */

export type AspectRatio = '16:9' | '9:16';
export type SubtitleCategory = 'sanctuary_header' | 'commentary' | 'etiquette_tip';
export type SupportedLanguage = 'ja' | 'en' | 'th';

export interface LocalizedText {
  ja: string;
  en: string;
  th: string;
  [lang: string]: string;
}

// 1. プロジェクト設定
export interface ProjectData {
  id: string;
  title: string;
  aspectRatio: AspectRatio;
  fps: number;
  duration: number; // 総尺(秒)
  createdAt: string;
  updatedAt: string;

  branding: BrandingSettings;
  glossary: GlossaryItem[];
  claudeApiKey: string;
  claudeModel: string;

  videoClips: VideoClipItem[];
  subtitles: MultilingualSubtitleItem[];
  accessCards: AccessCardItem[];
  audioTracks: AudioTrackItem[];
  chapters: ChapterItem[];

  mutedTracks?: {
    video?: boolean;
    subtitles?: boolean;
    narration?: boolean;
    ambience?: boolean;
    bgm?: boolean;
  };
}

// 2. ブランディング（OP/ED・フォント・カラー）
export interface BrandingSettings {
  channelName: string;
  opDuration: number; // 秒 (0で無効)
  edDuration: number;
  opTitle: LocalizedText;
  opSubtitle: LocalizedText;
  edTitle: LocalizedText;
  edSubtitle: LocalizedText;
  fontFamily: 'Shippori Mincho' | 'Noto Serif JP' | 'Zen Old Mincho';
  primaryColor: string; // 黄金色 #D4AF37
  accentColor: string;  // 丹色/朱色 #C84B31
  darkColor: string;    // 漆黒 #0D0F12
}

// 3. メディアクリップ（動画・写真）
export interface VideoClipItem {
  id: string;
  name: string;
  type: 'video' | 'image';
  dataUrl?: string;     // 画像や動画のURL (blob: または data:)
  blobKey?: string;     // IndexedDB参照キー
  startTime: number;    // タイムライン開始秒
  duration: number;     // 表示尺
  trimStart: number;
  trimEnd: number;
  
  // ケン・バーンズ効果 (写真用)
  kenBurns?: {
    enabled: boolean;
    preset?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'subtle_drift' | 'custom';
    scaleStart: number;  // 1.0
    scaleEnd: number;    // 1.15
    panX: number;        // -5% 〜 +5%
    panY: number;
    focusPoint?: { x: number; y: number }; // 0.0 to 1.0 相対座標
  };
}

// 4. 多言語字幕・定型テロップ
export interface MultilingualSubtitleItem {
  id: string;
  startTime: number;
  duration: number;
  category: SubtitleCategory;
  text: LocalizedText;

  // 聖地名カード専用の属性
  sanctuaryMeta?: {
    name: LocalizedText;
    location: LocalizedText;
    deity: LocalizedText;       // 御祭神
    blessing: LocalizedText;    // ご利益
  };

  // 参拝作法注釈用
  etiquetteTip?: {
    title: LocalizedText;
    detail: LocalizedText;
  };
}

// 5. 神社仏閣 翻訳用語集
export interface GlossaryItem {
  id: string;
  japanese: string;
  english: string;
  thai: string;
  note?: string;
}

// 6. アクセス案内カード
export interface AccessCardItem {
  id: string;
  startTime: number;
  duration: number;
  sanctuaryName: LocalizedText;
  address: LocalizedText;
  latLng: { lat: number; lng: number };
  nearestStation: LocalizedText;
  parking: LocalizedText;
  visitingHours: LocalizedText;
  
  mapMode: 'leaflet' | 'custom_image';
  customMapDataUrl?: string;
  attribution: string;
}

// 7. 音声トラック (ナレーション / 自然音 / BGM)
export interface AudioTrackItem {
  id: string;
  name: string;
  type: 'narration' | 'ambience' | 'bgm';
  startTime: number;
  duration: number;
  volume: number; // 0.0 - 1.0
  dataUrl?: string;
  blobKey?: string;
  isRecorded?: boolean;
  waveform?: number[]; // Normalized waveform peak heights (0.0 to 1.0)
  estimatedLufs?: number; // Estimated loudness in LUFS (e.g. -14.0)
  trimStart?: number; // Offset from start of source audio (seconds)
  fadeInSec?: number; // Fade in duration (seconds)
  fadeOutSec?: number; // Fade out duration (seconds)

  autoDucking?: {
    enabled: boolean;
    duckVolume: number; // 0.2
    fadeSec: number;    // 0.4
  };
}

// 8. チャプター
export interface ChapterItem {
  id: string;
  timeSec: number;
  title: LocalizedText;
}

// 9. サムネイル作成設定
export interface ThumbnailSettings {
  capturedTime: number;
  title: string;
  subtitle: string;
  badgeText: string;
  titleColor: string;
  bgColor: string;
  fontSize: number;
  aspectRatio: AspectRatio;
  showOverlay: boolean;
}
