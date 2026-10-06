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

export interface ExportRenderOptions {
  /** Frame decoded from the active video clip for this timestamp (null if none could be decoded) */
  videoFrame: { image: CanvasImageSource; width: number; height: number } | null;
}

export class CanvasRenderer {
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private videoCache: Map<string, HTMLVideoElement> = new Map();

  /**
   * Preload an image URL into cache
   */
  public async preloadImage(url: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
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
      this.videoCache.set(id, vid);
    }
    return vid;
  }

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

      // 7. Render Access Guide Card (Leaflet map or custom map + info)
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
      let img = this.imageCache.get(clip.dataUrl);
      if (!img) {
        img = new Image();
        img.src = clip.dataUrl;
        this.imageCache.set(clip.dataUrl, img);
      }

      if (img.complete && img.naturalWidth > 0) {
        ctx.save();

        // Ken Burns effect calculation
        const kb = clip.kenBurns || { enabled: true, scaleStart: 1.0, scaleEnd: 1.15, panX: 3, panY: 2 };
        const ease = this.easeInOutQuad(progress);
        const scale = kb.scaleStart + (kb.scaleEnd - kb.scaleStart) * ease;
        const panX = ((kb.panX * ease) / 100) * W;
        const panY = ((kb.panY * ease) / 100) * H;

        // Custom focal target shift (if focal point is specified)
        const focusShiftX = kb.focusPoint ? (0.5 - kb.focusPoint.x) * (scale - 1) * W * 0.8 : 0;
        const focusShiftY = kb.focusPoint ? (0.5 - kb.focusPoint.y) * (scale - 1) * H * 0.8 : 0;

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
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 42px 'Shippori Mincho', 'Noto Serif JP', serif`;
      ctx.textAlign = 'left';
      ctx.fillText(name, x + 46, y + 62);

      // Location
      if (location) {
        ctx.fillStyle = '#D4AF37';
        ctx.font = `500 20px 'Noto Serif JP', serif`;
        ctx.fillText(`📍 ${location}`, x + 46, y + 104);
      }

      // Divider
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.25)';
      ctx.beginPath();
      ctx.moveTo(x + 30, y + 124);
      ctx.lineTo(x + cardW - 30, y + 124);
      ctx.stroke();

      // Deity (御祭神)
      if (deity) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = `600 18px 'Noto Serif JP', serif`;
        ctx.fillText(lang === 'ja' ? '【御祭神】' : '【Deity】', x + 30, y + 162);
        ctx.fillStyle = '#F7F6F2';
        ctx.font = `500 21px 'Shippori Mincho', serif`;
        ctx.fillText(deity, x + 130, y + 162);
      }

      // Blessings (ご利益)
      if (blessing) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = `600 18px 'Noto Serif JP', serif`;
        ctx.fillText(lang === 'ja' ? '【ご利益】' : '【Blessing】', x + 30, y + 208);
        ctx.fillStyle = '#E8D595';
        ctx.font = `500 20px 'Shippori Mincho', serif`;
        ctx.fillText(blessing, x + 130, y + 208);
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

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 44px 'Shippori Mincho', serif`;
      ctx.textAlign = 'center';
      ctx.fillText(name, W / 2, y + 70);

      if (location) {
        ctx.fillStyle = '#D4AF37';
        ctx.font = `500 24px 'Noto Serif JP', serif`;
        ctx.fillText(`📍 ${location}`, W / 2, y + 115);
      }

      if (deity) {
        ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
        ctx.font = `600 20px 'Noto Serif JP', serif`;
        ctx.fillText(lang === 'ja' ? '御祭神' : 'Enshrined Deity', W / 2, y + 175);
        ctx.fillStyle = '#F7F6F2';
        ctx.font = `500 26px 'Shippori Mincho', serif`;
        ctx.fillText(deity, W / 2, y + 215);
      }

      if (blessing) {
        ctx.fillStyle = '#E8D595';
        ctx.font = `500 22px 'Noto Serif JP', serif`;
        ctx.fillText(blessing, W / 2, y + 285);
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

    const textWidth = ctx.measureText(text).width;
    const paddingX = 40;
    const bannerW = Math.min(W - 80, textWidth + paddingX * 2);
    const bannerH = fontSize + 40;
    const bannerY = isLandscape ? H - 160 : H - 240;
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
    ctx.fillText(text, W / 2, bannerY + bannerH / 2 + fontSize * 0.35);

    // If English is selected and different from Japanese, optionally show small Japanese subtitle above
    if (lang !== 'ja' && sub.text.ja && sub.text.ja !== text) {
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(212, 175, 55, 0.85)';
      ctx.font = `400 ${fontSize * 0.55}px 'Noto Serif JP', serif`;
      ctx.fillText(sub.text.ja, W / 2, bannerY - 12);
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
    const cardH = isLandscape ? 140 : 150;
    const x = isLandscape ? W - cardW - 70 : 40;
    const y = isLandscape ? 80 : 130;

    // Vermilion and Gold shrine scroll banner
    ctx.fillStyle = 'rgba(18, 14, 12, 0.92)';
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 8);
    ctx.fill();

    ctx.strokeStyle = '#C84B31'; // Vermilion border
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Header badge
    ctx.fillStyle = '#C84B31';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + 16, isLandscape ? 160 : 180, 32, 4);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 16px 'Noto Serif JP', serif`;
    ctx.textAlign = 'center';
    ctx.fillText('⛩️ ' + title, x + 20 + (isLandscape ? 80 : 90), y + 38);

    // Detail text
    ctx.fillStyle = '#F7F6F2';
    ctx.font = `600 ${isLandscape ? 22 : 20}px 'Shippori Mincho', serif`;
    ctx.textAlign = 'left';
    ctx.fillText(detail, x + 24, y + 84);

    ctx.restore();
  }

  /**
   * 4. アクセス案内カード (Leaflet map or custom map + shrine directions)
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
    ctx.font = `bold ${isLandscape ? 40 : 36}px 'Shippori Mincho', serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`⛩️ ${title} 参拝アクセス案内`, W / 2, cardY + 65);

    // Map container dimension
    const mapW = isLandscape ? 560 : cardW - 60;
    const mapH = isLandscape ? 440 : 420;
    const mapX = isLandscape ? cardX + 50 : cardX + 30;
    const mapY = cardY + 110;

    // Draw Map (custom map image or dynamic Leaflet canvas grab)
    if (card.customMapDataUrl && this.imageCache.has(card.customMapDataUrl)) {
      const mapImg = this.imageCache.get(card.customMapDataUrl)!;
      ctx.drawImage(mapImg, mapX, mapY, mapW, mapH);
    } else {
      // Draw atmospheric stylized OpenStreetMap proxy tile with pin
      this.renderStylizedMapProxy(ctx, mapX, mapY, mapW, mapH, card.latLng);
    }

    // Map attribution
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `12px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(card.attribution || '© OpenStreetMap contributors', mapX + mapW - 10, mapY + mapH - 10);

    // Access Information details
    const infoX = isLandscape ? cardX + 650 : cardX + 30;
    let infoY = isLandscape ? cardY + 140 : mapY + mapH + 60;
    const lineSpacing = isLandscape ? 68 : 56;

    const items = [
      { label: lang === 'ja' ? '【所在地】' : '【Address】', val: card.address[lang] || card.address.ja },
      { label: lang === 'ja' ? '【最寄り駅/IC】' : '【Transit】', val: card.nearestStation[lang] || card.nearestStation.ja },
      { label: lang === 'ja' ? '【駐車場】' : '【Parking】', val: card.parking[lang] || card.parking.ja },
      { label: lang === 'ja' ? '【参拝時間】' : '【Hours】', val: card.visitingHours[lang] || card.visitingHours.ja },
    ];

    ctx.textAlign = 'left';
    for (const item of items) {
      ctx.fillStyle = '#D4AF37';
      ctx.font = `600 20px 'Noto Serif JP', serif`;
      ctx.fillText(item.label, infoX, infoY);

      ctx.fillStyle = '#F7F6F2';
      ctx.font = `500 22px 'Shippori Mincho', serif`;
      ctx.fillText(item.val || '-', infoX + 160, infoY);

      infoY += lineSpacing;
    }

    ctx.restore();
  }

  /**
   * Stylized map representation for Leaflet/OSM
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
    ctx.font = `bold ${W > H ? 46 : 42}px 'Shippori Mincho', serif`;
    ctx.fillText(title, W / 2, H / 2 + 30);

    // Subtitle
    const sub = project.branding.opSubtitle[lang] || project.branding.opSubtitle.ja;
    ctx.fillStyle = '#D4AF37';
    ctx.font = `500 ${W > H ? 24 : 22}px 'Noto Serif JP', serif`;
    ctx.fillText(sub, W / 2, H / 2 + 84);

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
    ctx.font = `bold ${W > H ? 38 : 34}px 'Shippori Mincho', serif`;
    ctx.fillText(title, W / 2, H / 2 - 10);

    const sub = project.branding.edSubtitle[lang] || project.branding.edSubtitle.ja;
    ctx.fillStyle = 'rgba(247, 246, 242, 0.7)';
    ctx.font = `500 ${W > H ? 22 : 20}px 'Noto Serif JP', serif`;
    ctx.fillText(sub, W / 2, H / 2 + 50);

    ctx.restore();
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

export const canvasRenderer = new CanvasRenderer();
