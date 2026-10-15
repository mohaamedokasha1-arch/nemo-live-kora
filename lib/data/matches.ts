// بنية البيانات الأساسية للمباريات
export interface Match {
  id: string;
  homeTeam: {
    name: string;
    logo: string;
    score?: number;
  };
  awayTeam: {
    name: string;
    logo: string;
    score?: number;
  };
  matchTime: string; // HH:mm
  matchDate: string; // YYYY-MM-DD
  status: 'scheduled' | 'live' | 'finished';
  league: {
    name: string;
    country: string;
    logo: string;
    type: 'domestic' | 'continental' | 'international';
  };
  channel: string[]; // قنوات البث
  venue?: string;
  referee?: string;
  matchweek?: number;
}

// بيانات المباريات الكاملة
export const matchesData: Match[] = [
  // ========== الدوري المصري الممتاز (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'egy-2026-10-15-001',
    homeTeam: {
      name: 'الأهلي',
      logo: 'https://cdn.example.com/teams/al-ahly.png',
    },
    awayTeam: {
      name: 'الإسماعيلي',
      logo: 'https://cdn.example.com/teams/ismaili.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 1', 'Koora Live'],
    venue: 'استاد الدفاع الجوي - القاهرة',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-15-002',
    homeTeam: {
      name: 'الزمالك',
      logo: 'https://cdn.example.com/teams/zamalek.png',
    },
    awayTeam: {
      name: 'طنطا',
      logo: 'https://cdn.example.com/teams/tanta.png',
    },
    matchTime: '21:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 2'],
    venue: 'استاد الدفاع الجوي - القاهرة',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-15-003',
    homeTeam: {
      name: 'بيراميدز',
      logo: 'https://cdn.example.com/teams/pyramids.png',
    },
    awayTeam: {
      name: 'حرس الحدود',
      logo: 'https://cdn.example.com/teams/border-guard.png',
    },
    matchTime: '17:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['Koora Live'],
    venue: 'استاد بيراميدز - الجيزة',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-15-004',
    homeTeam: {
      name: 'المنصورة',
      logo: 'https://cdn.example.com/teams/mansoura.png',
    },
    awayTeam: {
      name: 'النصر',
      logo: 'https://cdn.example.com/teams/al-nasr-egy.png',
    },
    matchTime: '18:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 3'],
    venue: 'استاد المنصورة',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-15-005',
    homeTeam: {
      name: 'الداخلية',
      logo: 'https://cdn.example.com/teams/dakhlya.png',
    },
    awayTeam: {
      name: 'لافيينا',
      logo: 'https://cdn.example.com/teams/laviena.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['Koora Live'],
    venue: 'استاد ستاد الداخلية',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-15-006',
    homeTeam: {
      name: 'المقاولون العرب',
      logo: 'https://cdn.example.com/teams/el-mokawloon.png',
    },
    awayTeam: {
      name: 'غزل المحلة',
      logo: 'https://cdn.example.com/teams/ghazl-moheila.png',
    },
    matchTime: '19:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 4'],
    venue: 'ستاد المقاولون العرب',
    matchweek: 5,
  },

  // ========== دوري القسم الثاني المصري (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'egy-2-2026-10-15-001',
    homeTeam: {
      name: 'عين شمس',
      logo: 'https://cdn.example.com/teams/ain-shams.png',
    },
    awayTeam: {
      name: 'المنيا',
      logo: 'https://cdn.example.com/teams/minya.png',
    },
    matchTime: '15:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'دوري القسم الثاني',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-div2.png',
      type: 'domestic',
    },
    channel: ['Koora Live'],
    matchweek: 5,
  },

  // ========== الدوري السعودي (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'sau-2026-10-15-001',
    homeTeam: {
      name: 'الفيصلي',
      logo: 'https://cdn.example.com/teams/al-faisaly.png',
    },
    awayTeam: {
      name: 'الخليج',
      logo: 'https://cdn.example.com/teams/al-khalij.png',
    },
    matchTime: '16:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري السعودي للمحترفين',
      country: 'السعودية',
      logo: 'https://cdn.example.com/leagues/saudi-pro.png',
      type: 'domestic',
    },
    channel: ['SSC Sports'],
    venue: 'ملعب الفيصلي - الرياض',
    matchweek: 6,
  },
  {
    id: 'sau-2026-10-15-002',
    homeTeam: {
      name: 'الحزم',
      logo: 'https://cdn.example.com/teams/al-hazm.png',
    },
    awayTeam: {
      name: 'الفتح',
      logo: 'https://cdn.example.com/teams/al-fath.png',
    },
    matchTime: '18:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري السعودي للمحترفين',
      country: 'السعودية',
      logo: 'https://cdn.example.com/leagues/saudi-pro.png',
      type: 'domestic',
    },
    channel: ['SSC Sports'],
    venue: 'ملعب الحزم - الرياض',
    matchweek: 6,
  },
  {
    id: 'sau-2026-10-15-003',
    homeTeam: {
      name: 'الاتحاد',
      logo: 'https://cdn.example.com/teams/al-ittihad.png',
    },
    awayTeam: {
      name: 'التعاون',
      logo: 'https://cdn.example.com/teams/al-taawon.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري السعودي للمحترفين',
      country: 'السعودية',
      logo: 'https://cdn.example.com/leagues/saudi-pro.png',
      type: 'domestic',
    },
    channel: ['SSC Sports'],
    venue: 'ملعب الاتحاد - جدة',
    matchweek: 6,
  },

  // ========== دوري أبطال أوروبا (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'ucl-2026-10-15-001',
    homeTeam: {
      name: 'ليفربول',
      logo: 'https://cdn.example.com/teams/liverpool.png',
    },
    awayTeam: {
      name: 'ميلان',
      logo: 'https://cdn.example.com/teams/ac-milan.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports', 'SSC Sports'],
    venue: 'أنفيلد - ليفربول',
    matchweek: 2,
  },
  {
    id: 'ucl-2026-10-15-002',
    homeTeam: {
      name: 'ريال مدريد',
      logo: 'https://cdn.example.com/teams/real-madrid.png',
    },
    awayTeam: {
      name: 'باير ليفركوزن',
      logo: 'https://cdn.example.com/teams/bayer-leverkusen.png',
    },
    matchTime: '21:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports'],
    venue: 'سانتياغو برنابيو - مدريد',
    matchweek: 2,
  },
  {
    id: 'ucl-2026-10-15-003',
    homeTeam: {
      name: 'يوفنتوس',
      logo: 'https://cdn.example.com/teams/juventus.png',
    },
    awayTeam: {
      name: 'ليون',
      logo: 'https://cdn.example.com/teams/lyon.png',
    },
    matchTime: '18:45',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports'],
    venue: 'ألليانز أرينا - تورينو',
    matchweek: 2,
  },

  // ========== الدوري الإنجليزي (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'epl-2026-10-15-001',
    homeTeam: {
      name: 'مانشستر سيتي',
      logo: 'https://cdn.example.com/teams/manchester-city.png',
    },
    awayTeam: {
      name: 'آرسنال',
      logo: 'https://cdn.example.com/teams/arsenal.png',
    },
    matchTime: '14:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الإنجليزي الممتاز',
      country: 'إنجلترا',
      logo: 'https://cdn.example.com/leagues/epl.png',
      type: 'domestic',
    },
    channel: ['beIN Sports', 'Sky Sports'],
    venue: 'الاتحاد - مانشستر',
    matchweek: 7,
  },
  {
    id: 'epl-2026-10-15-002',
    homeTeam: {
      name: 'تشيلسي',
      logo: 'https://cdn.example.com/teams/chelsea.png',
    },
    awayTeam: {
      name: 'إيفرتون',
      logo: 'https://cdn.example.com/teams/everton.png',
    },
    matchTime: '16:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الإنجليزي الممتاز',
      country: 'إنجلترا',
      logo: 'https://cdn.example.com/leagues/epl.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ستامفورد برديج - لندن',
    matchweek: 7,
  },

  // ========== الدوري الإسباني (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'laliga-2026-10-15-001',
    homeTeam: {
      name: 'برشلونة',
      logo: 'https://cdn.example.com/teams/barcelona.png',
    },
    awayTeam: {
      name: 'أتلتيكو مدريد',
      logo: 'https://cdn.example.com/teams/atletico-madrid.png',
    },
    matchTime: '21:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الإسباني',
      country: 'إسبانيا',
      logo: 'https://cdn.example.com/leagues/laliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'كامب نو - برشلونة',
    matchweek: 8,
  },
  {
    id: 'laliga-2026-10-15-002',
    homeTeam: {
      name: 'فالنسيا',
      logo: 'https://cdn.example.com/teams/valencia.png',
    },
    awayTeam: {
      name: 'ريال بيتيس',
      logo: 'https://cdn.example.com/teams/real-betis.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الإسباني',
      country: 'إسبانيا',
      logo: 'https://cdn.example.com/leagues/laliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ملعب خيسوس بورتون - فالنسيا',
    matchweek: 8,
  },

  // ========== الدوري الإيطالي (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'seriea-2026-10-15-001',
    homeTeam: {
      name: 'إنتر ميلان',
      logo: 'https://cdn.example.com/teams/inter-milan.png',
    },
    awayTeam: {
      name: 'روما',
      logo: 'https://cdn.example.com/teams/as-roma.png',
    },
    matchTime: '20:45',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الإيطالي',
      country: 'إيطاليا',
      logo: 'https://cdn.example.com/leagues/serie-a.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'سان سيرو - ميلان',
    matchweek: 7,
  },

  // ========== الدوري الألماني (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'bundesliga-2026-10-15-001',
    homeTeam: {
      name: 'بايرن ميونخ',
      logo: 'https://cdn.example.com/teams/bayern-munich.png',
    },
    awayTeam: {
      name: 'بروسيا دورتموند',
      logo: 'https://cdn.example.com/teams/borussia-dortmund.png',
    },
    matchTime: '17:30',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الألماني',
      country: 'ألمانيا',
      logo: 'https://cdn.example.com/leagues/bundesliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'أليانز أرينا - ميونخ',
    matchweek: 7,
  },

  // ========== الدوري الفرنسي (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'ligue1-2026-10-15-001',
    homeTeam: {
      name: 'باريس سان جيرمان',
      logo: 'https://cdn.example.com/teams/psg.png',
    },
    awayTeam: {
      name: 'أولمبيك مارسيليا',
      logo: 'https://cdn.example.com/teams/om.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'الدوري الفرنسي',
      country: 'فرنسا',
      logo: 'https://cdn.example.com/leagues/ligue1.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'بارك دو برانس - باريس',
    matchweek: 7,
  },

  // ========== دوري الدرجة الأولى الإماراتي (اليوم: 15 أكتوبر 2026) ==========
  {
    id: 'uae-2026-10-15-001',
    homeTeam: {
      name: 'الشارقة',
      logo: 'https://cdn.example.com/teams/sharjah.png',
    },
    awayTeam: {
      name: 'الوحدة',
      logo: 'https://cdn.example.com/teams/al-wehda.png',
    },
    matchTime: '18:00',
    matchDate: '2026-10-15',
    status: 'scheduled',
    league: {
      name: 'دوري الإمارات',
      country: 'الإمارات',
      logo: 'https://cdn.example.com/leagues/uae-pro.png',
      type: 'domestic',
    },
    channel: ['ADTV'],
    venue: 'ملعب الشارقة',
    matchweek: 5,
  },

  // ========================================
  // مباريات الجمعة (16 أكتوبر 2026) - غدًا
  // ========================================

  // ========== الدوري المصري الممتاز (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'egy-2026-10-16-001',
    homeTeam: {
      name: 'سموحة',
      logo: 'https://cdn.example.com/teams/smoha.png',
    },
    awayTeam: {
      name: 'المقاصة',
      logo: 'https://cdn.example.com/teams/el-mokassa.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 1'],
    venue: 'ملعب سموحة - الإسكندرية',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-16-002',
    homeTeam: {
      name: 'أسوان',
      logo: 'https://cdn.example.com/teams/aswan.png',
    },
    awayTeam: {
      name: 'الأهلي جدة',
      logo: 'https://cdn.example.com/teams/jeddah-ahly.png',
    },
    matchTime: '20:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 2'],
    venue: 'ملعب أسوان',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-16-003',
    homeTeam: {
      name: 'الإنتاج الحربي',
      logo: 'https://cdn.example.com/teams/production-war.png',
    },
    awayTeam: {
      name: 'نادي مصر',
      logo: 'https://cdn.example.com/teams/nadi-misr.png',
    },
    matchTime: '18:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['Koora Live'],
    venue: 'ملعب الإنتاج الحربي',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-16-004',
    homeTeam: {
      name: 'الجونة',
      logo: 'https://cdn.example.com/teams/al-gouna.png',
    },
    awayTeam: {
      name: 'بيراميدز',
      logo: 'https://cdn.example.com/teams/pyramids.png',
    },
    matchTime: '21:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 3'],
    venue: 'ملعب الجونة - الغردقة',
    matchweek: 5,
  },
  {
    id: 'egy-2026-10-16-005',
    homeTeam: {
      name: 'فيوتشر',
      logo: 'https://cdn.example.com/teams/future.png',
    },
    awayTeam: {
      name: 'الزمالك',
      logo: 'https://cdn.example.com/teams/zamalek.png',
    },
    matchTime: '19:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري المصري الممتاز',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-premier.png',
      type: 'domestic',
    },
    channel: ['ON Time Sports 4'],
    venue: 'ملعب نجيب ساويرس',
    matchweek: 5,
  },

  // ========== دوري القسم الثاني المصري (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'egy-2-2026-10-16-001',
    homeTeam: {
      name: 'شرقية',
      logo: 'https://cdn.example.com/teams/sharqeya.png',
    },
    awayTeam: {
      name: 'العريش',
      logo: 'https://cdn.example.com/teams/arish.png',
    },
    matchTime: '16:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري القسم الثاني',
      country: 'مصر',
      logo: 'https://cdn.example.com/leagues/egypt-div2.png',
      type: 'domestic',
    },
    channel: ['Koora Live'],
    matchweek: 5,
  },

  // ========== الدوري السعودي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'sau-2026-10-16-001',
    homeTeam: {
      name: 'الهلال',
      logo: 'https://cdn.example.com/teams/al-hilal.png',
    },
    awayTeam: {
      name: 'الشباب',
      logo: 'https://cdn.example.com/teams/al-shabab.png',
    },
    matchTime: '17:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري السعودي للمحترفين',
      country: 'السعودية',
      logo: 'https://cdn.example.com/leagues/saudi-pro.png',
      type: 'domestic',
    },
    channel: ['SSC Sports'],
    venue: 'ملعب الهلال - الرياض',
    matchweek: 6,
  },
  {
    id: 'sau-2026-10-16-002',
    homeTeam: {
      name: 'النصر',
      logo: 'https://cdn.example.com/teams/al-nasr-sau.png',
    },
    awayTeam: {
      name: 'الأهلي السعودي',
      logo: 'https://cdn.example.com/teams/al-ahly-saudi.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري السعودي للمحترفين',
      country: 'السعودية',
      logo: 'https://cdn.example.com/leagues/saudi-pro.png',
      type: 'domestic',
    },
    channel: ['SSC Sports'],
    venue: 'ملعب النصر - الرياض',
    matchweek: 6,
  },

  // ========== دوري أبطال أوروبا (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'ucl-2026-10-16-001',
    homeTeam: {
      name: 'مانشستر سيتي',
      logo: 'https://cdn.example.com/teams/manchester-city.png',
    },
    awayTeam: {
      name: 'اسطنبول باشاك شهير',
      logo: 'https://cdn.example.com/teams/besiktas.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports'],
    venue: 'الاتحاد - مانشستر',
    matchweek: 2,
  },
  {
    id: 'ucl-2026-10-16-002',
    homeTeam: {
      name: 'برشلونة',
      logo: 'https://cdn.example.com/teams/barcelona.png',
    },
    awayTeam: {
      name: 'بايرن ميونخ',
      logo: 'https://cdn.example.com/teams/bayern-munich.png',
    },
    matchTime: '21:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports'],
    venue: 'كامب نو - برشلونة',
    matchweek: 2,
  },
  {
    id: 'ucl-2026-10-16-003',
    homeTeam: {
      name: 'آرسنال',
      logo: 'https://cdn.example.com/teams/arsenal.png',
    },
    awayTeam: {
      name: 'إنتر ميلان',
      logo: 'https://cdn.example.com/teams/inter-milan.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري أبطال أوروبا',
      country: 'أوروبا',
      logo: 'https://cdn.example.com/leagues/ucl.png',
      type: 'continental',
    },
    channel: ['beIN Sports', 'SSC Sports'],
    venue: 'إمارات - لندن',
    matchweek: 2,
  },

  // ========== الدوري الإنجليزي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'epl-2026-10-16-001',
    homeTeam: {
      name: 'ليفربول',
      logo: 'https://cdn.example.com/teams/liverpool.png',
    },
    awayTeam: {
      name: 'توتنهام',
      logo: 'https://cdn.example.com/teams/tottenham.png',
    },
    matchTime: '12:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإنجليزي الممتاز',
      country: 'إنجلترا',
      logo: 'https://cdn.example.com/leagues/epl.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'أنفيلد - ليفربول',
    matchweek: 7,
  },
  {
    id: 'epl-2026-10-16-002',
    homeTeam: {
      name: 'مانشستر يونايتد',
      logo: 'https://cdn.example.com/teams/manchester-united.png',
    },
    awayTeam: {
      name: 'نيوكاسل يونايتد',
      logo: 'https://cdn.example.com/teams/newcastle.png',
    },
    matchTime: '15:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإنجليزي الممتاز',
      country: 'إنجلترا',
      logo: 'https://cdn.example.com/leagues/epl.png',
      type: 'domestic',
    },
    channel: ['beIN Sports', 'Sky Sports'],
    venue: 'أولد ترافورد - مانشستر',
    matchweek: 7,
  },

  // ========== الدوري الإسباني (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'laliga-2026-10-16-001',
    homeTeam: {
      name: 'ريال مدريد',
      logo: 'https://cdn.example.com/teams/real-madrid.png',
    },
    awayTeam: {
      name: 'سيفيليا',
      logo: 'https://cdn.example.com/teams/sevilla.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإسباني',
      country: 'إسبانيا',
      logo: 'https://cdn.example.com/leagues/laliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'سانتياغو برنابيو - مدريد',
    matchweek: 8,
  },
  {
    id: 'laliga-2026-10-16-002',
    homeTeam: {
      name: 'إسبانيول',
      logo: 'https://cdn.example.com/teams/espanyol.png',
    },
    awayTeam: {
      name: 'ملقا',
      logo: 'https://cdn.example.com/teams/malaga.png',
    },
    matchTime: '17:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإسباني',
      country: 'إسبانيا',
      logo: 'https://cdn.example.com/leagues/laliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ملعب ريكارت لويس - برشلونة',
    matchweek: 8,
  },

  // ========== الدوري الإيطالي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'seriea-2026-10-16-001',
    homeTeam: {
      name: 'نابولي',
      logo: 'https://cdn.example.com/teams/napoli.png',
    },
    awayTeam: {
      name: 'لاتسيو',
      logo: 'https://cdn.example.com/teams/lazio.png',
    },
    matchTime: '20:45',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإيطالي',
      country: 'إيطاليا',
      logo: 'https://cdn.example.com/leagues/serie-a.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'سان باولو - نابولي',
    matchweek: 7,
  },
  {
    id: 'seriea-2026-10-16-002',
    homeTeam: {
      name: 'فيورنتينا',
      logo: 'https://cdn.example.com/teams/fiorentina.png',
    },
    awayTeam: {
      name: 'بولونيا',
      logo: 'https://cdn.example.com/teams/bologna.png',
    },
    matchTime: '18:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الإيطالي',
      country: 'إيطاليا',
      logo: 'https://cdn.example.com/leagues/serie-a.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ستاديو أرتيميو فرانكي - فلورنسا',
    matchweek: 7,
  },

  // ========== الدوري الألماني (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'bundesliga-2026-10-16-001',
    homeTeam: {
      name: 'فيردر بريمن',
      logo: 'https://cdn.example.com/teams/werder-bremen.png',
    },
    awayTeam: {
      name: 'فرانكفورت',
      logo: 'https://cdn.example.com/teams/frankfurt.png',
    },
    matchTime: '18:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الألماني',
      country: 'ألمانيا',
      logo: 'https://cdn.example.com/leagues/bundesliga.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ويزر شتاديون - بريمن',
    matchweek: 7,
  },

  // ========== الدوري الفرنسي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'ligue1-2026-10-16-001',
    homeTeam: {
      name: 'موناكو',
      logo: 'https://cdn.example.com/teams/monaco.png',
    },
    awayTeam: {
      name: 'رين',
      logo: 'https://cdn.example.com/teams/rennes.png',
    },
    matchTime: '19:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الفرنسي',
      country: 'فرنسا',
      logo: 'https://cdn.example.com/leagues/ligue1.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'ملعب لويس الثاني - موناكو',
    matchweek: 7,
  },

  // ========== الدوري الهولندي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'eredivisie-2026-10-16-001',
    homeTeam: {
      name: 'أياكس أمستردام',
      logo: 'https://cdn.example.com/teams/ajax.png',
    },
    awayTeam: {
      name: 'فيتسه أرنهيم',
      logo: 'https://cdn.example.com/teams/vitesse.png',
    },
    matchTime: '20:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'الدوري الهولندي',
      country: 'هولندا',
      logo: 'https://cdn.example.com/leagues/eredivisie.png',
      type: 'domestic',
    },
    channel: ['beIN Sports'],
    venue: 'جوهان كرويف أرينا - أمستردام',
    matchweek: 7,
  },

  // ========== دوري الدرجة الأولى الإماراتي (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'uae-2026-10-16-001',
    homeTeam: {
      name: 'آل عين',
      logo: 'https://cdn.example.com/teams/al-ain.png',
    },
    awayTeam: {
      name: 'الجزيرة',
      logo: 'https://cdn.example.com/teams/al-jazira.png',
    },
    matchTime: '19:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري الإمارات',
      country: 'الإمارات',
      logo: 'https://cdn.example.com/leagues/uae-pro.png',
      type: 'domestic',
    },
    channel: ['ADTV'],
    venue: 'محيص بن ظاهر - العين',
    matchweek: 5,
  },
  {
    id: 'uae-2026-10-16-002',
    homeTeam: {
      name: 'الاتحاد',
      logo: 'https://cdn.example.com/teams/al-ittihad-uae.png',
    },
    awayTeam: {
      name: 'الرقة',
      logo: 'https://cdn.example.com/teams/al-raqa.png',
    },
    matchTime: '21:00',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري الإمارات',
      country: 'الإمارات',
      logo: 'https://cdn.example.com/leagues/uae-pro.png',
      type: 'domestic',
    },
    channel: ['ADTV'],
    venue: 'ملعب محمد بن زايد - أبو ظبي',
    matchweek: 5,
  },

  // ========== دوري الدرجة الأولى القطري (غدًا: 16 أكتوبر 2026) ==========
  {
    id: 'qatar-2026-10-16-001',
    homeTeam: {
      name: 'السد',
      logo: 'https://cdn.example.com/teams/al-sadd.png',
    },
    awayTeam: {
      name: 'الريان',
      logo: 'https://cdn.example.com/teams/al-rayyan.png',
    },
    matchTime: '18:30',
    matchDate: '2026-10-16',
    status: 'scheduled',
    league: {
      name: 'دوري نجوم QNB',
      country: 'قطر',
      logo: 'https://cdn.example.com/leagues/qatar-stars.png',
      type: 'domestic',
    },
    channel: ['Bein Sports'],
    venue: 'ملعب جاسم بن محمد - الدوحة',
    matchweek: 4,
  },
];
