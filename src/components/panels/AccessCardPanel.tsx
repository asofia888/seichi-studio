import React, { useRef, useState } from 'react';
import { ProjectData, AccessCardItem, SupportedLanguage } from '../../types';
import {
  MapPin,
  Clock,
  Compass,
  Train,
  Car,
  Image as ImageIcon,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';

interface AccessCardPanelProps {
  project: ProjectData;
  onUpdateProject: (p: ProjectData) => void;
  previewLang: SupportedLanguage;
  currentTime: number;
}

export const AccessCardPanel: React.FC<AccessCardPanelProps> = ({
  project,
  onUpdateProject,
  previewLang,
  currentTime,
}) => {
  const mapUploadRef = useRef<HTMLInputElement | null>(null);
  const activeCard = project.accessCards[0] || null;

  const handleUpdateActiveCard = (patch: Partial<AccessCardItem>) => {
    if (!activeCard) return;
    const updated = project.accessCards.map((c, i) =>
      i === 0 ? { ...c, ...patch } : c
    );
    onUpdateProject({
      ...project,
      accessCards: updated,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCreateAccessCard = () => {
    const newCard: AccessCardItem = {
      id: `access_${Date.now()}`,
      startTime: Math.floor(currentTime),
      duration: 7,
      sanctuaryName: {
        ja: project.title.split(' ')[0] || '聖地名',
        en: 'Sanctuary Name',
        th: 'ชื่อศาลเจ้า',
      },
      address: {
        ja: '東京都千代田区...',
        en: 'Chiyoda-ku, Tokyo, Japan',
        th: 'เขตชิโยดะ โตเกียว ญี่ปุ่น',
      },
      latLng: {
        lat: 35.6961,
        lng: 139.7505,
      },
      nearestStation: {
        ja: '最寄り駅から徒歩5分',
        en: '5 min walk from nearest station',
        th: 'เดิน 5 นาทีจากสถานีที่ใกล้ที่สุด',
      },
      parking: {
        ja: '参拝者用駐車場あり (無料30台)',
        en: 'Free parking available (30 cars)',
        th: 'มีที่จอดรถฟรีสำหรับผู้มาสักการะ (30 คัน)',
      },
      visitingHours: {
        ja: '境内参拝自由 (授与所 9:00〜17:00)',
        en: 'Grounds open 24h (Office 9:00-17:00)',
        th: 'เข้าสักการะได้ตลอดเวลา (จุดจำหน่าย 9:00 - 17:00 น.)',
      },
      mapMode: 'leaflet',
      attribution: '© OpenStreetMap contributors',
    };

    onUpdateProject({
      ...project,
      accessCards: [newCard],
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUploadCustomMap = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCard) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      handleUpdateActiveCard({
        mapMode: 'custom_image',
        customMapDataUrl: dataUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto space-y-5 text-sm text-[#E2E8F0]">
      {/* Header Info */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[#D4AF37] flex items-center space-x-1.5">
          <MapPin className="w-4 h-4 text-[#22c55e]" />
          <span>アクセス案内カード設定</span>
        </span>
        <span className="text-xs text-gray-400">OSM Leaflet連動</span>
      </div>

      {!activeCard ? (
        <div className="border border-dashed border-[#293547] rounded-lg p-6 text-center space-y-3 bg-[#111620]">
          <p className="text-xs text-[#8A99AD]">
            アクセス案内カードがまだ配置されていません。動画の後半や結びに配置すると便利です。
          </p>
          <button
            onClick={handleCreateAccessCard}
            className="px-4 py-2 bg-[#1b2f24] hover:bg-[#254233] border border-[#2e5e45] text-[#86efac] text-xs font-semibold rounded transition-colors inline-flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>現在位置（{currentTime.toFixed(1)}s）にアクセスカードを追加</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Timeline Placement Timing */}
          <div className="grid grid-cols-2 gap-3 bg-[#131924] border border-[#242f40] rounded-lg p-3 text-xs">
            <div>
              <label className="text-[#8A99AD] block mb-1">開始秒 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={activeCard.startTime}
                onChange={(e) =>
                  handleUpdateActiveCard({ startTime: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[#8A99AD] block mb-1">表示尺 (秒)</label>
              <input
                type="number"
                step="0.5"
                value={activeCard.duration}
                onChange={(e) =>
                  handleUpdateActiveCard({ duration: Math.max(1, parseFloat(e.target.value) || 1) })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1 text-white font-mono"
              />
            </div>
          </div>

          {/* Map Source Toggle: Leaflet + OSM vs Custom Image */}
          <div className="bg-[#131924] border border-[#242f40] rounded-lg p-3 space-y-2.5">
            <span className="text-xs font-semibold text-[#CBD5E1] block">地図の表示方法</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => handleUpdateActiveCard({ mapMode: 'leaflet' })}
                className={`p-2 rounded border text-left transition-all ${
                  activeCard.mapMode === 'leaflet'
                    ? 'bg-[#1b2e25] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#161d28] border-[#253245] text-gray-400 hover:text-white'
                }`}
              >
                <div className="font-semibold flex items-center space-x-1">
                  <Compass className="w-3.5 h-3.5" />
                  <span>Leaflet + OSM</span>
                </div>
                <div className="text-[10px] mt-0.5 opacity-80">緯度経度からピン生成</div>
              </button>

              <button
                onClick={() => {
                  handleUpdateActiveCard({ mapMode: 'custom_image' });
                  mapUploadRef.current?.click();
                }}
                className={`p-2 rounded border text-left transition-all ${
                  activeCard.mapMode === 'custom_image'
                    ? 'bg-[#1b2e25] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#161d28] border-[#253245] text-gray-400 hover:text-white'
                }`}
              >
                <div className="font-semibold flex items-center space-x-1">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>地図画像をアップ</span>
                </div>
                <div className="text-[10px] mt-0.5 opacity-80">自作の案内図/地図画像</div>
              </button>
              <input
                ref={mapUploadRef}
                type="file"
                accept="image/*"
                onChange={handleUploadCustomMap}
                className="hidden"
              />
            </div>

            {/* Coordinates Lat / Lng inputs */}
            {activeCard.mapMode === 'leaflet' && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#202938] text-xs">
                <div>
                  <label className="text-[#8A99AD] block mb-1">緯度 (Latitude)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={activeCard.latLng.lat}
                    onChange={(e) =>
                      handleUpdateActiveCard({
                        latLng: { ...activeCard.latLng, lat: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2 py-1 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[#8A99AD] block mb-1">経度 (Longitude)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={activeCard.latLng.lng}
                    onChange={(e) =>
                      handleUpdateActiveCard({
                        latLng: { ...activeCard.latLng, lng: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2 py-1 text-white font-mono"
                  />
                </div>
              </div>
            )}

            <div className="text-[10px] text-gray-400 flex items-center justify-between pt-1">
              <span className="flex items-center space-x-1">
                <Check className="w-3 h-3 text-[#22c55e]" />
                <span>出典表記「{activeCard.attribution}」が自動付加されます</span>
              </span>

              {/* 1-click Map Snapshot Baker */}
              <button
                onClick={() => {
                  const offCanvas = document.createElement('canvas');
                  offCanvas.width = 800;
                  offCanvas.height = 600;
                  const ctx = offCanvas.getContext('2d');
                  if (!ctx) return;

                  // High-contrast clean cartographic dark slate style
                  ctx.fillStyle = '#182029';
                  ctx.fillRect(0, 0, 800, 600);

                  // Map grid lines
                  ctx.strokeStyle = 'rgba(212, 175, 55, 0.15)';
                  ctx.lineWidth = 1;
                  for (let x = 0; x < 800; x += 50) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, 600);
                    ctx.stroke();
                  }
                  for (let y = 0; y < 600; y += 50) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(800, y);
                    ctx.stroke();
                  }

                  // River / roads
                  ctx.strokeStyle = '#2b4c68';
                  ctx.lineWidth = 12;
                  ctx.beginPath();
                  ctx.moveTo(0, 480);
                  ctx.bezierCurveTo(240, 500, 460, 280, 800, 320);
                  ctx.stroke();

                  // Sando Sacred Approach path
                  ctx.strokeStyle = '#D4AF37';
                  ctx.lineWidth = 5;
                  ctx.setLineDash([8, 6]);
                  ctx.beginPath();
                  ctx.moveTo(400, 600);
                  ctx.lineTo(400, 260);
                  ctx.stroke();
                  ctx.setLineDash([]);

                  // Shrine Sanctuary Torii Pin
                  ctx.fillStyle = '#C84B31';
                  ctx.beginPath();
                  ctx.arc(400, 240, 22, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 3;
                  ctx.stroke();

                  ctx.fillStyle = '#FFFFFF';
                  ctx.font = 'bold 22px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.fillText('⛩️', 400, 248);

                  // Shrine name tag on map
                  ctx.fillStyle = 'rgba(11, 14, 18, 0.88)';
                  ctx.fillRect(260, 150, 280, 48);
                  ctx.strokeStyle = '#D4AF37';
                  ctx.lineWidth = 1.5;
                  ctx.strokeRect(260, 150, 280, 48);
                  ctx.fillStyle = '#F7E7B4';
                  ctx.font = 'bold 18px "Shippori Mincho", serif';
                  ctx.fillText(activeCard.sanctuaryName.ja || '神社境内', 400, 182);

                  // Coordinates footer
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                  ctx.font = '12px monospace';
                  ctx.textAlign = 'left';
                  ctx.fillText(`📍 ${activeCard.latLng.lat.toFixed(4)}°N, ${activeCard.latLng.lng.toFixed(4)}°E`, 18, 580);
                  ctx.textAlign = 'right';
                  ctx.fillText(activeCard.attribution || '© OpenStreetMap contributors', 782, 580);

                  const dataUrl = offCanvas.toDataURL('image/png');
                  handleUpdateActiveCard({
                    mapMode: 'custom_image',
                    customMapDataUrl: dataUrl,
                  });
                }}
                className="px-2 py-0.5 bg-[#1b2533] hover:bg-[#25354a] border border-[#354862] text-[#93c5fd] rounded text-[10px] transition-colors"
                title="現在の緯度経度から高解像度の地図カード画像を生成して固定"
              >
                🗺️ 地図を確定保存
              </button>
            </div>
          </div>

          {/* Access Details Form (Multilingual linked) */}
          <div className="bg-[#131924] border border-[#242f40] rounded-lg p-3 space-y-3 text-xs">
            <span className="font-semibold text-[#D4AF37] block">
              案内情報（プレビュー中の言語: {previewLang.toUpperCase()}）
            </span>

            {/* Address */}
            <div>
              <label className="text-[#CBD5E1] block mb-1 flex items-center space-x-1">
                <MapPin className="w-3.5 h-3.5 text-[#EAB308]" />
                <span>所在地 (住所)</span>
              </label>
              <input
                type="text"
                value={activeCard.address[previewLang] || activeCard.address.ja}
                onChange={(e) =>
                  handleUpdateActiveCard({
                    address: { ...activeCard.address, [previewLang]: e.target.value },
                  })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1.5 text-white"
              />
            </div>

            {/* Nearest Transit */}
            <div>
              <label className="text-[#CBD5E1] block mb-1 flex items-center space-x-1">
                <Train className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>最寄り駅 / IC</span>
              </label>
              <input
                type="text"
                value={activeCard.nearestStation[previewLang] || activeCard.nearestStation.ja}
                onChange={(e) =>
                  handleUpdateActiveCard({
                    nearestStation: { ...activeCard.nearestStation, [previewLang]: e.target.value },
                  })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1.5 text-white"
              />
            </div>

            {/* Parking */}
            <div>
              <label className="text-[#CBD5E1] block mb-1 flex items-center space-x-1">
                <Car className="w-3.5 h-3.5 text-[#34D399]" />
                <span>駐車場の有無</span>
              </label>
              <input
                type="text"
                value={activeCard.parking[previewLang] || activeCard.parking.ja}
                onChange={(e) =>
                  handleUpdateActiveCard({
                    parking: { ...activeCard.parking, [previewLang]: e.target.value },
                  })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1.5 text-white"
              />
            </div>

            {/* Visiting Hours */}
            <div>
              <label className="text-[#CBD5E1] block mb-1 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-[#F43F5E]" />
                <span>参拝可能時間 / 授与所時間</span>
              </label>
              <input
                type="text"
                value={activeCard.visitingHours[previewLang] || activeCard.visitingHours.ja}
                onChange={(e) =>
                  handleUpdateActiveCard({
                    visitingHours: { ...activeCard.visitingHours, [previewLang]: e.target.value },
                  })
                }
                className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1.5 text-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
