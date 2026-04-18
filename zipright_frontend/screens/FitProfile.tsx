import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc, addDoc, updateDoc, collection } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';

interface FitData {
  gender: string;
  brand: string;
  topSize: string;
  heightUnit: 'ft' | 'cm';
  heightFt: string;
  heightIn: string;
  heightCm: string;
  weight: string;
  waistSize: string;
  bodyShape: string;
  chestSize: string;
  bustSize: string;
  hipsSize: string;
  braCup: string;
  fitPreference: number;
}

const defaultFitData: FitData = {
  gender: 'Male',
  brand: '',
  topSize: 'M',
  heightUnit: 'ft',
  heightFt: '',
  heightIn: '',
  heightCm: '',
  weight: '',
  waistSize: '',
  bodyShape: '',
  chestSize: '',
  bustSize: '',
  hipsSize: '',
  braCup: '',
  fitPreference: 2,
};

const brands = [
  'Nike', 'Adidas', 'H&M', 'Zara', 'Uniqlo', 'Levi\'s', 'Gap', 'Puma',
  'Under Armour', 'Ralph Lauren', 'Tommy Hilfiger', 'Calvin Klein',
  'Mango', 'Forever 21', 'ASOS', 'Allen Solly', 'Peter England',
  'Van Heusen', 'Louis Philippe', 'US Polo', 'Other'
];

const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const maleBodyShapes = [
  { id: 'average', label: 'Average', desc: 'Balanced proportions' },
  { id: 'inverted-triangle', label: 'Inverted Triangle', desc: 'Broad shoulders, narrow waist' },
  { id: 'rectangle', label: 'Rectangle', desc: 'Uniform width' },
  { id: 'oval', label: 'Oval', desc: 'Midsection prominence' },
];

const femaleBodyShapes = [
  { id: 'hourglass', label: 'Hourglass', desc: 'Curvy and balanced' },
  { id: 'pear', label: 'Pear', desc: 'Hips wider than bust' },
  { id: 'apple', label: 'Apple', desc: 'Fuller midsection' },
  { id: 'rectangle', label: 'Rectangle', desc: 'Straight silhouette' },
];

const braCups = ['A', 'B', 'C', 'D', 'DD', 'E'];

// Body shape guide data
const maleShapeGuide = [
  {
    id: 'average', label: 'Average', desc: 'Balanced proportions',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <rect x="8" y="2" width="12" height="24" rx="3" />
      </svg>
    ),
    features: ['Shoulders and hips are aligned', 'Waist is slightly smaller than chest', 'Common athletic build'],
    tip: 'Most styles fit well. Slim or regular cuts highlight your proportions.'
  },
  {
    id: 'inverted-triangle', label: 'Inverted Triangle', desc: 'Broad shoulders, narrow waist',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <path d="M3 4 L25 4 L18 26 L10 26 Z" />
      </svg>
    ),
    features: ['Shoulders significantly wider than hips', 'Developed chest and shoulders', 'Narrow waist and hips'],
    tip: 'Regular fit shirts and straight leg trousers balance the silhouette.'
  },
  {
    id: 'rectangle', label: 'Rectangle', desc: 'Uniform width',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <rect x="7" y="2" width="14" height="24" rx="2" />
      </svg>
    ),
    features: ['Shoulders, chest, and waist are similar width', 'Straight torso line', 'Few curves'],
    tip: 'Structured jackets and layered tops add dimension.'
  },
  {
    id: 'oval', label: 'Oval', desc: 'Midsection prominence',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <ellipse cx="14" cy="14" rx="10" ry="12" />
      </svg>
    ),
    features: ['Torso is wider than shoulders and hips', 'Softer, rounder appearance', 'Short neck appearance sometimes'],
    tip: 'Vertical stripes and dark colors have a slimming effect. Relaxed fits offer comfort.'
  },
];

const femaleShapeGuide = [
  {
    id: 'hourglass', label: 'Hourglass', desc: 'Curvy and balanced',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <path d="M6 2 L22 2 L16 14 L22 26 L6 26 L12 14 Z" />
      </svg>
    ),
    features: ['Bust and hips are roughly same width', 'Well-defined, narrow waist', 'Curvy silhouette'],
    tip: 'Fitted tops and high-waisted bottoms accentuate curves.'
  },
  {
    id: 'pear', label: 'Pear', desc: 'Hips wider than bust',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <path d="M10 2 L18 2 L18 10 L24 26 L4 26 L10 10 Z" />
      </svg>
    ),
    features: ['Hips are wider than shoulders/bust', 'Defined waist', 'Fuller hips and thighs'],
    tip: 'A-line skirts and boat-neck tops balance proportions.'
  },
  {
    id: 'apple', label: 'Apple', desc: 'Fuller midsection',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <ellipse cx="14" cy="12" rx="11" ry="10" />
        <rect x="9" y="20" width="10" height="6" rx="2" />
      </svg>
    ),
    features: ['Shoulders and bust are broader', 'Undefined waist', 'Fuller midsection'],
    tip: 'Empire waistlines and V-necks elongate the torso.'
  },
  {
    id: 'rectangle', label: 'Rectangle', desc: 'Straight silhouette',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <rect x="7" y="2" width="14" height="24" rx="2" />
      </svg>
    ),
    features: ['Shoulders, waist and hips align', 'Athletic look', 'Little to no waist definition'],
    tip: 'Structured jackets and layered tops add dimension.'
  },
];

const FitProfile: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const mode = (location.state as any)?.mode || 'add';
  const memberId = (location.state as any)?.memberId || null;

  const [profileName, setProfileName] = useState('');
  const [fitData, setFitData] = useState<FitData>({ ...defaultFitData });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showBodyShapeGuide, setShowBodyShapeGuide] = useState(false);

  // Load member data if editing
  useEffect(() => {
    const loadMember = async () => {
      if (mode === 'edit' && memberId) {
        setLoading(true);
        try {
          const memberDoc = await getDoc(doc(db, 'members', memberId));
          if (memberDoc.exists()) {
            const data = memberDoc.data();
            setProfileName(data.name || '');
            setIsPrimary(data.isPrimary || false);
            setFitData({
              gender: data.fitData?.gender || 'Male',
              brand: data.fitData?.brand || '',
              topSize: data.fitData?.topSize || 'M',
              heightUnit: data.fitData?.heightUnit || 'ft',
              heightFt: data.fitData?.heightFt || '',
              heightIn: data.fitData?.heightIn || '',
              heightCm: data.fitData?.heightCm || '',
              weight: data.fitData?.weight || '',
              waistSize: data.fitData?.waistSize || '',
              bodyShape: data.fitData?.bodyShape || '',
              chestSize: data.fitData?.chestSize || '',
              bustSize: data.fitData?.bustSize || '',
              hipsSize: data.fitData?.hipsSize || '',
              braCup: data.fitData?.braCup || '',
              fitPreference: data.fitData?.fitPreference ?? 2,
            });
          }
        } catch (e) {
          console.error('Error loading member:', e);
          showToast('Failed to load profile data.', 'error');
        }
        setLoading(false);
      }
    };
    loadMember();
  }, [mode, memberId]);

  const bodyShapes = fitData.gender === 'Female' ? femaleBodyShapes : maleBodyShapes;
  const shapeGuideData = fitData.gender === 'Female' ? femaleShapeGuide : maleShapeGuide;
  const isFemale = fitData.gender === 'Female';

  // Suggest body shape based on BMI
  const suggestedShape = useMemo(() => {
    const heightCm = fitData.heightUnit === 'ft'
      ? (parseInt(fitData.heightFt || '0') * 30.48) + (parseInt(fitData.heightIn || '0') * 2.54)
      : parseFloat(fitData.heightCm || '0');
    const weight = parseFloat(fitData.weight || '0');
    if (heightCm <= 0 || weight <= 0) return isFemale ? 'hourglass' : 'average';
    const bmi = weight / Math.pow(heightCm / 100, 2);
    if (isFemale) {
      if (bmi < 20) return 'rectangle';
      if (bmi < 25) return 'hourglass';
      if (bmi < 30) return 'pear';
      return 'apple';
    } else {
      if (bmi < 20) return 'rectangle';
      if (bmi < 25) return 'average';
      if (bmi < 30) return 'inverted-triangle';
      return 'oval';
    }
  }, [fitData.heightFt, fitData.heightIn, fitData.heightCm, fitData.heightUnit, fitData.weight, isFemale]);

  // Profile completion
  const completeness = useMemo(() => {
    let filled = 0;
    let total = 7;
    if (profileName.trim()) filled++;
    if (fitData.gender) filled++;
    if (fitData.brand) filled++;
    if (fitData.topSize) filled++;
    const hasHeight = fitData.heightUnit === 'ft' ? (fitData.heightFt && fitData.heightIn) : fitData.heightCm;
    if (hasHeight) filled++;
    if (fitData.weight) filled++;
    if (fitData.bodyShape) filled++;
    // Optional fields add to total
    if (fitData.waistSize) { filled++; total++; } else { total++; }
    if (fitData.chestSize || fitData.bustSize) { filled++; total++; } else { total++; }
    if (isFemale && fitData.hipsSize) { filled++; total++; } else if (isFemale) { total++; }
    return Math.round((filled / total) * 100);
  }, [profileName, fitData, isFemale]);

  const fitPreferenceLabel = fitData.fitPreference === 1 ? 'Slim' : fitData.fitPreference === 3 ? 'Relaxed' : 'Regular';

  const buildLabel = useMemo(() => {
    const heightCm = fitData.heightUnit === 'ft'
      ? (parseInt(fitData.heightFt || '0') * 30.48) + (parseInt(fitData.heightIn || '0') * 2.54)
      : parseFloat(fitData.heightCm || '0');
    const weight = parseFloat(fitData.weight || '0');
    if (heightCm <= 0 || weight <= 0) return '-';
    const bmi = weight / Math.pow(heightCm / 100, 2);
    if (bmi < 18.5) return 'Slim';
    if (bmi < 25) return 'Average';
    if (bmi < 30) return 'Athletic';
    return 'Broad';
  }, [fitData.heightFt, fitData.heightIn, fitData.heightCm, fitData.heightUnit, fitData.weight]);

  const heightDisplay = fitData.heightUnit === 'ft'
    ? (fitData.heightFt ? `${fitData.heightFt}'${fitData.heightIn || '0'}"` : `-'- "`)
    : (fitData.heightCm ? `${fitData.heightCm}cm` : '-');

  // Check if required fields are filled
  const isComplete = useMemo(() => {
    const hasHeight = fitData.heightUnit === 'ft' ? (fitData.heightFt && fitData.heightIn) : fitData.heightCm;
    return profileName.trim() && fitData.brand && fitData.topSize && hasHeight && fitData.weight && fitData.bodyShape;
  }, [profileName, fitData]);

  const handleSave = async () => {
    if (!profileName.trim()) { showToast('Please enter a profile name.', 'error'); return; }
    if (!fitData.brand) { showToast('Please select a preferred brand.', 'error'); return; }
    const hasHeight = fitData.heightUnit === 'ft' ? (fitData.heightFt && fitData.heightIn) : fitData.heightCm;
    if (!hasHeight) { showToast('Please enter your height.', 'error'); return; }
    if (!fitData.weight) { showToast('Please enter your weight.', 'error'); return; }
    if (!fitData.bodyShape) { showToast('Please select your body shape.', 'error'); return; }

    const user = auth.currentUser;
    if (!user) { showToast('Please sign in first.', 'error'); navigate('/login'); return; }

    setSaving(true);
    try {
      const memberData = {
        name: profileName.trim(),
        fitData: { ...fitData, bodyShape: fitData.bodyShape || suggestedShape },
        updatedAt: new Date(),
      };

      if (mode === 'edit' && memberId) {
        await updateDoc(doc(db, 'members', memberId), memberData);
        showToast('Profile updated!', 'success');
      } else {
        await addDoc(collection(db, 'members'), {
          ...memberData,
          uid: user.uid,
          isPrimary: false,
          createdAt: new Date(),
        });
        showToast('Profile created!', 'success');
      }
      navigate(-1);
    } catch (e) {
      console.error('Error saving fit profile:', e);
      showToast('Failed to save profile. Please try again.', 'error');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen bg-[#111111] text-white font-display items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#C9A06C]"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-display relative">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-5 py-4 bg-[#111111]/95 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[22px] text-white">arrow_back</span>
        </button>
        <h1 className="text-base font-bold">{mode === 'edit' ? 'Edit Profile' : 'New Profile'}</h1>
        <div className="w-10"></div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-44">

        {/* Profile Completion */}
        <div className="py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">Profile Completion: {completeness}%</p>
            <p className="text-[11px] text-white/30 mt-0.5">Takes 15 seconds</p>
          </div>
          <div className="w-28 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#C9A06C] rounded-full transition-all duration-500" style={{ width: `${completeness}%` }}></div>
          </div>
        </div>

        {/* --- Profile Name --- */}
        <div className="mb-7">
          <label className="text-[15px] font-bold text-white mb-1.5 block">
            Profile Name <span className="text-[#FF4D6D]">*</span>
          </label>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. Dad, Brother, My Fit"
            className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors"
          />
        </div>

        {/* --- Gender --- */}
        <div className="mb-7">
          <label className="text-[15px] font-bold text-white mb-1.5 block">Gender</label>
          <p className="text-[13px] text-white/40 mb-3">Used to apply gender-specific sizing rules.</p>
          <div className="flex rounded-2xl border border-white/10 overflow-hidden">
            {['Male', 'Female', 'Other'].map((g) => (
              <button
                key={g}
                onClick={() => setFitData({ ...fitData, gender: g, bodyShape: '', bustSize: '', hipsSize: '', braCup: '' })}
                className={`flex-1 py-3.5 text-sm font-bold transition-all ${
                  fitData.gender === g
                    ? 'bg-white text-[#111111]'
                    : 'bg-[#1A1A1A] text-white/40'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* --- Preferred Brand --- */}
        <div className="mb-7">
          <label className="text-[15px] font-bold text-white mb-1.5 block">
            Preferred Brand <span className="text-[#FF4D6D]">*</span>
          </label>
          <p className="text-[13px] text-white/40 mb-3">We use this brand as your sizing reference to compare other brands.</p>
          <div className="relative">
            <button
              onClick={() => setShowBrandDropdown(!showBrandDropdown)}
              className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 flex items-center justify-between font-medium focus:outline-none focus:border-[#C9A06C]/50 transition-colors"
            >
              <span className={fitData.brand ? 'text-white' : 'text-white/25'}>{fitData.brand || 'Select a brand'}</span>
              <span className={`material-symbols-outlined text-white/30 transition-transform ${showBrandDropdown ? 'rotate-180' : ''}`}>expand_more</span>
            </button>
            {showBrandDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBrandDropdown(false)}></div>
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-[#1E1E1E] border border-white/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto no-scrollbar">
                  {brands.map((b) => (
                    <button
                      key={b}
                      onClick={() => { setFitData({ ...fitData, brand: b }); setShowBrandDropdown(false); }}
                      className={`w-full text-left px-5 py-3.5 text-sm font-medium border-b border-white/5 last:border-none transition-colors ${
                        fitData.brand === b ? 'text-[#C9A06C] bg-[#C9A06C]/5' : 'text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* --- Usual T-Shirt Size --- */}
        <div className="mb-7">
          <label className="text-[15px] font-bold text-white mb-1.5 block">
            Usual T-Shirt Size <span className="text-[#FF4D6D]">*</span>
          </label>
          <p className="text-[13px] text-white/40 mb-3">Your most reliable size reference for tops and jackets.</p>
          <div className="flex flex-wrap gap-2.5">
            {sizes.map((s) => (
              <button
                key={s}
                onClick={() => setFitData({ ...fitData, topSize: s })}
                className={`h-12 min-w-[56px] px-5 rounded-2xl text-sm font-bold border transition-all ${
                  fitData.topSize === s
                    ? 'bg-white text-[#111111] border-white'
                    : 'bg-[#1A1A1A] text-white/50 border-white/10'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* --- Height --- */}
        <div className="mb-7">
          <div className="flex items-start justify-between mb-1.5">
            <div>
              <label className="text-[15px] font-bold text-white block">
                Height <span className="text-[#FF4D6D]">*</span>
              </label>
              <p className="text-[13px] text-white/40 mt-1">Helps us estimate garment length and proportions.</p>
            </div>
            <div className="flex rounded-xl border border-white/10 overflow-hidden flex-shrink-0 ml-4">
              <button
                onClick={() => setFitData({ ...fitData, heightUnit: 'ft' })}
                className={`px-4 py-2 text-xs font-bold transition-all ${
                  fitData.heightUnit === 'ft' ? 'bg-white text-[#111111]' : 'bg-[#1A1A1A] text-white/40'
                }`}
              >FT</button>
              <button
                onClick={() => setFitData({ ...fitData, heightUnit: 'cm' })}
                className={`px-4 py-2 text-xs font-bold transition-all ${
                  fitData.heightUnit === 'cm' ? 'bg-white text-[#111111]' : 'bg-[#1A1A1A] text-white/40'
                }`}
              >CM</button>
            </div>
          </div>
          {fitData.heightUnit === 'ft' ? (
            <div className="flex gap-3 mt-3">
              <div className="flex-1 relative">
                <input type="number" value={fitData.heightFt} onChange={(e) => setFitData({ ...fitData, heightFt: e.target.value })} placeholder="5"
                  className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">ft</span>
              </div>
              <div className="flex-1 relative">
                <input type="number" value={fitData.heightIn} onChange={(e) => setFitData({ ...fitData, heightIn: e.target.value })} placeholder="10"
                  className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">in</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 relative">
              <input type="number" value={fitData.heightCm} onChange={(e) => setFitData({ ...fitData, heightCm: e.target.value })} placeholder="178"
                className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">cm</span>
            </div>
          )}
        </div>

        {/* --- Weight & Waist --- */}
        <div className="flex gap-3 mb-7">
          <div className="flex-1">
            <label className="text-[15px] font-bold text-white mb-1.5 block">
              Weight <span className="text-[#FF4D6D]">*</span>
            </label>
            <p className="text-[13px] text-white/40 mb-3">Helps estimate body build.</p>
            <div className="relative">
              <input type="number" value={fitData.weight} onChange={(e) => setFitData({ ...fitData, weight: e.target.value })} placeholder="70"
                className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">kg</span>
            </div>
          </div>
          <div className="flex-1">
            <label className="text-[15px] font-bold text-white mb-1.5 block">
              Waist <span className="text-white/30 text-xs font-normal">(Optional)</span>
            </label>
            <p className="text-[13px] text-white/40 mb-3">Improves pant size accuracy.</p>
            <div className="relative">
              <input type="number" value={fitData.waistSize} onChange={(e) => setFitData({ ...fitData, waistSize: e.target.value })} placeholder="32"
                className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">in</span>
            </div>
          </div>
        </div>

        {/* --- Body Shape --- */}
        <div className="mb-7">
          <div className="flex items-start justify-between mb-1.5">
            <div>
              <label className="text-[15px] font-bold text-white block">
                Body Shape <span className="text-[#FF4D6D]">*</span>
              </label>
              <p className="text-[13px] text-white/40 mt-1">Body shape helps us adjust size recommendations for better fit.</p>
            </div>
            <button onClick={() => setShowBodyShapeGuide(true)} className="text-[13px] font-bold text-[#C9A06C] whitespace-nowrap ml-4 flex-shrink-0">
              What's this?
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            {bodyShapes.map((shape) => {
              const isSelected = fitData.bodyShape === shape.id;
              const isSuggested = suggestedShape === shape.id;
              return (
                <button
                  key={shape.id}
                  onClick={() => setFitData({ ...fitData, bodyShape: shape.id })}
                  className={`relative p-5 rounded-2xl border text-left transition-all active:scale-[0.97] ${
                    isSelected
                      ? 'bg-white text-[#111111] border-white'
                      : 'bg-[#1A1A1A] text-white border-white/10'
                  }`}
                >
                  {isSuggested && (
                    <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider z-10 ${
                      isSelected ? 'bg-[#111111] text-white' : 'bg-[#C9A06C] text-[#111111]'
                    }`}>Suggested</span>
                  )}
                  <h4 className={`text-[14px] font-bold mb-1 ${isSelected ? 'text-[#111111]' : 'text-white'}`}>{shape.label}</h4>
                  <p className={`text-[11px] leading-tight ${isSelected ? 'text-[#111111]/60' : 'text-white/40'}`}>{shape.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* --- Chest Size --- */}
        <div className="mb-7">
          <label className="text-[15px] font-bold text-white mb-1.5 block">
            Chest Size <span className="text-white/30 text-xs font-normal">(Optional)</span>
          </label>
          <p className="text-[13px] text-white/40 mb-3">Improves accuracy for shirts, jackets, and suits.</p>
          <div className="relative">
            <input type="number" value={fitData.chestSize} onChange={(e) => setFitData({ ...fitData, chestSize: e.target.value })} placeholder="e.g., 38"
              className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-16 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">inches</span>
          </div>
        </div>

        {/* --- Hips (Female only) --- */}
        {isFemale && (
          <div className="mb-7">
            <label className="text-[15px] font-bold text-white mb-1.5 block">
              Hips <span className="text-white/30 text-xs font-normal">(Optional)</span>
            </label>
            <p className="text-[13px] text-white/40 mb-3">Critical for dresses, lehengas, and ethnic wear accuracy.</p>
            <div className="relative">
              <input type="number" value={fitData.hipsSize} onChange={(e) => setFitData({ ...fitData, hipsSize: e.target.value })} placeholder="38"
                className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-12 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">in</span>
            </div>
          </div>
        )}

        {/* --- Bust Size (Female only) --- */}
        {isFemale && (
          <div className="mb-7">
            <label className="text-[15px] font-bold text-white mb-1.5 block">
              Bust Size <span className="text-white/30 text-xs font-normal">(Optional)</span>
            </label>
            <p className="text-[13px] text-white/40 mb-3">Helps recommend better fitting tops and dresses.</p>
            <div className="relative">
              <input type="number" value={fitData.bustSize} onChange={(e) => setFitData({ ...fitData, bustSize: e.target.value })} placeholder="e.g., 34"
                className="w-full h-14 bg-[#1A1A1A] border border-white/10 rounded-2xl px-5 pr-16 text-white font-medium placeholder:text-white/25 focus:outline-none focus:border-[#C9A06C]/50 transition-colors" />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 text-sm font-medium">inches</span>
            </div>
          </div>
        )}

        {/* --- Bra Cup (Female only) --- */}
        {isFemale && (
          <div className="mb-7">
            <label className="text-[15px] font-bold text-white mb-1.5 block">
              Bra Cup <span className="text-white/30 text-xs font-normal">(Optional)</span>
            </label>
            <div className="flex gap-2.5 mt-3">
              {braCups.map((cup) => (
                <button
                  key={cup}
                  onClick={() => setFitData({ ...fitData, braCup: fitData.braCup === cup ? '' : cup })}
                  className={`h-12 min-w-[48px] px-4 rounded-2xl text-sm font-bold border transition-all ${
                    fitData.braCup === cup
                      ? 'bg-white text-[#111111] border-white'
                      : 'bg-[#1A1A1A] text-white/50 border-white/10'
                  }`}
                >
                  {cup}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- Fit Preference --- */}
        <div className="mb-7">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[15px] font-bold text-white block">Fit Preference</label>
            <div className="h-6 w-6 rounded-full border border-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[14px] text-white/30">info</span>
            </div>
          </div>
          <p className="text-[13px] text-white/40 mb-4">Determines how fitted or loose your clothing should feel.</p>

          {/* T-Shirt Visual */}
          <div className="bg-[#1A1A1A] rounded-2xl p-8 flex items-center justify-center relative border border-white/5">
            <div className="absolute top-4 right-4 px-3 py-1 rounded-lg bg-[#2A7B5C]/20 border border-[#2A7B5C]/40">
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#4ADE80]">
                {fitData.fitPreference === 1 ? 'FITTED' : fitData.fitPreference === 3 ? 'LOOSE' : 'STANDARD'}
              </span>
            </div>
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d={fitData.fitPreference === 1
                  ? "M35 25 L15 40 L25 50 L35 45 L35 100 L85 100 L85 45 L95 50 L105 40 L85 25 L72 32 L48 32 Z"
                  : fitData.fitPreference === 3
                  ? "M35 25 L10 43 L22 53 L30 48 L28 100 L92 100 L90 48 L98 53 L110 43 L85 25 L72 32 L48 32 Z"
                  : "M35 25 L12 42 L24 52 L33 46 L32 100 L88 100 L87 46 L96 52 L108 42 L85 25 L72 32 L48 32 Z"
                }
                fill="#2A3A4A" stroke="#4A9EDB" strokeWidth="1.5" strokeLinejoin="round"
              />
              <path d="M48 32 Q60 42 72 32" fill="none" stroke="#4A9EDB" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Slim / Regular / Relaxed */}
          <div className="flex mt-4 bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden">
            {[
              { value: 1, label: 'Slim', icon: 'compress' },
              { value: 2, label: 'Regular', icon: 'straighten' },
              { value: 3, label: 'Relaxed', icon: 'expand' },
            ].map((pref) => (
              <button
                key={pref.value}
                onClick={() => setFitData({ ...fitData, fitPreference: pref.value })}
                className={`flex-1 flex flex-col items-center gap-1.5 py-4 transition-all ${
                  fitData.fitPreference === pref.value
                    ? 'bg-white text-[#111111]'
                    : 'text-white/30'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{pref.icon}</span>
                <span className="text-[10px] font-black uppercase tracking-[0.12em]">{pref.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* --- Fit Summary Card --- */}
        <div className="mb-6 p-6 bg-[#1A1A1A] rounded-2xl border border-white/10">
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50 mb-4">Your Fit Summary</h3>
          <div className="grid grid-cols-2 gap-y-4 gap-x-6">
            <div>
              <p className="text-[12px] text-white/40 mb-0.5">Height:</p>
              <p className="text-[14px] font-bold text-white">{heightDisplay}</p>
            </div>
            <div>
              <p className="text-[12px] text-white/40 mb-0.5">Build:</p>
              <p className="text-[14px] font-bold text-white">{buildLabel}</p>
            </div>
            <div>
              <p className="text-[12px] text-white/40 mb-0.5">Usual Size:</p>
              <p className="text-[14px] font-bold text-white">{fitData.topSize}</p>
            </div>
            <div>
              <p className="text-[12px] text-white/40 mb-0.5">Fit:</p>
              <p className="text-[14px] font-bold text-white">{fitPreferenceLabel}</p>
            </div>
          </div>
        </div>

      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-5 pb-8 pt-5 bg-gradient-to-t from-[#111111] via-[#111111] to-transparent">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full h-[58px] rounded-2xl font-bold text-[15px] shadow-xl active:scale-[0.97] transition-all flex items-center justify-center gap-2 ${
            isComplete
              ? 'bg-gradient-to-r from-[#B5853F] to-[#C9A06C] text-white shadow-[#B5853F]/20'
              : 'bg-[#1A1A1A] text-white/40 border border-white/10'
          } disabled:opacity-50`}
        >
          {saving ? (
            <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
          ) : (
            'Get My Size Recommendations'
          )}
        </button>
        {!isComplete && (
          <p className="text-[11px] text-white/30 text-center mt-3">Complete the required fields to save your profile.</p>
        )}
      </div>

      {/* ========== BODY SHAPE GUIDE MODAL ========== */}
      {showBodyShapeGuide && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowBodyShapeGuide(false)}></div>

          {/* Bottom Sheet */}
          <div className="relative z-10 w-full max-w-lg bg-[#1A1A1A] rounded-t-[2rem] max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-300">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-white/20 rounded-full"></div>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4">
              <h2 className="text-xl font-bold text-white">Body Shape Guide</h2>
              <button onClick={() => setShowBodyShapeGuide(false)} className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px] text-white/60">close</span>
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-10">
              {/* How to Determine */}
              <div className="bg-[#1E3A5F]/30 border border-[#3B82F6]/20 rounded-2xl p-5 mb-6">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="material-symbols-outlined text-[#3B82F6] text-xl">help</span>
                  <h3 className="text-[15px] font-bold text-white">How to Determine Your Shape</h3>
                </div>
                <p className="text-[13px] text-white/50 mb-4 leading-relaxed">
                  Stand in front of a mirror with light clothing to observe your silhouette.
                </p>
                <div className="flex flex-col gap-3">
                  {[
                    { num: '1', title: 'Shoulders vs. Hips:', desc: 'Compare the width of your shoulders to your hips.' },
                    { num: '2', title: 'Waist Definition:', desc: 'Check if your waist is significantly narrower than your hips/bust.' },
                    { num: '3', title: 'Midsection:', desc: 'Observe if you carry weight around your stomach.' },
                  ].map((step) => (
                    <div key={step.num} className="flex items-start gap-3">
                      <div className="h-6 w-6 rounded-full bg-[#3B82F6] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-white">{step.num}</span>
                      </div>
                      <p className="text-[13px] text-white/60 leading-relaxed">
                        <span className="font-bold text-white/80">{step.title}</span> {step.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shape Cards */}
              <div className="flex flex-col gap-5">
                {shapeGuideData.map((shape) => (
                  <div key={shape.id} className="bg-[#222222] rounded-2xl overflow-hidden border border-white/5">
                    {/* Shape Header */}
                    <div className="flex items-center gap-4 p-5 pb-3">
                      <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center text-white/60 flex-shrink-0">
                        {shape.icon}
                      </div>
                      <div>
                        <h4 className="text-[15px] font-bold text-white">{shape.label}</h4>
                        <p className="text-[12px] text-white/40">{shape.desc}</p>
                      </div>
                    </div>

                    {/* Key Features */}
                    <div className="px-5 pb-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-2.5">Key Features</p>
                      <div className="flex flex-col gap-1.5">
                        {shape.features.map((f, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#C9A06C] mt-1.5 flex-shrink-0"></div>
                            <p className="text-[13px] text-white/60 leading-relaxed">{f}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Styling Tip */}
                    <div className="mx-5 mb-5 bg-[#C9A06C]/10 border border-[#C9A06C]/15 rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="material-symbols-outlined text-[14px] text-[#C9A06C]">auto_awesome</span>
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[#C9A06C]">Styling Tip</span>
                      </div>
                      <p className="text-[12px] text-white/50 leading-relaxed">{shape.tip}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FitProfile;
