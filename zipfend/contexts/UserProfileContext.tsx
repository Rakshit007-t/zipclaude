import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { deleteField, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { deleteFitProfileApi } from '../services/ziprightApi';

export type UserBaseSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type UserFitPreference = 'slim' | 'regular' | 'relaxed' | 'loose';

export interface UserMeasurements {
  chest?: number;
  waist?: number;
  shoulders?: number;
  arms?: number;
  legs?: number;
  torso?: number;
  hips?: number;
  bust?: number;
  confidence?: number;
}

export interface UserProfile {
  username?: string;
  displayName?: string;
  photoURL?: string;
  location?: string;
  bio?: string;
  website?: string;
  onboardingCompleted?: boolean;
  fitProfileCompleted?: boolean;
  profileId?: string;
  profileName: string;
  gender: string;
  preferredBrand: string;
  usualSize?: UserBaseSize;
  height: number;
  weight: number;
  bodyShape?: string;
  shoulderType?: string;
  fitPreference?: UserFitPreference;
  smartFit: UserMeasurements;
  baseSize?: UserBaseSize;
  measurements: UserMeasurements;
  selectedProfileId?: string;
  selectedProfile?: string;
  recommendationPreferences?: Record<string, unknown>;
  fitProfiles?: Array<Record<string, unknown>>;
}

interface UserProfileContextType {
  profile: UserProfile;
  userProfile: UserProfile;
  isHydrated: boolean;
  setProfile: (profile: UserProfile | ((prev: UserProfile) => UserProfile)) => void;
  setUserProfile: (profile: UserProfile | ((prev: UserProfile) => UserProfile)) => void;
  updateProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>;
  refreshProfile: () => Promise<UserProfile>;
  updateHeight: (height: number) => void;
  updateWeight: (weight: number) => void;
  updateBodyShape: (bodyShape?: string) => void;
  updateBaseSize: (baseSize?: UserBaseSize) => void;
  updateFitPreference: (fitPreference?: UserFitPreference) => void;
  updateMeasurements: (measurements: UserMeasurements) => void;
  deleteFitProfile: (profileId: string) => Promise<void>;
  clearProfile: () => void;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

const LOCAL_PROFILE_PREFIX = 'zipright_fit_profile:';
const VALID_BASE_SIZES: UserBaseSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const VALID_FIT_PREFERENCES: UserFitPreference[] = ['slim', 'regular', 'relaxed', 'loose'];
const MEASUREMENT_KEYS: Array<keyof UserMeasurements> = [
  'chest',
  'waist',
  'shoulders',
  'arms',
  'legs',
  'torso',
  'hips',
  'bust',
  'confidence',
];

const defaultUserProfile: UserProfile = {
  profileName: '',
  gender: '',
  preferredBrand: '',
  height: 0,
  weight: 0,
  smartFit: {},
  measurements: {},
};

function clampPositive(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeBaseSize(value: unknown): UserBaseSize | undefined {
  const candidate = typeof value === 'string' ? value.toUpperCase() : '';
  return VALID_BASE_SIZES.includes(candidate as UserBaseSize)
    ? (candidate as UserBaseSize)
    : undefined;
}

function normalizeFitPreference(value: unknown): UserFitPreference | undefined {
  const candidate = typeof value === 'string' ? value.toLowerCase() : '';
  return VALID_FIT_PREFERENCES.includes(candidate as UserFitPreference)
    ? (candidate as UserFitPreference)
    : undefined;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function normalizeMeasurements(measurements: unknown): UserMeasurements {
  if (!measurements || typeof measurements !== 'object') {
    return {};
  }

  return MEASUREMENT_KEYS.reduce<UserMeasurements>((next, key) => {
    const value = (measurements as Record<string, unknown>)[key];
    const numericValue = clampPositive(value);
    if (numericValue > 0) {
      next[key] = numericValue;
    }
    return next;
  }, {});
}

function hasMeasurementData(measurements: unknown) {
  const normalized = normalizeMeasurements(measurements);
  return MEASUREMENT_KEYS.some((key) => Number(normalized[key] || 0) > 0);
}

function hasRawProfileData(payload: Record<string, unknown> | undefined) {
  if (!payload) {
    return false;
  }

  return Boolean(
    normalizeString(payload.displayName) ||
    normalizeString(payload.username) ||
    normalizeString(payload.photoURL ?? payload.photoUrl) ||
    normalizeString(payload.location) ||
    normalizeString(payload.bio) ||
    normalizeString(payload.website) ||
    normalizeString(payload.profileName ?? payload.name) ||
    normalizeString(payload.preferredBrand ?? payload.brand) ||
    normalizeBaseSize(payload.usualSize ?? payload.baseSize) ||
    normalizeFitPreference(payload.fitPreference) ||
    clampPositive(payload.height) > 0 ||
    clampPositive(payload.weight) > 0 ||
    normalizeString(payload.bodyShape) ||
    normalizeString(payload.shoulderType) ||
    hasMeasurementData(payload.smartFit) ||
    hasMeasurementData(payload.measurements),
  );
}

function hasProfileData(profile: UserProfile) {
  return hasRawProfileData(profile as unknown as Record<string, unknown>);
}

function normalizeProfileRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPlainRecord)
    .map((profile, index) => {
      const id = normalizeString(profile.id ?? profile.profileId) || `profile-${index + 1}`;
      return {
        ...profile,
        id,
        profileId: normalizeString(profile.profileId ?? profile.id) || id,
      };
    });
}

function normalizeUserProfileDoc(profile: unknown): UserProfile {
  if (!profile || typeof profile !== 'object') {
    return defaultUserProfile;
  }

  const payload = profile as Record<string, unknown>;
  const fitProfiles = normalizeProfileRecords(payload.fitProfiles);
  const selectedProfileId = normalizeString(
    payload.selectedProfileId ?? payload.selectedProfile ?? payload.primaryProfileId,
  );
  const activeProfile = fitProfiles.find(profileRecord => (
    normalizeString(profileRecord.id) === selectedProfileId ||
    normalizeString(profileRecord.profileId) === selectedProfileId
  )) ?? fitProfiles.find(profileRecord => profileRecord.isPrimary === true);
  const sourcePayload: Record<string, unknown> = hasRawProfileData(payload)
    ? payload
    : activeProfile ?? payload;
  const usualSize = normalizeBaseSize(sourcePayload.usualSize ?? sourcePayload.baseSize);
  const baseSize = normalizeBaseSize(sourcePayload.baseSize ?? sourcePayload.usualSize);
  const smartFit = normalizeMeasurements(sourcePayload.smartFit);
  const storedMeasurements = normalizeMeasurements(sourcePayload.measurements);
  const measurements = {
    ...storedMeasurements,
    ...smartFit,
  };

  return {
    profileId: normalizeString(sourcePayload.profileId ?? sourcePayload.id) || undefined,
    profileName: normalizeString(sourcePayload.profileName ?? sourcePayload.name),
    displayName: normalizeString(payload.displayName) || undefined,
    username: normalizeString(payload.username) || undefined,
    photoURL: payload.photoURL === null || payload.photoURL === ''
      ? ''
      : (normalizeString(payload.photoURL ?? payload.photoUrl) || undefined),
    location: normalizeString(payload.location ?? sourcePayload.location),
    bio: normalizeString(payload.bio ?? sourcePayload.bio),
    website: normalizeString(payload.website ?? sourcePayload.website),
    gender: normalizeString(sourcePayload.gender),
    preferredBrand: normalizeString(sourcePayload.preferredBrand ?? sourcePayload.brand),
    usualSize,
    height: clampPositive(sourcePayload.height),
    weight: clampPositive(sourcePayload.weight),
    bodyShape: normalizeString(sourcePayload.bodyShape) || undefined,
    shoulderType: normalizeString(sourcePayload.shoulderType) || undefined,
    fitPreference: normalizeFitPreference(sourcePayload.fitPreference),
    smartFit: measurements,
    baseSize: baseSize ?? usualSize,
    measurements,
    selectedProfileId: selectedProfileId || normalizeString(activeProfile?.id) || undefined,
    selectedProfile: normalizeString(payload.selectedProfile) || undefined,
    recommendationPreferences: normalizePlainRecord(
      sourcePayload.recommendationPreferences ?? payload.recommendationPreferences,
    ),
    fitProfiles,
  };
}

function mergeProfile(
  previousProfile: UserProfile,
  nextProfile: Partial<UserProfile>,
): UserProfile {
  const nextSmartFit = 'smartFit' in nextProfile
    ? normalizeMeasurements(nextProfile.smartFit)
    : {};
  const nextMeasurements = 'measurements' in nextProfile
    ? normalizeMeasurements(nextProfile.measurements)
    : {};
  const previousMeasurements = normalizeMeasurements({
    ...previousProfile.smartFit,
    ...previousProfile.measurements,
  });
  const mergedSmartFit = normalizeMeasurements({
    ...previousMeasurements,
    ...nextMeasurements,
    ...nextSmartFit,
  });

  const usualSize = normalizeBaseSize(
    nextProfile.usualSize ??
    nextProfile.baseSize ??
    previousProfile.usualSize ??
    previousProfile.baseSize,
  );
  const baseSize = normalizeBaseSize(
    nextProfile.baseSize ??
    nextProfile.usualSize ??
    previousProfile.baseSize ??
    previousProfile.usualSize,
  );
  const fitPreference = normalizeFitPreference(nextProfile.fitPreference ?? previousProfile.fitPreference);

  return {
    profileId: normalizeString(nextProfile.profileId ?? previousProfile.profileId) || undefined,
    profileName: normalizeString(nextProfile.profileName ?? previousProfile.profileName),
    displayName: normalizeString(nextProfile.displayName ?? previousProfile.displayName) || undefined,
    username: normalizeString(nextProfile.username ?? previousProfile.username) || undefined,
    photoURL: typeof nextProfile.photoURL !== 'undefined'
      ? (nextProfile.photoURL ? nextProfile.photoURL.trim() : '')
      : (previousProfile.photoURL ? previousProfile.photoURL.trim() : ''),
    location: typeof nextProfile.location !== 'undefined'
      ? normalizeString(nextProfile.location)
      : normalizeString(previousProfile.location),
    bio: typeof nextProfile.bio !== 'undefined'
      ? normalizeString(nextProfile.bio)
      : normalizeString(previousProfile.bio),
    website: typeof nextProfile.website !== 'undefined'
      ? normalizeString(nextProfile.website)
      : normalizeString(previousProfile.website),
    gender: normalizeString(nextProfile.gender ?? previousProfile.gender),
    preferredBrand: normalizeString(nextProfile.preferredBrand ?? previousProfile.preferredBrand),
    usualSize,
    height: clampPositive(nextProfile.height ?? previousProfile.height),
    weight: clampPositive(nextProfile.weight ?? previousProfile.weight),
    bodyShape: normalizeString(nextProfile.bodyShape ?? previousProfile.bodyShape) || undefined,
    shoulderType: normalizeString(nextProfile.shoulderType ?? previousProfile.shoulderType) || undefined,
    fitPreference,
    smartFit: mergedSmartFit,
    baseSize: baseSize ?? usualSize,
    measurements: mergedSmartFit,
    selectedProfileId: normalizeString(nextProfile.selectedProfileId ?? previousProfile.selectedProfileId) || undefined,
    selectedProfile: normalizeString(nextProfile.selectedProfile ?? previousProfile.selectedProfile) || undefined,
    recommendationPreferences: normalizePlainRecord(
      nextProfile.recommendationPreferences ?? previousProfile.recommendationPreferences,
    ),
    fitProfiles: Array.isArray(nextProfile.fitProfiles)
      ? normalizeProfileRecords(nextProfile.fitProfiles)
      : normalizeProfileRecords(previousProfile.fitProfiles),
  };
}

function getLocalProfileKey(ownerId?: string | null) {
  return ownerId ? `${LOCAL_PROFILE_PREFIX}${ownerId}` : null;
}

function readLocalProfile(ownerId?: string | null): UserProfile | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getLocalProfileKey(ownerId);
  if (!key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeUserProfileDoc(parsed);
    return hasProfileData(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function writeLocalProfile(ownerId: string | null | undefined, profile: UserProfile) {
  if (typeof window === 'undefined' || !ownerId || !hasProfileData(profile)) {
    return;
  }

  try {
    window.localStorage.setItem(getLocalProfileKey(ownerId) || '', JSON.stringify(profile));
  } catch {
    // Local persistence is best-effort. Firestore remains the cloud source.
  }
}

function getStorageOwnerId(user?: User | null) {
  return user?.uid || null;
}

function resolveCurrentOwnerId(ownerId?: string | null) {
  return ownerId || getStorageOwnerId(auth.currentUser);
}

function removeLocalProfile(ownerId?: string | null) {
  const key = getLocalProfileKey(ownerId);
  if (!key) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function getFitProfileId(profile: Record<string, unknown>) {
  const value = profile.profileId ?? profile.id;
  return typeof value === 'string' ? value.trim() : '';
}

function profileFieldsFromFitProfile(profile: Record<string, unknown>) {
  const profileId = getFitProfileId(profile);
  return {
    profileId,
    profileName: normalizeString(profile.profileName),
    gender: normalizeString(profile.gender),
    preferredBrand: normalizeString(profile.preferredBrand),
    usualSize: normalizeString(profile.usualSize),
    baseSize: normalizeBaseSize(profile.baseSize ?? profile.usualSize),
    height: clampPositive(profile.height),
    weight: clampPositive(profile.weight),
    bodyShape: normalizeString(profile.bodyShape),
    shoulderType: normalizeString(profile.shoulderType),
    fitPreference: normalizeFitPreference(profile.fitPreference),
    selectedProfileId: profileId,
    selectedProfile: profileId,
    recommendationPreferences: normalizePlainRecord(profile.recommendationPreferences),
    measurements: normalizeMeasurements(profile.measurements),
    smartFit: normalizeMeasurements(profile.smartFit),
  };
}

async function fetchUserProfile(user?: User | null) {
  const ownerId = getStorageOwnerId(user);
  const localProfile = readLocalProfile(ownerId);

  if (!user) {
    return localProfile ?? defaultUserProfile;
  }

  const snapshot = await getDoc(doc(db, 'users', user.uid));
  const remoteProfile = normalizeUserProfileDoc(snapshot.data());
  return hasProfileData(remoteProfile)
    ? (localProfile ? mergeProfile(localProfile, remoteProfile) : remoteProfile)
    : localProfile ?? defaultUserProfile;
}

export const UserProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const storageOwnerIdRef = useRef<string | null>(getStorageOwnerId(auth.currentUser));
  const [userProfileState, setUserProfileState] = useState<UserProfile>(() => (
    readLocalProfile(storageOwnerIdRef.current) ?? defaultUserProfile
  ));
  const [isHydrated, setIsHydrated] = useState(false);
  const userProfileRef = useRef(userProfileState);

  useEffect(() => {
    userProfileRef.current = userProfileState;
  }, [userProfileState]);

  const setProfile = useCallback((
    profileOrUpdater: UserProfile | ((prev: UserProfile) => UserProfile),
  ) => {
    setUserProfileState(prev => {
      const resolvedProfile = typeof profileOrUpdater === 'function' ? profileOrUpdater(prev) : profileOrUpdater;
      const nextProfile = mergeProfile(prev, resolvedProfile);
      storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
      writeLocalProfile(storageOwnerIdRef.current, nextProfile);
      return nextProfile;
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    storageOwnerIdRef.current = getStorageOwnerId(auth.currentUser);
    const nextProfile = await fetchUserProfile(auth.currentUser);
    setUserProfileState(nextProfile);
    writeLocalProfile(storageOwnerIdRef.current, nextProfile);
    setIsHydrated(true);
    return nextProfile;
  }, []);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    const nextProfile = mergeProfile(userProfileRef.current, updates);
    storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
    setUserProfileState(nextProfile);
    writeLocalProfile(storageOwnerIdRef.current, nextProfile);
    return nextProfile;
  }, []);

  const deleteFitProfile = useCallback(async (profileId: string) => {
    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      throw new Error('A fit profile is required for deletion.');
    }

    const user = auth.currentUser;
    const ownerId = resolveCurrentOwnerId(storageOwnerIdRef.current);
    const localProfiles = normalizeProfileRecords(userProfileRef.current.fitProfiles);
    let profiles = localProfiles;

    if (user && !user.isAnonymous) {
      const userRef = doc(db, 'users', user.uid);
      const snapshot = await getDoc(userRef);
      const remoteProfiles = normalizeProfileRecords(snapshot.data()?.fitProfiles);
      profiles = remoteProfiles.length ? remoteProfiles : localProfiles;
      const remainingProfiles = profiles.filter(profile => getFitProfileId(profile) !== normalizedProfileId);

      if (remainingProfiles.length === profiles.length) {
        throw new Error('This fit profile no longer exists. Refresh and try again.');
      }

      const nextProfile = remainingProfiles.find(profile => profile.isPrimary === true) || remainingProfiles[0];
      if (nextProfile) {
        await setDoc(userRef, {
          ...profileFieldsFromFitProfile(nextProfile),
          fitProfiles: remainingProfiles,
          fitProfileCompleted: true,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        await setDoc(userRef, {
          fitProfiles: [],
          fitProfileCompleted: false,
          profileId: deleteField(),
          profileName: deleteField(),
          gender: deleteField(),
          preferredBrand: deleteField(),
          usualSize: deleteField(),
          baseSize: deleteField(),
          height: deleteField(),
          weight: deleteField(),
          bodyShape: deleteField(),
          shoulderType: deleteField(),
          fitPreference: deleteField(),
          selectedProfileId: deleteField(),
          selectedProfile: deleteField(),
          recommendationPreferences: deleteField(),
          measurements: deleteField(),
          smartFit: deleteField(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      try {
        await deleteFitProfileApi(normalizedProfileId);
      } catch (e) {
        console.warn('[UserProfileContext] Backend delete sync notice:', e);
      }

      profiles = remainingProfiles;
    } else {
      profiles = profiles.filter(profile => getFitProfileId(profile) !== normalizedProfileId);
    }

    const nextProfile = profiles.find(profile => profile.isPrimary === true) || profiles[0];
    storageOwnerIdRef.current = ownerId;
    if (!nextProfile) {
      removeLocalProfile(ownerId);
      setUserProfileState(defaultUserProfile);
      return;
    }

    const nextLocalProfile = normalizeUserProfileDoc({
      ...profileFieldsFromFitProfile(nextProfile),
      fitProfiles: profiles,
    });
    setUserProfileState(nextLocalProfile);
    writeLocalProfile(ownerId, nextLocalProfile);
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      storageOwnerIdRef.current = getStorageOwnerId(user);
      const localProfile = readLocalProfile(storageOwnerIdRef.current);

      if (!user) {
        setUserProfileState(localProfile ?? defaultUserProfile);
        setIsHydrated(true);
        return;
      }

      if (localProfile) {
        setUserProfileState(localProfile);
      }

      unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        snapshot => {
          const remoteProfile = normalizeUserProfileDoc(snapshot.data());
          const ownerId = storageOwnerIdRef.current || user.uid;
          const localProfile = readLocalProfile(ownerId);
          const nextProfile = hasProfileData(remoteProfile)
            ? (localProfile ? mergeProfile(localProfile, remoteProfile) : remoteProfile)
            : (localProfile ?? defaultUserProfile);
          setUserProfileState(nextProfile);
          writeLocalProfile(ownerId, nextProfile);
          setIsHydrated(true);
        },
        () => {
          void refreshProfile();
        },
      );
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, [refreshProfile]);

  const contextValue = useMemo<UserProfileContextType>(() => ({
    profile: userProfileState,
    userProfile: userProfileState,
    isHydrated,
    setProfile,
    setUserProfile: setProfile,
    updateProfile,
    refreshProfile,
    updateHeight: (height: number) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { height });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    updateWeight: (weight: number) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { weight });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    updateBodyShape: (bodyShape?: string) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { bodyShape });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    updateBaseSize: (baseSize?: UserBaseSize) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { baseSize });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    updateFitPreference: (fitPreference?: UserFitPreference) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { fitPreference });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    updateMeasurements: (measurements: UserMeasurements) => {
      setUserProfileState(prev => {
        const nextProfile = mergeProfile(prev, { measurements });
        storageOwnerIdRef.current = resolveCurrentOwnerId(storageOwnerIdRef.current);
        writeLocalProfile(storageOwnerIdRef.current, nextProfile);
        return nextProfile;
      });
    },
    deleteFitProfile,
    clearProfile: () => {
      removeLocalProfile(storageOwnerIdRef.current);
      setUserProfileState(defaultUserProfile);
    },
  }), [deleteFitProfile, isHydrated, refreshProfile, setProfile, updateProfile, userProfileState]);

  return (
    <UserProfileContext.Provider value={contextValue}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useUserProfile = () => {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return context;
};
