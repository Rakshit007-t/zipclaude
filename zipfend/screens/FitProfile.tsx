import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile, type FitProfileDraft } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { recordJourneyEvent } from '../services/styleJourney';
import { saveFitProfile, type FitProfilePayload } from '../services/ziprightApi';
import { AppBar, Badge, Button, Chip, Eyebrow, Modal, SegmentedControl, Sheet, Spinner } from '../components/ui';

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
const genders = ['Male', 'Female', 'Other'];
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 300;
const MIN_WEIGHT_KG = 10;
const MAX_WEIGHT_KG = 500;


function createProfileId(userId: string) {
  const uniqueId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `profile-${userId}-${uniqueId}`;
}

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

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function inchesToCm(value?: number) {
  return value ? Number((value * 2.54).toFixed(2)) : undefined;
}

function cmToInchesString(value?: number) {
  return value ? Number((value / 2.54).toFixed(1)).toString() : '';
}

function cmToFeetAndInches(heightCm: number) {
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);

  if (inches === 12) {
    return { feet: feet + 1, inches: 0 };
  }

  return { feet, inches };
}

function feetAndInchesToCm(feetValue: string, inchesValue: string) {
  const feet = Number(feetValue);
  const inches = Number(inchesValue);
  const totalInches = feet * 12 + inches;
  return Number.isFinite(totalInches) && totalInches > 0 ? Number((totalInches * 2.54).toFixed(2)) : undefined;
}

function getValidHeightCm(fitData: FitData) {
  let heightCm: number | undefined;

  if (fitData.heightUnit === 'cm') {
    const parsedHeight = Number(fitData.heightCm);
    heightCm = Number.isFinite(parsedHeight) ? parsedHeight : undefined;
  } else {
    const feet = Number(fitData.heightFt);
    const inches = Number(fitData.heightIn);
    if (
      fitData.heightFt.trim() !== '' &&
      fitData.heightIn.trim() !== '' &&
      Number.isFinite(feet) && feet > 0 &&
      Number.isFinite(inches) && inches >= 0 && inches < 12
    ) {
      heightCm = Number(((feet * 12 + inches) * 2.54).toFixed(2));
    }
  }

  return heightCm && heightCm > MIN_HEIGHT_CM && heightCm <= MAX_HEIGHT_CM
    ? heightCm
    : undefined;
}

type RequiredProfileField = {
  id: 'profileName' | 'gender' | 'brand' | 'topSize' | 'height' | 'weight' | 'bodyShape';
  message: string;
  valid: boolean;
};

function getProfileValidation(profileName: string, fitData: FitData) {
  const normalizedName = profileName.trim();
  const heightCm = getValidHeightCm(fitData);
  const weightKg = Number(fitData.weight);
  const validBodyShapeIds = (fitData.gender === 'Female' ? femaleBodyShapes : maleBodyShapes)
    .map(shape => shape.id);
  const fields: RequiredProfileField[] = [
    {
      id: 'profileName',
      message: 'Please enter a profile name of 100 characters or fewer.',
      valid: normalizedName.length > 0 && normalizedName.length <= 100,
    },
    { id: 'gender', message: 'Please select a gender.', valid: genders.includes(fitData.gender) },
    { id: 'brand', message: 'Please select a preferred brand.', valid: Boolean(fitData.brand) },
    { id: 'topSize', message: 'Please select your usual size.', valid: sizes.includes(fitData.topSize) },
    { id: 'height', message: 'Please enter a valid height.', valid: typeof heightCm === 'number' },
    {
      id: 'weight',
      message: 'Please enter a valid weight.',
      valid: Number.isFinite(weightKg) && weightKg > MIN_WEIGHT_KG && weightKg <= MAX_WEIGHT_KG,
    },
    {
      id: 'bodyShape',
      message: 'Please select your body shape.',
      valid: validBodyShapeIds.includes(fitData.bodyShape),
    },
  ];

  return {
    fields,
    heightCm,
    weightKg,
    isComplete: fields.every(field => field.valid),
    firstInvalid: fields.find(field => !field.valid),
  };
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanMeasurements(measurements: Record<string, unknown>) {
  return Object.entries(measurements).reduce<Record<string, number>>((next, [key, value]) => {
    if (isFinitePositiveNumber(value)) {
      next[key] = value;
    }
    return next;
  }, {});
}

function hasSavedProfileData(profile: ReturnType<typeof useUserProfile>['userProfile']) {
  return Boolean(
    profile.profileName ||
    profile.preferredBrand ||
    profile.baseSize ||
    profile.usualSize ||
    profile.height > 0 ||
    profile.weight > 0 ||
    profile.bodyShape ||
    profile.fitPreference ||
    Object.keys(profile.measurements || {}).length > 0,
  );
}

function fitPreferenceToSlider(value?: string) {
  if (value === 'slim') return 1;
  if (value === 'relaxed' || value === 'loose') return 3;
  return 2;
}

function getProfileRecordId(profile: Record<string, unknown>) {
  return typeof profile.id === 'string'
    ? profile.id
    : typeof profile.profileId === 'string'
      ? profile.profileId
      : '';
}

function mergeProfileRecordLists(...profileGroups: unknown[][]) {
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];

  for (const group of profileGroups) {
    for (const profile of group) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        continue;
      }

      const record = profile as Record<string, unknown>;
      const id = getProfileRecordId(record);
      if (id && seen.has(id)) {
        continue;
      }

      if (id) {
        seen.add(id);
      }
      merged.push(record);
    }
  }

  return merged;
}

function isRecommendationRoute(route: unknown) {
  if (typeof route !== 'string') {
    return false;
  }

  try {
    return new URL(route, window.location.origin).pathname === '/recommendation';
  } catch {
    return route.split(/[?#]/)[0] === '/recommendation';
  }
}

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

/** Shared editorial field chrome for this form. */
const fieldCls =
  'w-full h-13 min-h-12 bg-surface-1 border border-line rounded-ctl px-4 text-ink text-[15px] font-medium placeholder:text-ink-faint focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]';

/** Section label: eyebrow + optional hint. */
const FieldLabel: React.FC<{ label: string; required?: boolean; optional?: boolean; hint?: string }> = ({ label, required, optional, hint }) => (
  <div className="mb-3">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
      {label}
      {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
      {optional && <span className="text-ink-faint normal-case tracking-normal font-normal ml-1.5">(optional)</span>}
    </p>
    {hint && <p className="text-[12.5px] text-ink-faint mt-1 normal-case tracking-normal">{hint}</p>}
  </div>
);

const FitProfile: React.FC = () => {
  const { goBack } = useAppNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const {
    userProfile,
    setUserProfile,
    updateProfile,
    isHydrated,
    deleteFitProfile,
  } = useUserProfile();

  const navigationState = (location.state as any) || {};
  const mode = navigationState.mode || 'add';
  const hasInitializedFromProfileRef = useRef(false);

  const [profileName, setProfileName] = useState('');
  const [fitData, setFitData] = useState<FitData>({ ...defaultFitData });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showBodyShapeGuide, setShowBodyShapeGuide] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const formBaselineRef = useRef<string | null>(null);
  const lastDraftSignatureRef = useRef<string | null>(null);

  const stateMemberId = typeof navigationState.memberId === 'string' ? navigationState.memberId : '';
  const activeProfileId = stateMemberId || userProfile.selectedProfileId || userProfile.profileId || '';
  const getFormSnapshot = (name: string, data: FitData) => JSON.stringify({ name, data });
  const getSavedForm = () => {
    const storedHeight = Number(userProfile.height || 0);
    const { feet, inches } = storedHeight > 0
      ? cmToFeetAndInches(storedHeight)
      : { feet: '', inches: '' };
    const measurements = userProfile.measurements || {};

    return {
      profileName: userProfile.profileName || '',
      fitData: {
        ...defaultFitData,
        gender: userProfile.gender || defaultFitData.gender,
        brand: userProfile.preferredBrand || '',
        topSize: userProfile.baseSize || userProfile.usualSize || defaultFitData.topSize,
        heightFt: feet ? String(feet) : '',
        heightIn: inches === '' ? '' : String(inches),
        heightCm: storedHeight > 0 ? String(storedHeight) : '',
        weight: userProfile.weight > 0 ? String(userProfile.weight) : '',
        waistSize: cmToInchesString(measurements.waist),
        bodyShape: userProfile.bodyShape || '',
        chestSize: cmToInchesString(measurements.chest),
        bustSize: cmToInchesString(measurements.bust ?? measurements.chest),
        hipsSize: cmToInchesString(measurements.hips),
        fitPreference: fitPreferenceToSlider(userProfile.fitPreference),
      },
    };
  };
  const draftMatchesCurrentForm = (draft?: FitProfileDraft) => Boolean(
    draft &&
    draft.mode === mode &&
    (mode !== 'edit' || draft.profileId === activeProfileId),
  );
  const initialiseForm = (
    nextProfileName: string,
    nextFitData: FitData,
    baseline = { profileName: nextProfileName, fitData: nextFitData },
  ) => {
    setProfileName(nextProfileName);
    setFitData(nextFitData);
    formBaselineRef.current = getFormSnapshot(baseline.profileName, baseline.fitData);
    hasInitializedFromProfileRef.current = true;
    setFormReady(true);
  };

  useEffect(() => {
    const loadProfile = async () => {
      if (mode !== 'edit' || draftMatchesCurrentForm(userProfile.fitProfileDraft)) {
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        return;
      }

      setLoading(true);
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const storedHeight = Number(data.height || 0);
          const { feet, inches } = storedHeight > 0
            ? cmToFeetAndInches(storedHeight)
            : { feet: '', inches: '' };
          const smartFit = data.smartFit || {};
          const normalizedFitPreference = data.fitPreference === 'slim'
            ? 1
            : data.fitPreference === 'relaxed' || data.fitPreference === 'loose'
              ? 3
              : 2;

          if (hasInitializedFromProfileRef.current) {
            return;
          }

          const savedFitData: FitData = {
            gender: data.gender || 'Male',
            brand: data.preferredBrand || '',
            topSize: data.usualSize || 'M',
            heightUnit: 'ft',
            heightFt: feet ? String(feet) : '',
            heightIn: inches === '' ? '' : String(inches),
            heightCm: storedHeight > 0 ? String(storedHeight) : '',
            weight: data.weight ? String(data.weight) : '',
            waistSize: cmToInchesString(smartFit.waist) || '',
            bodyShape: data.bodyShape || '',
            chestSize: cmToInchesString(smartFit.chest) || '',
            bustSize: cmToInchesString(smartFit.bust) || '',
            hipsSize: cmToInchesString(smartFit.hips) || '',
            braCup: '',
            fitPreference: normalizedFitPreference,
          };
          initialiseForm(data.profileName || '', savedFitData);
        }
      } catch (e) {
        console.error('Error loading profile:', e);
        showToast('Failed to load profile data.', 'error');
      } finally {
        setLoading(false);
      }
    };
    void loadProfile();
  }, [mode, showToast, userProfile.fitProfileDraft]);

  useEffect(() => {
    if (!isHydrated || hasInitializedFromProfileRef.current) {
      return;
    }

    const savedForm = getSavedForm();
    const draft = userProfile.fitProfileDraft;
    if (draftMatchesCurrentForm(draft)) {
      initialiseForm(draft.profileName, draft.fitData, savedForm);
      lastDraftSignatureRef.current = JSON.stringify(draft);
      return;
    }

    initialiseForm(savedForm.profileName, savedForm.fitData);
  }, [isHydrated, userProfile]);

  // Apply measurements from SmartFitScan
  useEffect(() => {
    const state = location.state as any;
    if (state?.smartFitCompleted && state?.measurements) {
      const scanHeight = userProfile.height > 0 ? cmToFeetAndInches(userProfile.height) : null;
      setFitData(prev => ({
        ...prev,
        ...(scanHeight ? {
          heightCm: String(userProfile.height),
          heightFt: String(scanHeight.feet),
          heightIn: String(scanHeight.inches),
        } : {}),
        waistSize: cmToInchesString(state.measurements.waist) || prev.waistSize,
        chestSize: prev.gender === 'Female' ? prev.chestSize : (cmToInchesString(state.measurements.chest) || prev.chestSize),
        bustSize: prev.gender === 'Female' ? (cmToInchesString(state.measurements.bust || state.measurements.chest) || prev.bustSize) : prev.bustSize,
        hipsSize: cmToInchesString(state.measurements.hips) || prev.hipsSize,
      }));

      // Clear state to prevent re-applying on refresh
      const newState = { ...state };
      delete newState.smartFitCompleted;
      delete newState.measurements;
      navigate('.', { replace: true, state: newState });
    }
  }, [location.state, navigate, userProfile.height]);

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

  const profileValidation = useMemo(
    () => getProfileValidation(profileName, fitData),
    [profileName, fitData],
  );
  const completeness = useMemo(() => {
    const completed = profileValidation.fields.filter(field => field.valid).length;
    return Math.round((completed / profileValidation.fields.length) * 100);
  }, [profileValidation]);

  const fitPreferenceLabel = fitData.fitPreference === 1 ? 'Slim' : fitData.fitPreference === 3 ? 'Relaxed' : 'Regular';

  const buildLabel = useMemo(() => {
    if (fitData.bodyShape) {
      const bs = fitData.bodyShape.toLowerCase();
      if (bs.includes('slim') || bs.includes('rectangle') || bs.includes('hourglass')) return 'Slim';
      if (bs.includes('athletic') || bs.includes('inverted-triangle')) return 'Athletic';
      if (bs.includes('broad') || bs.includes('apple') || bs.includes('oval')) return 'Broad';
      if (bs.includes('average') || bs.includes('pear')) return 'Average';
    }
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
  }, [fitData.bodyShape, fitData.heightFt, fitData.heightIn, fitData.heightCm, fitData.heightUnit, fitData.weight]);

  const heightDisplay = fitData.heightUnit === 'ft'
    ? (fitData.heightFt ? `${fitData.heightFt}'${fitData.heightIn || '0'}"` : `-'- "`)
    : (fitData.heightCm ? `${fitData.heightCm}cm` : '-');

  const isComplete = profileValidation.isComplete;
  const currentFormSnapshot = getFormSnapshot(profileName, fitData);
  const hasUnsavedChanges = Boolean(
    formReady &&
    currentFormSnapshot !== formBaselineRef.current,
  );

  useEffect(() => {
    if (!formReady) {
      return;
    }

    const nextDraft: FitProfileDraft | undefined = hasUnsavedChanges
      ? {
          mode,
          profileId: mode === 'edit' ? activeProfileId || undefined : undefined,
          profileName,
          fitData,
        }
      : undefined;
    const signature = JSON.stringify(nextDraft);
    if (lastDraftSignatureRef.current === signature) {
      return;
    }

    lastDraftSignatureRef.current = signature;
    setUserProfile(prev => ({ ...prev, fitProfileDraft: nextDraft }));
  }, [activeProfileId, fitData, formReady, hasUnsavedChanges, mode, profileName, setUserProfile]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleHeightUnitChange = (heightUnit: 'ft' | 'cm') => {
    setFitData(prev => ({ ...prev, heightUnit }));
  };

  const handleHeightCmChange = (value: string) => {
    setFitData(prev => ({ ...prev, heightCm: value }));
  };

  const handleHeightFtChange = (value: string) => {
    setFitData(prev => ({ ...prev, heightFt: value }));
  };

  const handleHeightInChange = (value: string) => {
    setFitData(prev => ({ ...prev, heightIn: value }));
  };

  const handleWeightChange = (value: string) => {
    setFitData(prev => ({ ...prev, weight: value }));
  };

  const handleMeasurementChange = (field: 'chest' | 'waist' | 'hips' | 'bust', value: string) => {
    const fitFieldMap: Record<typeof field, keyof FitData> = {
      chest: 'chestSize',
      waist: 'waistSize',
      hips: 'hipsSize',
      bust: 'bustSize',
    };

    setFitData(prev => ({
      ...prev,
      [fitFieldMap[field]]: value,
    }));

  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowLeaveConfirm(true);
      return;
    }
    goBack('/manage-profiles');
  };

  const handleStay = () => {
    setShowLeaveConfirm(false);
  };

  const handleStartSmartFitScan = () => {
    if (formReady && hasUnsavedChanges) {
      const nextDraft: FitProfileDraft = {
        mode,
        profileId: mode === 'edit' ? activeProfileId || undefined : undefined,
        profileName,
        fitData,
      };
      lastDraftSignatureRef.current = JSON.stringify(nextDraft);
      setUserProfile(prev => ({ ...prev, fitProfileDraft: nextDraft }));
    }
    navigate('/smart-fit-scan');
  };

  const handleLeave = () => {
    formBaselineRef.current = getFormSnapshot(profileName, fitData);
    lastDraftSignatureRef.current = JSON.stringify(undefined);
    setUserProfile(prev => ({ ...prev, fitProfileDraft: undefined }));
    setShowLeaveConfirm(false);
    goBack('/manage-profiles');
  };

  const handleSave = async () => {
    const validation = getProfileValidation(profileName, fitData);
    if (!validation.isComplete) {
      showToast(validation.firstInvalid?.message || 'Complete the required fields to save your profile.', 'error');
      return;
    }

    const user = auth.currentUser;
    const userId = user?.uid;
    if (!userId) { showToast('Please sign in first.', 'error'); navigate('/login'); return; }

    if (saving) {
      return;
    }

    setSaving(true);
    try {
      const height = validation.heightCm as number;
      const weight = validation.weightKg;
      const selectedBodyShape = fitData.bodyShape;
      const selectedFitPreference =
        fitData.fitPreference === 1
          ? 'slim'
          : fitData.fitPreference === 3
            ? 'relaxed'
            : 'regular';
      const selectedBaseSize = fitData.topSize as any;

      const localProfiles = Array.isArray(userProfile.fitProfiles) ? userProfile.fitProfiles : [];
      const existingProfiles = mergeProfileRecordLists([], localProfiles);
      const stateMemberId = typeof navigationState.memberId === 'string' ? navigationState.memberId : '';
      const fallbackPrimaryProfileId = userProfile.profileId || `primary-${userId}`;
      const activeProfileId = userProfile.selectedProfileId || fallbackPrimaryProfileId;
      const hasExistingSavedProfile = existingProfiles.length > 0 || hasSavedProfileData(userProfile);
      const profileId = mode === 'edit'
        ? (stateMemberId || activeProfileId)
        : hasExistingSavedProfile
          ? createProfileId(userId)
          : fallbackPrimaryProfileId;
      const existingSmartFit = userProfile.smartFit || {};
      const chest = inchesToCm(parsePositiveNumber(fitData.chestSize));
      const bust = inchesToCm(parsePositiveNumber(fitData.bustSize));
      const waist = inchesToCm(parsePositiveNumber(fitData.waistSize));
      const hips = inchesToCm(parsePositiveNumber(fitData.hipsSize));
      const nextSmartFit = cleanMeasurements({
        ...existingSmartFit,
        ...(chest ? { chest } : {}),
        ...(bust ? { bust, chest: bust } : {}),
        ...(waist ? { waist } : {}),
        ...(hips ? { hips } : {}),
      });
      const nextMeasurements = cleanMeasurements({
        ...userProfile.measurements,
        ...(chest ? { chest } : {}),
        ...(bust ? { bust } : {}),
        ...(waist ? { waist } : {}),
        ...(hips ? { hips } : {}),
      });
      const hasAnySmartFit = Object.keys(nextSmartFit).length > 0;
      const recommendationPreferences = {
        preferredBrand: fitData.brand,
        baseSize: selectedBaseSize,
        fitPreference: selectedFitPreference,
        bodyShape: selectedBodyShape,
      };
      const profileRecord = {
        id: profileId,
        profileId,
        profileName: profileName.trim(),
        gender: fitData.gender,
        preferredBrand: fitData.brand,
        usualSize: selectedBaseSize,
        baseSize: selectedBaseSize,
        height,
        weight,
        bodyShape: selectedBodyShape,
        shoulderType: userProfile.shoulderType,
        fitPreference: selectedFitPreference,
        measurements: nextMeasurements,
        ...(hasAnySmartFit ? { smartFit: nextSmartFit } : {}),
        recommendationPreferences,
        updatedAt: new Date().toISOString(),
      };
      const profileExists = existingProfiles.some(profile => getProfileRecordId(profile) === profileId);
      const fitProfiles = profileExists
        ? existingProfiles.map(profile => (
            getProfileRecordId(profile) === profileId
              ? { ...profile, ...profileRecord, isPrimary: profile.isPrimary ?? true }
              : profile
          ))
        : [
            ...existingProfiles,
            { ...profileRecord, isPrimary: existingProfiles.length === 0 },
          ];

      const profileData = {
        profileId,
        profileName: profileName.trim(),
        gender: fitData.gender,
        preferredBrand: fitData.brand,
        usualSize: selectedBaseSize,
        baseSize: selectedBaseSize,
        height,
        weight,
        bodyShape: selectedBodyShape,
        fitPreference: selectedFitPreference,
        selectedProfileId: profileId,
        selectedProfile: profileId,
        recommendationPreferences,
        measurements: nextMeasurements,
        ...(hasAnySmartFit ? { smartFit: nextSmartFit } : {}),
        fitProfiles,
      };

      const isRemoteSave = Boolean(user && !user.isAnonymous);
      if (isRemoteSave) {
        await saveFitProfile(profileData as FitProfilePayload);
      }

      await updateProfile({
        profileId,
        profileName: profileData.profileName,
        gender: profileData.gender,
        preferredBrand: profileData.preferredBrand,
        usualSize: selectedBaseSize,
        baseSize: selectedBaseSize,
        height,
        weight,
        bodyShape: selectedBodyShape,
        fitPreference: selectedFitPreference,
        selectedProfileId: profileId,
        selectedProfile: profileId,
        recommendationPreferences,
        fitProfiles,
        ...(hasAnySmartFit ? { smartFit: nextSmartFit } : {}),
        measurements: nextMeasurements,
        fitProfileDraft: undefined,
      });

      const savedProfileName = profileName.trim();
      setProfileName(savedProfileName);
      formBaselineRef.current = getFormSnapshot(savedProfileName, fitData);
      lastDraftSignatureRef.current = JSON.stringify(undefined);
      showToast(
        isRemoteSave
          ? (mode === 'edit' ? 'Profile updated!' : 'Profile saved!')
          : 'Profile saved on this device.',
        'success',
      );
      if (completeness >= 100) {
        recordJourneyEvent('profile_completed');
      }
      // Saving a profile completes onboarding. Redirect to Home Dashboard.
      navigate('/home', { replace: true });
    } catch (e) {
      console.error('[FitProfile] Save failed:', e);
      showToast(
        user && !user.isAnonymous
          ? 'Profile could not be saved remotely. Your unfinished profile is still on this device.'
          : 'Profile could not be saved on this device. Please try again.',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async () => {
    const stateMemberId = typeof navigationState.memberId === 'string' ? navigationState.memberId : '';
    const profileId = stateMemberId || userProfile.selectedProfileId || userProfile.profileId;
    if (!profileId) {
      showToast('This fit profile could not be identified. Refresh and try again.', 'error');
      setShowDeleteConfirm(false);
      return;
    }

    setDeleting(true);
    try {
      await deleteFitProfile(profileId);
      setShowDeleteConfirm(false);
      showToast('Fit profile permanently deleted.', 'success');
      navigate('/home', { replace: true });
    } catch (error) {
      console.error('[FitProfile] Delete failed:', error);
      showToast(error instanceof Error ? error.message : 'Failed to delete your fit profile. Please try again.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink items-center justify-center">
        <Spinner size={30} className="text-ink-faint" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink relative">
      <AppBar title={mode === 'edit' ? 'Edit profile' : 'New profile'} onBack={handleBack} />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-48">

        {/* Editorial opener + completion */}
        <div className="pt-6 pb-7">
          <Eyebrow className="mb-3">Fit profile</Eyebrow>
          <h1 className="display-1">
            Your <em className="font-medium">measure.</em>
          </h1>
          <div className="mt-6" role="status" aria-label={`Profile ${completeness}% complete`}>
            <div className="flex justify-between items-baseline mb-2">
              <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${completeness >= 100 ? 'text-success' : 'text-ink-soft'}`}>
                {completeness >= 100 ? 'Profile complete' : `${completeness}% complete`}
              </span>
              <span className="text-[11px] text-ink-faint">
                {completeness >= 100 ? 'Peak size accuracy' : 'Better data, better fit'}
              </span>
            </div>
            <div className="h-px bg-line relative" aria-hidden="true">
              <div
                className={`absolute -top-[1px] left-0 h-[3px] rounded-full transition-all duration-500 ${completeness >= 100 ? 'bg-success' : 'bg-brand'}`}
                style={{ width: `${completeness}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* 1. Profile Name */}
        <div className="mb-8">
          <FieldLabel label="Profile name" required />
          <input
            type="text"
            aria-label="Profile name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. Dad, Brother, My Fit"
            className={fieldCls}
          />
        </div>

        {/* 2. Smart Fit Scan Card */}
        <div className="mb-8 bg-ink text-ink-invert rounded-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-28 h-28 rounded-full blur-[46px] -mr-8 -mt-8" style={{ background: 'var(--brand)', opacity: 0.3 }} aria-hidden="true"></div>
          <div className="relative z-10">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-50 mb-2">Smart Fit Scan</p>
            <h3 className="font-display text-[19px] font-medium mb-1.5">Not sure of your size?</h3>
            <p className="text-[13px] opacity-70 mb-5 max-w-[85%] leading-relaxed">
              Scan yourself with AI and auto-fill your measurements.
            </p>
            <button
              onClick={handleStartSmartFitScan}
              className="border border-ink-invert/40 text-ink-invert font-semibold text-[11px] uppercase tracking-[0.12em] h-10 px-5 rounded-full inline-flex items-center gap-2 press"
            >
              Measure now
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* 3. Height */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <FieldLabel label="Height" required hint="Helps us estimate garment length and proportions." />
            <SegmentedControl
              aria-label="Height unit"
              className="shrink-0 w-[124px]"
              value={fitData.heightUnit}
              onChange={handleHeightUnitChange}
              options={[
                { value: 'ft', label: 'ft' },
                { value: 'cm', label: 'cm' },
              ]}
            />
          </div>
          {fitData.heightUnit === 'ft' ? (
            <div className="flex gap-3 mt-3">
              <div className="flex-1 relative">
                <input type="number" min="1" max="9" aria-label="Height, feet" value={fitData.heightFt} onChange={(e) => handleHeightFtChange(e.target.value)} placeholder="5" className={`${fieldCls} pr-12`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">ft</span>
              </div>
              <div className="flex-1 relative">
                <input type="number" min="0" max="11" aria-label="Height, inches" value={fitData.heightIn} onChange={(e) => handleHeightInChange(e.target.value)} placeholder="10" className={`${fieldCls} pr-12`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">in</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 relative">
              <input type="number" min="51" max="300" aria-label="Height in centimetres" value={fitData.heightCm} onChange={(e) => handleHeightCmChange(e.target.value)} placeholder="178" className={`${fieldCls} pr-12`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">cm</span>
            </div>
          )}
        </div>

        {/* 4. Weight */}
        <div className="mb-8">
          <FieldLabel label="Weight" required hint="Helps estimate body build." />
          <div className="relative">
            <input type="number" min="11" max="500" aria-label="Weight in kilograms" value={fitData.weight} onChange={(e) => handleWeightChange(e.target.value)} placeholder="70" className={`${fieldCls} pr-12`} />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">kg</span>
          </div>
        </div>

        {/* 5. Measurements */}
        <div className="mb-8 space-y-6">
          <Eyebrow className="!text-[10px]">Body Measurements</Eyebrow>
          <div>
            <FieldLabel label="Waist size" optional hint="Improves pant size accuracy." />
            <div className="relative">
              <input type="number" aria-label="Waist in inches" value={fitData.waistSize} onChange={(e) => handleMeasurementChange('waist', e.target.value)} placeholder="32" className={`${fieldCls} pr-12`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">in</span>
            </div>
          </div>
          <div>
            <FieldLabel label="Chest size" optional hint="Improves accuracy for shirts, jackets, and suits." />
            <div className="relative">
              <input type="number" aria-label="Chest size in inches" value={fitData.chestSize} onChange={(e) => handleMeasurementChange('chest', e.target.value)} placeholder="e.g., 38" className={`${fieldCls} pr-16`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">inches</span>
            </div>
          </div>

          {isFemale && (
            <div>
              <FieldLabel label="Hips" optional hint="Critical for dresses, lehengas, and ethnic wear accuracy." />
              <div className="relative">
                <input type="number" aria-label="Hips in inches" value={fitData.hipsSize} onChange={(e) => handleMeasurementChange('hips', e.target.value)} placeholder="38" className={`${fieldCls} pr-12`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">in</span>
              </div>
            </div>
          )}

          {isFemale && (
            <div>
              <FieldLabel label="Bust size" optional hint="Helps recommend better fitting tops and dresses." />
              <div className="relative">
                <input type="number" aria-label="Bust size in inches" value={fitData.bustSize} onChange={(e) => handleMeasurementChange('bust', e.target.value)} placeholder="e.g., 34" className={`${fieldCls} pr-16`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint text-[13px]">inches</span>
              </div>
            </div>
          )}

          {isFemale && (
            <div>
              <FieldLabel label="Bra cup" optional />
              <div className="flex gap-2.5">
                {braCups.map((cup) => (
                  <Chip
                    key={cup}
                    selected={fitData.braCup === cup}
                    className="min-w-[48px]"
                    onClick={() => setFitData({ ...fitData, braCup: fitData.braCup === cup ? '' : cup })}
                  >
                    {cup}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 6. Body Shape */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <FieldLabel label="Body shape" required hint="Body shape helps us adjust size recommendations for better fit." />
            <button onClick={() => setShowBodyShapeGuide(true)} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink underline underline-offset-4 whitespace-nowrap flex-shrink-0 mt-0.5">
              What's this?
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-1">
            {bodyShapes.map((shape) => {
              const isSelected = fitData.bodyShape === shape.id;
              const isSuggested = suggestedShape === shape.id;
              return (
                <button
                  key={shape.id}
                  onClick={() => {
                    setFitData({ ...fitData, bodyShape: shape.id });
                  }}
                  className={`relative p-4 pt-5 rounded-card border text-left transition-[transform,border-color,background-color] press-soft ${isSelected
                      ? 'bg-ink text-ink-invert border-ink'
                      : 'bg-surface-1 text-ink border-line hover:border-line-strong'
                    }`}
                >
                  {isSuggested && (
                    <span className="absolute -top-2.5 left-3">
                      <Badge variant={isSelected ? 'neutral' : 'brand'} size="sm">Suggested</Badge>
                    </span>
                  )}
                  <h4 className="text-[14px] font-semibold mb-1">{shape.label}</h4>
                  <p className={`text-[11.5px] leading-tight ${isSelected ? 'opacity-60' : 'text-ink-faint'}`}>{shape.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 7. Everything Else (Gender, Preferred Brand, Usual Size, Fit Preference) */}
        <div className="mb-8 space-y-8">
          <Eyebrow className="!text-[10px]">Style & Sizing References</Eyebrow>

          {/* Gender */}
          <div>
            <FieldLabel label="Gender" required hint="Used to apply gender-specific sizing rules." />
            <SegmentedControl
              aria-label="Gender"
              value={fitData.gender}
              onChange={(g) => {
                setFitData({ ...fitData, gender: g, bodyShape: '', bustSize: '', hipsSize: '', braCup: '' });
              }}
              options={[
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          </div>

          {/* Preferred Brand */}
          <div>
            <FieldLabel label="Preferred brand" required hint="We use this brand as your sizing reference to compare other brands." />
            <div className="relative">
              <button
                onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                aria-expanded={showBrandDropdown}
                className={`${fieldCls} h-12 flex items-center justify-between text-left`}
              >
                <span className={fitData.brand ? 'text-ink' : 'text-ink-faint'}>{fitData.brand || 'Select a brand'}</span>
                <span className={`material-symbols-outlined text-ink-faint text-[20px] transition-transform ${showBrandDropdown ? 'rotate-180' : ''}`} aria-hidden="true">expand_more</span>
              </button>
              {showBrandDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBrandDropdown(false)}></div>
                  <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-surface-1 border border-line rounded-card shadow-float max-h-60 overflow-y-auto no-scrollbar">
                    {brands.map((b) => (
                      <button
                        key={b}
                        onClick={() => { setFitData({ ...fitData, brand: b }); setShowBrandDropdown(false); }}
                        className={`w-full text-left px-5 py-3.5 text-[14px] border-b border-line last:border-none transition-colors ${fitData.brand === b ? 'text-ink font-semibold bg-surface-2' : 'text-ink-soft hover:bg-surface-2/60'}`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Usual T-Shirt Size */}
          <div>
            <FieldLabel label="Usual t-shirt size" required hint="Your most reliable size reference for tops and jackets." />
            <div className="flex flex-wrap gap-2.5">
              {sizes.map((s) => (
                <Chip
                  key={s}
                  selected={fitData.topSize === s}
                  className="min-w-[56px]"
                  onClick={() => {
                    setFitData({ ...fitData, topSize: s });
                  }}
                >
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        {/* --- Fit Preference --- */}
        <div className="mb-8">
          <FieldLabel label="Fit preference" hint="Determines how fitted or loose your clothing should feel." />

          {/* T-Shirt Visual */}
          <div className="bg-surface-1 rounded-card p-8 flex items-center justify-center relative border border-line">
            <span className="absolute top-4 right-4">
              <Badge variant="neutral">
                {fitData.fitPreference === 1 ? 'Fitted' : fitData.fitPreference === 3 ? 'Loose' : 'Standard'}
              </Badge>
            </span>
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path
                d={fitData.fitPreference === 1
                  ? "M35 25 L15 40 L25 50 L35 45 L35 100 L85 100 L85 45 L95 50 L105 40 L85 25 L72 32 L48 32 Z"
                  : fitData.fitPreference === 3
                    ? "M35 25 L10 43 L22 53 L30 48 L28 100 L92 100 L90 48 L98 53 L110 43 L85 25 L72 32 L48 32 Z"
                    : "M35 25 L12 42 L24 52 L33 46 L32 100 L88 100 L87 46 L96 52 L108 42 L85 25 L72 32 L48 32 Z"
                }
                fill="var(--surface-2)" stroke="var(--brand)" strokeWidth="1.5" strokeLinejoin="round"
                style={{ transition: 'd 0.3s ease' }}
              />
              <path d="M48 32 Q60 42 72 32" fill="none" stroke="var(--brand)" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Slim / Regular / Relaxed */}
          <SegmentedControl
            aria-label="Fit preference"
            className="mt-4"
            value={String(fitData.fitPreference)}
            onChange={(v) => {
              const value = Number(v);
              setFitData({ ...fitData, fitPreference: value });
            }}
            options={[
              { value: '1', label: 'Slim', icon: 'compress' },
              { value: '2', label: 'Regular', icon: 'straighten' },
              { value: '3', label: 'Relaxed', icon: 'expand' },
            ]}
          />
        </div>

        {/* --- Fit Summary Card --- */}
        <div className="mb-6 p-6 bg-surface-1 rounded-card border border-line">
          <Eyebrow className="mb-4">Your fit summary</Eyebrow>
          <div className="grid grid-cols-2 gap-y-5 gap-x-6">
            {[
              { label: 'Height', value: heightDisplay },
              { label: 'Build', value: buildLabel },
              { label: 'Usual size', value: fitData.topSize },
              { label: 'Fit', value: fitPreferenceLabel },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint mb-1">{item.label}</p>
                <p className="font-display text-[19px] font-medium text-ink">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {mode === 'edit' && (
          <div className="mb-10 border-t border-line pt-7">
            <Eyebrow className="mb-2 text-danger">Danger zone</Eyebrow>
            <p className="text-[13px] leading-relaxed text-ink-soft mb-4">
              Permanently remove this fit profile and its saved measurements. This cannot be undone.
            </p>
            <Button variant="outline" size="md" fullWidth icon="delete" onClick={() => setShowDeleteConfirm(true)}>
              Delete fit profile
            </Button>
          </div>
        )}

      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed bottom-0 inset-x-0 z-50 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent phone-fixed-bottom">
        <Button
          size="lg"
          fullWidth
          variant={isComplete ? 'primary' : 'outline'}
          loading={saving}
          disabled={!isComplete || saving}
          onClick={handleSave}
        >
          Save profile
        </Button>
        {!isComplete && (
          <p className="text-[11px] text-ink-faint text-center mt-3">Complete the required fields to save your profile.</p>
        )}
      </div>

      {/* ========== BODY SHAPE GUIDE ========== */}
      <Sheet open={showBodyShapeGuide} onClose={() => setShowBodyShapeGuide(false)} title="Body shape guide">
        {/* How to Determine */}
        <div className="bg-surface-2 rounded-card p-5 mb-6">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="material-symbols-outlined text-brand text-[19px]" aria-hidden="true">help</span>
            <h3 className="text-[14px] font-semibold text-ink">How to determine your shape</h3>
          </div>
          <p className="text-[13px] text-ink-soft mb-4 leading-relaxed">
            Stand in front of a mirror with light clothing to observe your silhouette.
          </p>
          <div className="flex flex-col gap-3">
            {[
              { num: '1', title: 'Shoulders vs. hips:', desc: 'Compare the width of your shoulders to your hips.' },
              { num: '2', title: 'Waist definition:', desc: 'Check if your waist is significantly narrower than your hips/bust.' },
              { num: '3', title: 'Midsection:', desc: 'Observe if you carry weight around your stomach.' },
            ].map((step) => (
              <div key={step.num} className="flex items-start gap-3">
                <span className="font-display italic text-[16px] text-ink-faint flex-shrink-0 leading-snug" aria-hidden="true">{step.num}.</span>
                <p className="text-[13px] text-ink-soft leading-relaxed">
                  <span className="font-semibold text-ink">{step.title}</span> {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Shape Cards */}
        <div className="flex flex-col gap-4 pb-2">
          {shapeGuideData.map((shape) => (
            <div key={shape.id} className="bg-surface-1 rounded-card overflow-hidden border border-line">
              {/* Shape Header */}
              <div className="flex items-center gap-4 p-5 pb-3">
                <div className="h-11 w-11 rounded-full border border-line flex items-center justify-center text-ink-soft flex-shrink-0">
                  {shape.icon}
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-ink">{shape.label}</h4>
                  <p className="text-[12px] text-ink-faint">{shape.desc}</p>
                </div>
              </div>

              {/* Key Features */}
              <div className="px-5 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint mb-2.5">Key features</p>
                <div className="flex flex-col gap-1.5">
                  {shape.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="h-1 w-1 rounded-full bg-brand mt-2 flex-shrink-0"></div>
                      <p className="text-[13px] text-ink-soft leading-relaxed">{f}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Styling Tip */}
              <div className="mx-5 mb-5 bg-brand-soft rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="material-symbols-outlined text-[14px] text-brand" aria-hidden="true">auto_awesome</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">Styling tip</span>
                </div>
                <p className="text-[12.5px] text-ink-soft leading-relaxed">{shape.tip}</p>
              </div>
            </div>
          ))}
        </div>
      </Sheet>

      <Modal
        open={showDeleteConfirm}
        onClose={() => !deleting && setShowDeleteConfirm(false)}
        title="Delete fit profile?"
        description="This permanently removes the profile and its measurements from your account. This action cannot be undone."
        actions={(
          <>
            <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" loading={deleting} onClick={handleDeleteProfile}>
              Delete
            </Button>
          </>
        )}
      />

      <Modal
        open={showLeaveConfirm}
        onClose={handleStay}
        title="Leave without saving?"
        description="Your changes haven't been saved."
        actions={(
          <>
            <Button variant="outline" className="flex-1" onClick={handleStay}>
              Stay
            </Button>
            <Button variant="danger" className="flex-1" onClick={handleLeave}>
              Leave
            </Button>
          </>
        )}
      />
    </div>
  );
};

export default FitProfile;
