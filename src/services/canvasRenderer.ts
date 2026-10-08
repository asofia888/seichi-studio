/**
 * Canvas Renderer for Sacred Sanctuary Studio
 * High fidelity 60/30fps rendering engine for 16:9 and 9:16
 * Handles Ken Burns photo pan/zoom, traditional shrine borders,
 * multi-language telops, etiquette tips, and access cards.
 */
import {
  ProjectData,
  VideoClipItem,
  MultilingualSubtitleItem,
  AccessCardItem,
  SupportedLanguage,
} from '../types';
import { audioEngine } from './audioEngine';

export interface ExportRenderOptions {
  /** Frame decoded from the active video clip for this timestamp (null if none could be decoded) */
  videoFrame: { image: CanvasImageSource; width: number; height: number } | null;
}

// Japanese characters that must not begin a line (kinsoku): they stay at the end of the previous line
const NO_LINE_START = '、。，．,.・：；？！!?ー～」』）】〕〉》ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';

export class CanvasRenderer {
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private videoCache: Map<string, HTMLVideoElement> = new Map();

  /**
   * Load an image into the cache and wait until it can be drawn
   */
  public async preloadImage(url: string): Promise<HTMLImageElement> {
    let img = this.imageCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.imageCache.set(url, img);
    }
    await img.decode(); // rejects if the image is broken
    return img;
  }

  /** Cached image for a URL: starts loading on first use and returns null until it is ready */
  private getLoadedImage(url: string): HTMLImageElement | null {
    let img = this.imageCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.imageCache.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /**
   * Break text into lines no wider than maxWidth in the current ctx.font.
   * Latin text breaks at spaces; Japanese may break between any characters (except before
   * closing punctuation). Text beyond maxLines is cut off with an ellipsis.
   */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const fits = (s: string) => ctx.measureText(s).width <= maxWidth;
    // Latin words (with their trailing space) stay whole; every other character is its own token
    const tokens = (text.match(/[^\s　-鿿＀-￯]+\s*|\s+|[\s\S]/gu) || [])
      .flatMap((t) => (fits(t.trimEnd()) ? [t] : Array.from(t))); // a word wider than a line is split anyway

    const lines: string[] = [];
    let line = '';
    for (const token of tokens) {
      if (token.includes('\n')) {
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      const candidate = line + token;
      if (line.trim() && !fits(candidate.trimEnd()) && !NO_LINE_START.includes(token[0])) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else {
        line = candidate;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());

    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = Array.from(kept[maxLines - 1]);
    while (last.length > 0 && !fits(last.join('') + '…')) last.pop();
    kept[maxLines - 1] = last.join('') + '…';
    return kept;
  }

  /**
   * Draw one line of text, shrinking the font (down to minSize) so it fits maxWidth,
   * then cutting it off with an ellipsis if it still does not fit.
   * `font` is a CSS font string with "{size}" where the pixel size goes.
   */
  private drawFittedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    font: string,
    size: number,
    minSize: number
  ) {
    let px = size;
    ctx.font = font.replace('{size}', String(px));
    while (px > minSize && ctx.measureText(text).width > maxWidth) {
      px -= 1;
      ctx.font = font.replace('{size}', String(px));
    }
    ctx.fillText(this.wrapText(ctx, text, maxWidth, 1)[0] ?? '', x, y);
  }

  /**
   * Preload or retrieve video element
   */
  public getVideoElement(id: string, url: string): HTMLVideoElement {
    let vid = this.videoCache.get(id);
    if (!vid) {
      vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.playsInline = true;
      vid.src = url;
      // Loading and seeking finish after the frame was drawn; while paused nothing else would redraw it
      vid.addEventListener('loadeddata', () => this.onVideoFrameReady?.());
      vid.addEventListener('seeked', () => this.onVideoFrameReady?.());
      this.videoCache.set(id, vid);
      audioEngine.connectMediaElement(vid); // so the level meter includes the clip's own sound
    }
    return vid;
  }

  /** Called when a preview video has a new frame to show (it finished loading or seeking) */
  public onVideoFrameReady: (() => void) | null = null;

  /**
   * The media clip shown at this time: undefined during the OP/ED cards,
   * when nothing is placed there, or when the video track is hidden.
   */
  public getActiveClip(project: ProjectData, currentTime: number): VideoClipItem | undefined {
    if (project.branding.opDuration > 0 && currentTime < project.branding.opDuration) return undefined;
    if (project.branding.edDuration > 0 && currentTime >= project.duration - project.branding.edDuration) return undefined;
    if (project.mutedTracks?.video === true) return undefined;
    return project.videoClips.find(
      (c) => currentTime >= c.startTime && currentTime < c.startTime + c.duration
    );
  }

  /**
   * Main render method for a specific frame.
   * Without `exportOptions` it renders the live preview and drives the <video> elements;
   * with them it renders an export frame and leaves the preview's <video> elements untouched.
   */
  public renderFrame(
    ctx: CanvasRenderingContext2D,
    project: ProjectData,
    currentTime: number,
    displayLang: SupportedLanguage = 'ja',
    isPlaying: boolean = false,
    exportOptions?: ExportRenderOptions
  ) {
    const isLandscape = project.aspectRatio === '16:9';
    const W = isLandscape ? 1920 : 1080;
    const H = isLandscape ? 1080 : 1920;

    // Ensure canvas dimensions match target
    if (ctx.canvas.width !== W || ctx.canvas.height !== H) {
      ctx.canvas.width = W;
      ctx.canvas.height = H;
    }

    const activeClip = this.getActiveClip(project, currentTime);
    if (!exportOptions) {
      // Only the clip on screen may play; any other video (e.g. the previous clip) must stop, or its sound keeps going
      for (const [id, vid] of this.videoCache) {
        if (id !== activeClip?.id && !vid.paused) vid.pause();
      }
    }

    // 1. Clear background (Deep sacred charcoal #0b0d11)
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, W, H);

    // 2. Render OP if within opening time
    if (project.branding.opDuration > 0 && currentTime < project.branding.opDuration) {
      this.renderOpeningCard(ctx, project, currentTime, W, H, displayLang);
      return;
    }

    // 3. Render ED if within ending time
    const edStart = project.duration - project.branding.edDuration;
    if (project.branding.edDuration > 0 && currentTime >= edStart) {
      this.renderEndingCard(ctx, project, currentTime - edStart, W, H, displayLang);
      return;
    }

    // 4. Render Active Media Clip (Video or Photo with Ken Burns)
    if (activeClip) {
      this.renderClip(ctx, activeClip, currentTime, W, H, isPlaying, exportOptions);
    } else {
      // Elegant placeholder when no media is assigned or video is hidden
      this.renderAtmosphericPlaceholder(ctx, currentTime, W, H, isLandscape);
    }

    // 5. Render Subtle Vignette & Sacred Mist Overlay
    this.renderSacredAtmosphere(ctx, W, H);

    // 6. Render Subtitles / Shrine Cards (if not hidden)
    const isSubtitlesMuted = project.mutedTracks?.subtitles === true;
    if (!isSubtitlesMuted) {
      const activeSubs = project.subtitles.filter(
        (s) => currentTime >= s.startTime && currentTime < s.startTime + s.duration
      );

      for (const sub of activeSubs) {
        if (sub.category === 'sanctuary_header') {
          this.renderSanctuaryHeaderCard(ctx, sub, W, H, isLandscape, displayLang);
        } else if (sub.category === 'etiquette_tip') {
          this.renderEtiquetteTipCard(ctx, sub, W, H, isLandscape, displayLang);
        } else {
          this.renderCommentarySubtitle(ctx, sub, W, H, isLandscape, displayLang);
        }
      }

      // 7. Render Access Guide Card (simple pin map or uploaded map image + info)
      const activeAccessCard = project.accessCards.find(
        (a) => currentTime >= a.startTime && currentTime < a.startTime + a.duration
      );
      if (activeAccessCard) {
        this.renderAccessCard(ctx, activeAccessCard, currentTime, W, H, isLandscape, displayLang);
      }
    }
  }

  /**
   * Render Media Clip (Video or Photo with Ken Burns effect)
   */
  private renderClip(
    ctx: CanvasRenderingContext2D,
    clip: VideoClipItem,
    currentTime: number,
    W: number,
    H: number,
    isPlaying: boolean,
    exportOptions?: ExportRenderOptions
  ) {
    const elapsed = currentTime - clip.startTime;
    const progress = Math.min(1, Math.max(0, elapsed / (clip.duration || 1)));

    if (clip.type === 'image' && clip.dataUrl) {
      const img = this.getLoadedImage(clip.dataUrl);

      if (img) {
        ctx.save();

        // Ken Burns effect calculation (switched off: the photo stays still)
        const kb = clip.kenBurns || { enabled: true, scaleStart: 1.0, scaleEnd: 1.15, panX: 3, panY: 2 };
        const motion = kb.enabled === false ? null : kb;
        const ease = this.easeInOutQuad(progress);
        const scale = motion ? motion.scaleStart + (motion.scaleEnd - motion.scaleStart) * ease : 1;
        const panX = motion ? ((motion.panX * ease) / 100) * W : 0;
        const panY = motion ? ((motion.panY * ease) / 100) * H : 0;

        // Custom focal target shift (if focal point is specified)
        const focusShiftX = motion?.focusPoint ? (0.5 - motion.focusPoint.x) * (scale - 1) * W * 0.8 : 0;
        const focusShiftY = motion?.focusPoint ? (0.5 - motion.focusPoint.y) * (scale - 1) * H * 0.8 : 0;

        ctx.translate(W / 2 + panX + focusShiftX, H / 2 + panY + focusShiftY);
        ctx.scale(scale, scale);

        // Aspect fit cover
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const screenRatio = W / H;
        let drawW = W;
        let drawH = H;
        if (imgRatio > screenRatio) {
          drawH = H;
          drawW = H * imgRatio;
        } else {
          drawW = W;
          drawH = W / imgRatio;
        }

        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }
    } else if (clip.type === 'video' && exportOptions) {
      // Export: draw the frame decoded for exactly this timestamp
      const frame = exportOptions.videoFrame;
      if (frame) {
        this.drawCover(ctx, frame.image, frame.width, frame.height, W, H);
      }
    } else if (clip.type === 'video' && clip.dataUrl) {
      const vid = this.getVideoElement(clip.id, clip.dataUrl);
      const targetTime = clip.trimStart + elapsed;
      vid.volume = Math.max(0, Math.min(1, clip.volume ?? 1));

      if (isPlaying && vid.paused && vid.readyState >= 2) {
        vid.play().catch(() => {});
      } else if (!isPlaying && !vid.paused) {
        vid.pause();
      }

      if (Math.abs(vid.currentTime - targetTime) > 0.3) {
        vid.currentTime = targetTime;
      }

      if (vid.readyState >= 2) {
        this.drawCover(ctx, vid, vid.videoWidth || W, vid.videoHeight || H, W, H);
      }
    }
  }

  /** Draw a source scaled to fill the W x H frame (cropping the overflow), centered */
  private drawCover(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    W: number,
    H: number
  ) {
    const srcRatio = srcW / srcH;
    let dw = W;
    let dh = H;
    if (srcRatio > W / H) {
      dw = H * srcRatio;
    } else {
      dh = W / srcRatio;
    }
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  /**
   * Atmospheric placeholder when no media is present
   */
  private renderAtmosphericPlaceholder(
    ctx: CanvasRenderingContext2D,
    currentTime: number,
    W: number,
    H: number,
    isLandscape: boolean
  ) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d131a');
    grad.addColorStop(0.5, '#161c22');
    grad.addColorStop(1, '#0a0d10');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle Torii silhouette motif in background
    ctx.save();
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.15)';
    ctx.lineWidth = isLandscape ? 8 : 6;
    const cx = W / 2;
    const cy = H / 2 - (isLandscape ? 60 : 100);
    const tw = isLandscape ? 380 : 280;

    // Torii top bar (kasagi)
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2 - 40, cy - 80);
    ctx.bezierCurveTo(cx - tw / 4, cy - 90, cx + tw / 4, cy - 90, cx + tw / 2 + 40, cy - 80);
    ctx.stroke();

    // Torii second bar (shimaki)
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, cy - 40);
    ctx.lineTo(cx + tw / 2, cy - 40);
    ctx.stroke();

    // Torii pillars
    ctx.beginPath();
    ctx.moveTo(cx - tw / 3, cy - 40);
    ctx.lineTo(cx - tw / 3 - 10, cy + 160);
    ctx.moveTo(cx + tw / 3, cy - 40);
    ctx.lineTo(cx + tw / 3 + 10, cy + 160);
    ctx.stroke();

    ctx.restore();

    // Quiet message
    ctx.fillStyle = 'rgba(247, 246, 242, 0.4)';
    ctx.font = `italic ${isLandscape ? 28 : 24}px 'Shippori Mincho', 'Noto Serif JP', serif`;
    ctx.textAlign = 'center';
    ctx.fillText('神域の静寂 - Sanctuary Stillness', W / 2, H / 2 + (isLandscape ? 120 : 140));
  }

  /**
   * Subtle mist & vignette overlay
   */
  private renderSacredAtmosphere(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * 1. 聖地名カード (Sanctuary Header Card)
   */
  private renderSanctuaryHeaderCard(
    ctx: CanvasRenderingContext2D,
    sub: MultilingualSubtitleItem,
    W: number,
    H: number,
    isLandscape: boolean,
    lang: SupportedLanguage
  ) {
    ctx.save();

    const name = sub.sanctuaryMeta?.name[lang] || sub.text[lang] || sub.text.ja;
    const location = sub.sanctuaryMeta?.location[lang] || sub.sanctuaryMeta?.location.ja || '';
    const deity = sub.sanctuaryMeta?.deity[lang] || sub.sanctuaryMeta?.deity.ja || '';
    const blessing = sub.sanctuaryMeta?.blessing[lang] || sub.sanctuaryMeta?.blessing.ja || '';

    if (isLandscape) {
      // 16:9 Landscape Card: Elegant top-left or centered traditional plaque
      const cardW = 680;
      const cardH = 260;
      const x = 90;
      const y = 90;

      // Dark lacquered wood background with gold borders
      ctx.fillStyle = 'rgba(11, 14, 18, 0.88)';
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 8);
      ctx.fill();

      // Gold border
      ctx.strokeStyle = '#D4AF37';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Inner thin border
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 8, y + 8, cardW - 16, cardH - 16);

      // Vermilion accent seal
      ctx.fillStyle = '#C84B31';
      ctx.fillRect(x + 28, y + 26, 6, 42);

      // Title (Shrine Name)
      const textRight = x + cardW - 30;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      this.drawFittedText(ctx, name, x + 46, y + 62, textRight - (x + 46), `bold {size}px 'Shippori Mincho', 'Noto Serif JP', serif`, 42, 28);

      // Location
      if (location) {
        ctx.fillStyle = '#D4AF37';
        this.drawFittedText(ctx, `📍 ${location}`, x + 46, y + 104, textRight - (x + 46), `500 {size}px 'Noto Serif JP', serif`, 20, 15);
      }

      // Divider
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.25)';
      ctx.beginPath();
      ctx.moveTo(x + 30, y + 124);
      ctx.lineTo(x + cardW - 30, y + 124);
      ctx.stroke();

      // Labels and values; values start after the widest label so English labels never overlap them
      const labelFont = `600 18px 'Noto Serif JP', serif`;
      const deityLabel = lang === 'ja' ? '【御祭神】' : '【Deity】';
      const blessingLabel = lang === 'ja' ? '【ご利益】' : '【Blessing】';
      ctx.font = labelFont;
      const valueX = x + 30 + Math.max(100, Math.max(ctx.measureText(deityLabel).width, ctx.measureText(blessingLabel).width) + 12);

      // Deity (御祭神)
      if (deity) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = labelFont;
        ctx.fillText(deityLabel, x + 30, y + 162);
        ctx.fillStyle = '#F7F6F2';
        this.drawFittedText(ctx, deity, valueX, y + 162, textRight - valueX, `500 {size}px 'Shippori Mincho', serif`, 21, 15);
      }

      // Blessings (ご利益)
      if (blessing) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = labelFont;
        ctx.fillText(blessingLabel, x + 30, y + 208);
        ctx.fillStyle = '#E8D595';
        this.drawFittedText(ctx, blessing, valueX, y + 208, textRight - valueX, `500 {size}px 'Shippori Mincho', serif`, 20, 15);
      }
    } else {
      // 9:16 Shorts Card: Centered compact shrine badge
      const cardW = W - 100;
      const cardH = 340;
      const x = 50;
      const y = 140;

      ctx.fillStyle = 'rgba(11, 14, 18, 0.9)';
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 12);
      ctx.fill();

      ctx.strokeStyle = '#D4AF37';
      ctx.lineWidth = 3;
      ctx.stroke();

      const textW = cardW - 60;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      this.drawFittedText(ctx, name, W / 2, y + 70, textW, `bold {size}px 'Shippori Mincho', serif`, 44, 28);

      if (location) {
        ctx.fillStyle = '#D4AF37';
        this.drawFittedText(ctx, `📍 ${location}`, W / 2, y + 115, textW, `500 {size}px 'Noto Serif JP', serif`, 24, 17);
      }

      if (deity) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = `600 20px 'Noto Serif JP', serif`;
        ctx.fillText(lang === 'ja' ? '御祭神' : 'Enshrined Deity', W / 2, y + 175);
        ctx.fillStyle = '#F7F6F2';
        this.drawFittedText(ctx, deity, W / 2, y + 215, textW, `500 {size}px 'Shippori Mincho', serif`, 26, 18);
      }

      if (blessing) {
        ctx.fillStyle = '#E8D595';
        this.drawFittedText(ctx, blessing, W / 2, y + 285, textW, `500 {size}px 'Noto Serif JP', serif`, 22, 16);
      }
    }

    ctx.restore();
  }

  /**
   * 2. 解説テロップ (Commentary Subtitle)
   */
  private renderCommentarySubtitle(
    ctx: CanvasRenderingContext2D,
    sub: MultilingualSubtitleItem,
    W: number,
    H: number,
    isLandscape: boolean,
    lang: SupportedLanguage
  ) {
    const text = sub.text[lang] || sub.text.ja || '';
    if (!text) return;

    ctx.save();

    const fontSize = isLandscape ? 38 : 34;
    ctx.font = `600 ${fontSize}px 'Shippori Mincho', 'Noto Serif JP', serif`;
    ctx.textAlign = 'center';

    // Long lines (English translations especially) wrap; the banner grows upward from a fixed bottom edge
    const paddingX = 40;
    const lines = this.wrapText(ctx, text, W - 80 - paddingX * 2, isLandscape ? 3 : 4);
    const lineHeight = Math.round(fontSize * 1.35);
    const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bannerW = Math.min(W - 80, textWidth + paddingX * 2);
    const bannerH = fontSize + 40 + (lines.length - 1) * lineHeight;
    const bannerBottom = isLandscape ? H - 82 : H - 166;
    const bannerY = bannerBottom - bannerH;
    const bannerX = (W - bannerW) / 2;

    // Background bar
    ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
    ctx.beginPath();
    ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
    ctx.fill();

    // Gold top line accent
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bannerX + 15, bannerY);
    ctx.lineTo(bannerX + bannerW - 15, bannerY);
    ctx.stroke();

    // Text shadow and text
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#FFFFFF';
    lines.forEach((l, i) => {
      ctx.fillText(l, W / 2, bannerY + 20 + fontSize * 0.85 + i * lineHeight);
    });

    // If English is selected and different from Japanese, optionally show small Japanese subtitle above
    if (lang !== 'ja' && sub.text.ja && sub.text.ja !== text) {
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(212, 175, 55, 0.85)';
      const jaSize = Math.round(fontSize * 0.55);
      this.drawFittedText(ctx, sub.text.ja, W / 2, bannerY - 12, W - 80, `400 {size}px 'Noto Serif JP', serif`, jaSize, 14);
    }

    ctx.restore();
  }

  /**
   * 3. 参拝のポイント/作法の注釈 (Etiquette Tip Card)
   */
  private renderEtiquetteTipCard(
    ctx: CanvasRenderingContext2D,
    sub: MultilingualSubtitleItem,
    W: number,
    H: number,
    isLandscape: boolean,
    lang: SupportedLanguage
  ) {
    ctx.save();

    const title = sub.etiquetteTip?.title[lang] || sub.etiquetteTip?.title.ja || '参拝作法・作法心得';
    const detail = sub.etiquetteTip?.detail[lang] || sub.text[lang] || sub.text.ja;

    const cardW = isLandscape ? 520 : W - 80;
    const x = isLandscape ? W - cardW - 70 : 40;
    const y = isLandscape ? 80 : 130;

    // Detail text wraps (up to 3 lines) and the card grows to fit it
    const detailSize = isLandscape ? 22 : 20;
    const detailFont = `600 ${detailSize}px 'Shippori Mincho', serif`;
    ctx.font = detailFont;
    const detailLines = this.wrapText(ctx, detail, cardW - 48, 3);
    const lineHeight = Math.round(detailSize * 1.45);
    const cardH = Math.max(isLandscape ? 140 : 150, 84 + (detailLines.length - 1) * lineHeight + 34);

    // Vermilion and Gold shrine scroll banner
    ctx.fillStyle = 'rgba(18, 14, 12, 0.92)';
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 8);
    ctx.fill();

    ctx.strokeStyle = '#C84B31'; // Vermilion border
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Header badge sized to its title
    const badgeFont = `bold {size}px 'Noto Serif JP', serif`;
    const badgeText = '⛩️ ' + title;
    ctx.font = badgeFont.replace('{size}', '16');
    const badgeW = Math.min(cardW - 40, Math.max(isLandscape ? 160 : 180, ctx.measureText(badgeText).width + 28));
    ctx.fillStyle = '#C84B31';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 16, badgeW, 32, 4);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    this.drawFittedText(ctx, badgeText, x + 20 + badgeW / 2, y + 38, badgeW - 16, badgeFont, 16, 12);

    // Detail text
    ctx.fillStyle = '#F7F6F2';
    ctx.font = detailFont;
    ctx.textAlign = 'left';
    detailLines.forEach((l, i) => ctx.fillText(l, x + 24, y + 84 + i * lineHeight));

    ctx.restore();
  }

  /**
   * 4. アクセス案内カード (simple pin map or uploaded map image + shrine directions)
   */
  private renderAccessCard(
    ctx: CanvasRenderingContext2D,
    card: AccessCardItem,
    currentTime: number,
    W: number,
    H: number,
    isLandscape: boolean,
    lang: SupportedLanguage
  ) {
    ctx.save();

    const elapsed = currentTime - card.startTime;
    let alpha = 1.0;
    // Fade in
    if (elapsed < 0.6) alpha = elapsed / 0.6;
    // Fade out
    const remaining = card.startTime + card.duration - currentTime;
    if (remaining < 0.6) alpha = remaining / 0.6;

    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    const cardW = isLandscape ? 1200 : W - 80;
    const cardH = isLandscape ? 680 : 1100;
    const cardX = (W - cardW) / 2;
    const cardY = (H - cardH) / 2;

    // Card background
    ctx.fillStyle = 'rgba(10, 13, 17, 0.95)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    ctx.fill();

    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Title
    const title = card.sanctuaryName[lang] || card.sanctuaryName.ja;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    const heading = lang === 'ja' ? `⛩️ ${title} 参拝アクセス案内` : `⛩️ Access to ${title}`;
    this.drawFittedText(ctx, heading, W / 2, cardY + 65, cardW - 60, `bold {size}px 'Shippori Mincho', serif`, isLandscape ? 40 : 36, 24);

    // Map container dimension
    const mapW = isLandscape ? 560 : cardW - 60;
    const mapH = isLandscape ? 440 : 420;
    const mapX = isLandscape ? cardX + 50 : cardX + 30;
    const mapY = cardY + 110;

    // Draw Map (uploaded map image, cropped to fill the frame without stretching, or the stylized map)
    const mapImg = card.mapMode === 'custom_image' && card.customMapDataUrl ? this.getLoadedImage(card.customMapDataUrl) : null;
    if (mapImg) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(mapX, mapY, mapW, mapH);
      ctx.clip();
      ctx.translate(mapX, mapY);
      this.drawCover(ctx, mapImg, mapImg.naturalWidth, mapImg.naturalHeight, mapW, mapH);
      ctx.restore();

      // Credit for the uploaded map (e.g. © OpenStreetMap contributors)
      if (card.attribution) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = `12px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(card.attribution, mapX + mapW - 10, mapY + mapH - 10);
      }
    } else {
      // Simple decorative map with a pin at the coordinates (no map data, so no map credit)
      this.renderStylizedMapProxy(ctx, mapX, mapY, mapW, mapH, card.latLng);
    }

    // Access Information details
    const infoX = isLandscape ? cardX + 650 : cardX + 30;
    let infoY = isLandscape ? cardY + 140 : mapY + mapH + 60;
    const lineSpacing = isLandscape ? 68 : 80; // room for a value that wraps onto a second line

    const items = [
      { label: lang === 'ja' ? '【所在地】' : '【Address】', val: card.address[lang] || card.address.ja },
      { label: lang === 'ja' ? '【最寄り駅/IC】' : '【Transit】', val: card.nearestStation[lang] || card.nearestStation.ja },
      { label: lang === 'ja' ? '【駐車場】' : '【Parking】', val: card.parking[lang] || card.parking.ja },
      { label: lang === 'ja' ? '【参拝時間】' : '【Hours】', val: card.visitingHours[lang] || card.visitingHours.ja },
    ];

    ctx.textAlign = 'left';
    const labelFont = `600 20px 'Noto Serif JP', serif`;
    const valueFont = `500 22px 'Shippori Mincho', serif`;
    ctx.font = labelFont;
    const valueX = infoX + Math.max(...items.map((item) => ctx.measureText(item.label).width)) + 16;
    const valueMaxW = cardX + cardW - 40 - valueX;
    for (const item of items) {
      ctx.fillStyle = '#D4AF37';
      ctx.font = labelFont;
      ctx.fillText(item.label, infoX, infoY);

      // Long addresses wrap onto a second line
      ctx.fillStyle = '#F7F6F2';
      ctx.font = valueFont;
      this.wrapText(ctx, item.val || '-', valueMaxW, 2).forEach((l, i) => ctx.fillText(l, valueX, infoY + i * 28));

      infoY += lineSpacing;
    }

    ctx.restore();
  }

  /**
   * Simple decorative map: grid, a river line, and a pin with the coordinates (not real map data)
   */
  private renderStylizedMapProxy(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    latLng: { lat: number; lng: number }
  ) {
    // Stylized cartographic background
    ctx.fillStyle = '#1c242c';
    ctx.fillRect(x, y, w, h);

    // Map contour grid
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.12)';
    ctx.lineWidth = 1;
    for (let gx = x; gx < x + w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    for (let gy = y; gy < y + h; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }

    // Stylized river/path curve
    ctx.strokeStyle = 'rgba(70, 130, 180, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.7);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.8, x + w * 0.6, y + h * 0.2, x + w, y + h * 0.4);
    ctx.stroke();

    // Map Pin
    const pinX = x + w / 2;
    const pinY = y + h / 2 - 10;

    // Pin pulse ring
    ctx.strokeStyle = 'rgba(200, 75, 49, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pinX, pinY, 24, 0, Math.PI * 2);
    ctx.stroke();

    // Pin body
    ctx.fillStyle = '#C84B31';
    ctx.beginPath();
    ctx.arc(pinX, pinY - 14, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pinX - 14, pinY - 14);
    ctx.lineTo(pinX, pinY + 8);
    ctx.lineTo(pinX + 14, pinY - 14);
    ctx.fill();

    // Pin inner torii icon
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.fillText('⛩️', pinX, pinY - 10);

    // Coordinate tag
    ctx.fillStyle = 'rgba(247, 246, 242, 0.8)';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${latLng.lat.toFixed(4)}°N, ${latLng.lng.toFixed(4)}°E`, pinX, pinY + 36);
  }

  /**
   * 5. オープニング (Opening Intro Card)
   */
  private renderOpeningCard(
    ctx: CanvasRenderingContext2D,
    project: ProjectData,
    currentTime: number,
    W: number,
    H: number,
    lang: SupportedLanguage
  ) {
    const dur = project.branding.opDuration;
    const alpha = Math.sin((currentTime / dur) * Math.PI); // Smooth fade in and fade out

    ctx.save();
    ctx.fillStyle = '#090B0E';
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    // Torii icon
    ctx.fillStyle = '#D4AF37';
    ctx.font = `${W > H ? 80 : 100}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('⛩️', W / 2, H / 2 - 60);

    // Channel Name / Series Title
    const title = project.branding.opTitle[lang] || project.branding.opTitle.ja;
    ctx.fillStyle = '#F7F6F2';
    this.drawFittedText(ctx, title, W / 2, H / 2 + 30, W - 160, `bold {size}px 'Shippori Mincho', serif`, W > H ? 46 : 42, 26);

    // Subtitle
    const sub = project.branding.opSubtitle[lang] || project.branding.opSubtitle.ja;
    ctx.fillStyle = '#D4AF37';
    this.drawFittedText(ctx, sub, W / 2, H / 2 + 84, W - 160, `500 {size}px 'Noto Serif JP', serif`, W > H ? 24 : 22, 16);

    ctx.restore();
  }

  /**
   * 6. エンディング (Ending Outro Card)
   */
  private renderEndingCard(
    ctx: CanvasRenderingContext2D,
    project: ProjectData,
    elapsed: number,
    W: number,
    H: number,
    lang: SupportedLanguage
  ) {
    const dur = project.branding.edDuration;
    const alpha = Math.min(1, Math.sin((elapsed / dur) * Math.PI));

    ctx.save();
    ctx.fillStyle = '#090B0E';
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    ctx.fillStyle = '#D4AF37';
    ctx.font = '70px serif';
    ctx.textAlign = 'center';
    ctx.fillText('⛩️', W / 2, H / 2 - 90);

    const title = project.branding.edTitle[lang] || project.branding.edTitle.ja;
    ctx.fillStyle = '#F7F6F2';
    this.drawFittedText(ctx, title, W / 2, H / 2 - 10, W - 160, `bold {size}px 'Shippori Mincho', serif`, W > H ? 38 : 34, 22);

    const sub = project.branding.edSubtitle[lang] || project.branding.edSubtitle.ja;
    ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
    this.drawFittedText(ctx, sub, W / 2, H / 2 + 50, W - 160, `500 {size}px 'Noto Serif JP', serif`, W > H ? 22 : 20, 15);

    ctx.restore();
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

export const canvasRenderer = new CanvasRenderer();
