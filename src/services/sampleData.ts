/**
 * Initial Default Sacred Shrine Project Data
 * Features: Togakushi Shrine Okusha (戸隠神社 奥社)
 */
import { ProjectData } from '../types';

export const initialProjectData: ProjectData = {
  id: 'project-togakushi-okusha',
  title: '戸隠神社 奥社 神秘の杉並木と神話の杜',
  aspectRatio: '16:9',
  fps: 30,
  duration: 45, // 45 seconds sample
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),

  branding: {
    channelName: '聖地巡礼の旅 - Sacred Japan',
    opDuration: 3,
    edDuration: 4,
    opTitle: {
      ja: '聖地巡礼の旅',
      en: 'Sacred Japan Sanctuary Pilgrimage',
    },
    opSubtitle: {
      ja: '戸隠神社 奥社 参拝紀行',
      en: 'Togakushi Shrine Okusha - Sacred Forest Walk',
    },
    edTitle: {
      ja: '心静かにご参拝いただき、感謝申し上げます',
      en: 'Thank you for worshipping with a calm heart',
    },
    edSubtitle: {
      ja: 'チャンネル登録・高評価をいただけると幸いです',
      en: 'Please subscribe and like for more sacred journeys',
    },
    fontFamily: 'Shippori Mincho',
    primaryColor: '#D4AF37',
    accentColor: '#C84B31',
    darkColor: '#0B0D11',
  },

  glossary: [
    {
      id: 'g-1',
      japanese: '戸隠神社',
      english: 'Togakushi Shrine',
      note: '長野県の霊峰・戸隠山の麓に鎮座する古社',
    },
    {
      id: 'g-2',
      japanese: '天手力雄命',
      english: 'Ame-no-Tajikarao-no-Mikoto',
      note: '天岩戸を投げ飛ばした力の神様',
    },
    {
      id: 'g-3',
      japanese: '天照大御神',
      english: 'Amaterasu-Ōmikami',
      note: '太陽の女神・皇祖神',
    },
    {
      id: 'g-4',
      japanese: '奥社',
      english: 'Okusha (Inner Sanctuary)',
    },
    {
      id: 'g-5',
      japanese: '随神門',
      english: 'Zuishinmon Gate',
    },
    {
      id: 'g-6',
      japanese: '二礼二拍手一礼',
      english: 'Two bows, two claps, and one bow',
    },
  ],

  claudeApiKey: '',
  claudeModel: 'claude-3-5-sonnet-20241022',

  videoClips: [
    {
      id: 'clip-1',
      name: '大鳥居と参道入口',
      type: 'image',
      startTime: 3,
      duration: 10,
      trimStart: 0,
      trimEnd: 10,
      kenBurns: {
        enabled: true,
        scaleStart: 1.0,
        scaleEnd: 1.15,
        panX: 2,
        panY: -1,
      },
    },
    {
      id: 'clip-2',
      name: '樹齢四百年の杉並木と随神門',
      type: 'image',
      startTime: 13,
      duration: 12,
      trimStart: 0,
      trimEnd: 12,
      kenBurns: {
        enabled: true,
        scaleStart: 1.12,
        scaleEnd: 1.0,
        panX: -2,
        panY: 3,
      },
    },
    {
      id: 'clip-3',
      name: '奥社本殿と拝殿',
      type: 'image',
      startTime: 25,
      duration: 16,
      trimStart: 0,
      trimEnd: 16,
      kenBurns: {
        enabled: true,
        scaleStart: 1.0,
        scaleEnd: 1.18,
        panX: 0,
        panY: -2,
      },
    },
  ],

  subtitles: [
    {
      id: 'sub-1',
      startTime: 3.5,
      duration: 8,
      category: 'sanctuary_header',
      text: {
        ja: '戸隠神社 奥社',
        en: 'Togakushi Shrine Okusha',
      },
      sanctuaryMeta: {
        name: {
          ja: '戸隠神社 奥社',
          en: 'Togakushi Shrine Okusha',
        },
        location: {
          ja: '長野県長野市戸隠',
          en: 'Togakushi, Nagano City, Nagano',
        },
        deity: {
          ja: '天手力雄命 (あめのたぢからおのみこと)',
          en: 'Ame-no-Tajikarao-no-Mikoto',
        },
        blessing: {
          ja: '開運・心願成就・五穀豊熟・スポーツ必勝',
          en: 'Good fortune, wish fulfillment, abundant harvest & victory',
        },
      },
    },
    {
      id: 'sub-2',
      startTime: 13.5,
      duration: 7,
      category: 'commentary',
      text: {
        ja: '樹齢四百年を超える巨大な杉並木が、静寂の参道に厳かな空気を漂わせます。',
        en: 'Towering cedar trees over 400 years old cast a solemn stillness across the sacred approach.',
      },
    },
    {
      id: 'sub-3',
      startTime: 21,
      duration: 6,
      category: 'etiquette_tip',
      text: {
        ja: '手水舎で両手と口を清め、心を静めてから奥社へ進みます。',
        en: 'Purify hands and mouth at the Temizuya pavilion before approaching.',
      },
      etiquetteTip: {
        title: {
          ja: '参拝の作法・手水のお清め',
          en: 'Worship Etiquette: Water Purification',
        },
        detail: {
          ja: '左手・右手・口を清め、柄杓の柄を流して一礼します。',
          en: 'Rinse left hand, right hand, mouth, rinse the ladle handle, and bow.',
        },
      },
    },
    {
      id: 'sub-4',
      startTime: 27.5,
      duration: 7,
      category: 'commentary',
      text: {
        ja: '本殿にて二礼二拍手一礼。天岩戸伝説の力強い神気に包まれます。',
        en: 'At the Main Hall: two bows, two claps, one bow, feeling the divine presence of myth.',
      },
    },
  ],

  accessCards: [
    {
      id: 'access-1',
      startTime: 35,
      duration: 6,
      sanctuaryName: {
        ja: '戸隠神社 奥社',
        en: 'Togakushi Shrine Okusha',
      },
      address: {
        ja: '長野県長野市戸隠3690',
        en: '3690 Togakushi, Nagano City, Nagano',
      },
      latLng: {
        lat: 36.7588,
        lng: 138.0833,
      },
      nearestStation: {
        ja: 'JR長野駅からアルピコ交通バス「戸隠奥社」下車（約1時間）',
        en: 'JR Nagano Station -> Alpico Bus to Togakushi-Okusha (~1 hr)',
      },
      parking: {
        ja: '奥社入口有料駐車場あり（普通車150台）',
        en: 'Paid parking available at entrance (150 cars)',
      },
      visitingHours: {
        ja: '境内参拝自由（授与所・お守り受付 9:00〜17:00）',
        en: 'Sanctuary grounds open 24/7 (Amulet office: 9:00 - 17:00)',
      },
      mapMode: 'leaflet',
      attribution: '© OpenStreetMap contributors',
    },
  ],

  audioTracks: [
    {
      id: 'audio-bgm-1',
      name: '静寂の雅楽・瞑想旋律',
      type: 'bgm',
      startTime: 0,
      duration: 45,
      volume: 0.65,
      waveform: [
        0.35, 0.45, 0.6, 0.75, 0.7, 0.55, 0.65, 0.8, 0.85, 0.7, 0.6, 0.5, 0.65, 0.8, 0.9, 0.75,
        0.6, 0.7, 0.85, 0.8, 0.65, 0.7, 0.85, 0.9, 0.75, 0.65, 0.75, 0.85, 0.8, 0.65, 0.6, 0.55,
        0.7, 0.8, 0.85, 0.75, 0.6, 0.7, 0.85, 0.7, 0.6, 0.55, 0.45, 0.35, 0.25, 0.2
      ],
      autoDucking: {
        enabled: true,
        duckVolume: 0.25,
        fadeSec: 0.4,
      },
    },
    {
      id: 'audio-ambience-1',
      name: '神域の風と木々のざわめき',
      type: 'ambience',
      startTime: 0,
      duration: 45,
      volume: 0.45,
      waveform: [
        0.3, 0.35, 0.4, 0.45, 0.4, 0.35, 0.4, 0.5, 0.45, 0.35, 0.3, 0.35, 0.4, 0.45, 0.5, 0.4,
        0.35, 0.4, 0.45, 0.5, 0.45, 0.35, 0.4, 0.45, 0.4, 0.35, 0.3, 0.35, 0.4, 0.45, 0.4, 0.35,
        0.35, 0.4, 0.45, 0.4, 0.35, 0.3, 0.35, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.15
      ],
    },
    {
      id: 'audio-narr-1',
      name: '戸隠の由来と参道案内 🎙️',
      type: 'narration',
      startTime: 13,
      duration: 11,
      volume: 1.0,
      isRecorded: true,
      waveform: [
        0.1, 0.4, 0.85, 0.95, 0.7, 0.85, 0.6, 0.15, 0.1, 0.55, 0.9, 0.85, 0.75, 0.65, 0.15,
        0.1, 0.45, 0.8, 0.95, 0.9, 0.7, 0.15, 0.1, 0.5, 0.85, 0.95, 0.8, 0.65, 0.2, 0.1
      ],
    },
  ],

  chapters: [
    {
      id: 'ch-1',
      timeSec: 0,
      title: {
        ja: 'オープニング・戸隠の神域へ',
        en: 'Opening: Into the Togakushi Sanctuary',
      },
    },
    {
      id: 'ch-2',
      timeSec: 3,
      title: {
        ja: '一の鳥居と大鳥居（聖地名・御祭神）',
        en: 'First Torii Gate & Deity Information',
      },
    },
    {
      id: 'ch-3',
      timeSec: 13,
      title: {
        ja: '樹齢四百年の杉並木と随神門',
        en: '400-Year-Old Cedar Forest Approach',
      },
    },
    {
      id: 'ch-4',
      timeSec: 21,
      title: {
        ja: '手水舎の作法心得',
        en: 'Temizuya Purification Etiquette',
      },
    },
    {
      id: 'ch-5',
      timeSec: 27,
      title: {
        ja: '奥社本殿のご神気と二礼二拍手一礼',
        en: 'Inner Sanctuary Prayer & Blessing',
      },
    },
    {
      id: 'ch-6',
      timeSec: 35,
      title: {
        ja: '参拝アクセス情報（交通・駐車場・時間）',
        en: 'Access, Transit & Visiting Hours',
      },
    },
    {
      id: 'ch-7',
      timeSec: 41,
      title: {
        ja: 'エンディング',
        en: 'Ending',
      },
    },
  ],
};

export const izumoProjectData: ProjectData = {
  ...initialProjectData,
  id: 'project-izumo-taisha',
  title: '出雲大社 神話と縁結びの大古社（大注連縄と二礼四拍手一礼）',
  branding: {
    ...initialProjectData.branding,
    opSubtitle: {
      ja: '出雲大社 悠久の神代紀行',
      en: 'Izumo Oyashiro - Ancient Myth & Sacred Bonds',
    },
  },
  subtitles: [
    {
      id: 'izumo-sub-1',
      startTime: 3.5,
      duration: 8,
      category: 'sanctuary_header',
      text: {
        ja: '出雲大社（いづもおおやしろ）',
        en: 'Izumo Taisha (Izumo Grand Shrine)',
      },
      sanctuaryMeta: {
        name: {
          ja: '出雲大社',
          en: 'Izumo Grand Shrine',
        },
        location: {
          ja: '島根県出雲市大社町',
          en: 'Taisha-cho, Izumo City, Shimane',
        },
        deity: {
          ja: '大国主大神 (おおくにぬしのおおかみ)',
          en: 'Ōkuninushi-no-Ōkami',
        },
        blessing: {
          ja: '縁結び・福徳円満・五穀豊穣・商売繁盛',
          en: 'Sacred match-making, boundless fortune & prosperous bonds',
        },
      },
    },
    {
      id: 'izumo-sub-2',
      startTime: 12,
      duration: 8,
      category: 'commentary',
      text: {
        ja: '神楽殿に掲げられた日本最大級の大注連縄。重さ5.2トン、圧倒的な神威が漂います。',
        en: 'The Kaguraden features Japan\'s largest sacred shimenawa rope, weighing 5.2 tons.',
      },
    },
    {
      id: 'izumo-sub-3',
      startTime: 21,
      duration: 7,
      category: 'etiquette_tip',
      text: {
        ja: '出雲大社独自の作法は「二礼・四拍手・一礼」。心を込めて4回拍手を打ちます。',
        en: 'Izumo\'s unique worship custom: Two bows, FOUR claps, and one final bow.',
      },
      etiquetteTip: {
        title: {
          ja: '出雲大社の特別作法・四拍手',
          en: 'Special Etiquette: Four Claps',
        },
        detail: {
          ja: '神々に深き敬意を表す古式ゆかしい四拍手で参拝します。',
          en: 'Four claps express utmost reverence to the divine deities.',
        },
      },
    },
  ],
  accessCards: [
    {
      id: 'izumo-access-1',
      startTime: 34,
      duration: 7,
      sanctuaryName: {
        ja: '出雲大社',
        en: 'Izumo Grand Shrine',
      },
      address: {
        ja: '島根県出雲市大社町杵築東195',
        en: '195 Kizukihigashi, Taisha-cho, Izumo, Shimane',
      },
      latLng: {
        lat: 35.4019,
        lng: 132.6855,
      },
      nearestStation: {
        ja: '一畑電車「出雲大社前駅」から徒歩7分 / JR出雲市駅からバス約25分',
        en: 'Ichibata Electric Railway Izumo Taisha-mae Station (7 min walk)',
      },
      parking: {
        ja: '大駐車場完備（無料・普通車約380台）',
        en: 'Large free parking lot (~380 cars)',
      },
      visitingHours: {
        ja: '参拝時間 6:00〜18:00 (神札授与 8:30〜16:30)',
        en: '6:00 - 18:00 (Amulet Office: 8:30 - 16:30)',
      },
      mapMode: 'leaflet',
      attribution: '© OpenStreetMap contributors',
    },
  ],
};

export const iseProjectData: ProjectData = {
  ...initialProjectData,
  id: 'project-ise-jingu',
  title: '伊勢神宮 内宮 五十鈴川の清流と日本の総氏神',
  branding: {
    ...initialProjectData.branding,
    opSubtitle: {
      ja: '伊勢神宮 皇大神宮（内宮）参拝録',
      en: 'Ise Jingu Kotai Jingu (Naiku) - The Sun Deity',
    },
  },
  subtitles: [
    {
      id: 'ise-sub-1',
      startTime: 3.5,
      duration: 8,
      category: 'sanctuary_header',
      text: {
        ja: '伊勢神宮 内宮（皇大神宮）',
        en: 'Ise Grand Shrine - Naiku (Kotai Jingu)',
      },
      sanctuaryMeta: {
        name: {
          ja: '伊勢神宮 皇大神宮（内宮）',
          en: 'Ise Grand Shrine (Naiku)',
        },
        location: {
          ja: '三重県伊勢市宇治館町',
          en: 'Uji-tachi-cho, Ise City, Mie',
        },
        deity: {
          ja: '天照大御神 (あまてらすおおみかみ)',
          en: 'Amaterasu-Ōmikami',
        },
        blessing: {
          ja: '国土安寧・国家繁栄・諸願成就・万民の母神',
          en: 'Peace of the nation, universal protection & sacred blessing',
        },
      },
    },
    {
      id: 'ise-sub-2',
      startTime: 12.5,
      duration: 8,
      category: 'commentary',
      text: {
        ja: '宇治橋を渡ると俗界から聖域へ。五十鈴川の清らかな水で手と口を清めます。',
        en: 'Crossing Uji Bridge steps into the sacred realm; purify hands in the Isuzugawa stream.',
      },
    },
    {
      id: 'ise-sub-3',
      startTime: 21,
      duration: 7,
      category: 'etiquette_tip',
      text: {
        ja: '五十鈴川御手洗場（みたらし）では川辺の澄んだ清流に手を浸して身を清めます。',
        en: 'At Isuzugawa Mitarashi, dip hands directly into the crystal-clear natural stream.',
      },
      etiquetteTip: {
        title: {
          ja: '自然の清流・御手洗場の作法',
          en: 'Mitarashi Stream Purification',
        },
        detail: {
          ja: '石畳の川辺にしゃがみ、清流ですくい清めます。',
          en: 'Crouch gently by the stone bank and cleanse with running water.',
        },
      },
    },
  ],
  accessCards: [
    {
      id: 'ise-access-1',
      startTime: 34,
      duration: 7,
      sanctuaryName: {
        ja: '伊勢神宮 内宮',
        en: 'Ise Jingu Naiku',
      },
      address: {
        ja: '三重県伊勢市宇治館町1',
        en: '1 Ujitachi-cho, Ise City, Mie',
      },
      latLng: {
        lat: 34.4550,
        lng: 136.7258,
      },
      nearestStation: {
        ja: '近鉄「五十鈴川駅」または「伊勢市駅」から三重交通バス「内宮前」下車',
        en: 'Kintetsu Isuzugawa Station -> Mie Kotsu Bus to "Naiku-mae"',
      },
      parking: {
        ja: '市営駐車場あり（有料・内宮周辺約1,500台）',
        en: 'Municipal parking (~1,500 cars around Naiku)',
      },
      visitingHours: {
        ja: '参拝時間 5:00〜18:00 (季節により変動)',
        en: 'Grounds open 5:00 - 18:00 (varies by season)',
      },
      mapMode: 'leaflet',
      attribution: '© OpenStreetMap contributors',
    },
  ],
};

export const shrinePresets = [
  { id: 'togakushi', name: '🌲 長野・戸隠神社 奥社（杉並木と神話）', data: initialProjectData },
  { id: 'izumo', name: '⛩️ 島根・出雲大社（縁結びと大注連縄）', data: izumoProjectData },
  { id: 'ise', name: '🌊 三重・伊勢神宮 内宮（五十鈴川の清流）', data: iseProjectData },
];

