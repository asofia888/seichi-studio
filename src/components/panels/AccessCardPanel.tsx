import React, { useRef, useState } from 'react';
import { ProjectData, AccessCardItem, SupportedLanguage } from '../../types';
import type { ProjectUpdate } from '../../services/projectHistory';
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
  onUpdateProject: (update: ProjectUpdate) => void;
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

  // Applied to the latest project, so it is also safe after reading a map image file
  const handleUpdateActiveCard = (patch: Partial<AccessCardItem>) => {
    if (!activeCard) return;
    onUpdateProject((prev) => ({
      ...prev,
      accessCards: prev.accessCards.map((c, i) => (i === 0 ? { ...c, ...patch } : c)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleCreateAccessCard = () => {
    const newCard: AccessCardItem = {
      id: `access_${Date.now()}`,
      startTime: Math.floor(currentTime),
      duration: 7,
      sanctuaryName: {
        ja: project.title.split(' ')[0] || '聖地名',
        en: 'Sanctuary Name',
      },
      address: {
        ja: '東京都千代田区...',
        en: 'Chiyoda-ku, Tokyo, Japan',
      },
      latLng: {
        lat: 35.6961,
        lng: 139.7505,
      },
      nearestStation: {
        ja: '最寄り駅から徒歩5分',
        en: '5 min walk from nearest station',
      },
      parking: {
        ja: '参拝者用駐車場あり (無料30台)',
        en: 'Free parking available (30 cars)',
      },
      visitingHours: {
        ja: '境内参拝自由 (授与所 9:00〜17:00)',
        en: 'Grounds open 24h (Office 9:00-17:00)',
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

          {/* Map source: simple pin map, or an uploaded map image (recommended for an accurate map) */}
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
                  <span>簡易地図</span>
                </div>
                <div className="text-[10px] mt-0.5 opacity-80">ピンと座標のみ（道路は表示されません）</div>
              </button>

              <button
                onClick={() => {
                  handleUpdateActiveCard({ mapMode: 'custom_image' });
                  if (!activeCard.customMapDataUrl) mapUploadRef.current?.click();
                }}
                className={`p-2 rounded border text-left transition-all ${
                  activeCard.mapMode === 'custom_image'
                    ? 'bg-[#1b2e25] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#161d28] border-[#253245] text-gray-400 hover:text-white'
                }`}
              >
                <div className="font-semibold flex items-center space-x-1">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>地図画像（推奨）</span>
                </div>
                <div className="text-[10px] mt-0.5 opacity-80">正確な地図・案内図をアップロード</div>
              </button>
              <input
                ref={mapUploadRef}
                type="file"
                accept="image/*"
                onChange={handleUploadCustomMap}
                className="hidden"
              />
            </div>

            {/* Coordinates: the simple map's pin, and the place to open in OpenStreetMap */}
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

            {activeCard.mapMode === 'custom_image' && (
              <div className="pt-2 border-t border-[#202938] text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={activeCard.customMapDataUrl ? 'text-[#86efac]' : 'text-amber-300'}>
                    {activeCard.customMapDataUrl ? '地図画像を使用中' : '地図画像が未設定です'}
                  </span>
                  <button
                    onClick={() => mapUploadRef.current?.click()}
                    className="px-2 py-0.5 bg-[#1b2533] hover:bg-[#25354a] border border-[#354862] text-[#93c5fd] rounded text-[10px] transition-colors"
                  >
                    {activeCard.customMapDataUrl ? '画像を差し替え' : '画像を選択'}
                  </button>
                </div>
                <label className="text-[#8A99AD] block">出典表記（地図の右下に表示されます）</label>
                <input
                  type="text"
                  value={activeCard.attribution}
                  placeholder="© OpenStreetMap contributors"
                  onChange={(e) => handleUpdateActiveCard({ attribution: e.target.value })}
                  className="w-full bg-[#1b2434] border border-[#2c3d56] rounded px-2.5 py-1 text-white"
                />
              </div>
            )}

            <div className="text-[10px] text-gray-400 bg-[#0f141d] border border-[#1e2634] rounded p-2 leading-relaxed">
              <div className="flex items-center space-x-1 text-gray-300 mb-0.5">
                <Check className="w-3 h-3 text-[#22c55e]" />
                <span>正確な地図を使う手順</span>
              </div>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${activeCard.latLng.lat}&mlon=${activeCard.latLng.lng}#map=16/${activeCard.latLng.lat}/${activeCard.latLng.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#93c5fd] underline hover:text-white"
                  >
                    OpenStreetMapでこの座標を開く
                  </a>
                </li>
                <li>右側の「共有」→「画像」から地図をダウンロード</li>
                <li>「地図画像（推奨）」でアップロード（出典表記「© OpenStreetMap contributors」を残してください）</li>
              </ol>
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
