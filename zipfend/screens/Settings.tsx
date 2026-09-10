import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { updateProfile as updateAuthProfile } from 'firebase/auth';
import { PLANS, getUserRole, setUserRole, getSellerStatus, setSellerStatus, getUserPlan } from '../utils/subscription';
import { compressImage, uploadOrEncodeProfilePhoto } from '../utils/media';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { deleteAccountPermanently, reauthenticateEmail, reauthenticateGoogle } from '../services/accountService';
import {
  getAccessStatus,
  getSellerMe,
  onboardSeller,
  getSellerProfile,
  updateSellerProfile,
  uploadSellerLogo,
  adminListSellers,
  adminSetSellerStatus,
  SellerProfile
} from '../services/ziprightApi';
import { defaultUsername } from '../services/social';
import {
  cn,
  motion,
  AppBar,
  Button,
  Input,
  TextArea,
  ListRow,
  Eyebrow,
  Divider,
  Modal,
  Sheet,
  EmptyState,
  SegmentedControl,
} from '../components/ui';
import { openCookiePreferences } from '../services/cookieConsent';

// Addresses persist locally per account (no backend orders API yet)
function addressStoreKey() {
  const owner = auth.currentUser?.uid;
  return owner ? `zipright_addresses:${owner}` : null;
}

function readStoredAddresses(): Address[] {
  try {
    const key = addressStoreKey();
    const raw = key ? localStorage.getItem(key) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeStoredAddresses(list: Address[]) {
  try {
    const key = addressStoreKey();
    if (key) localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

function fitPreferenceToSlider(value?: string) {
  if (value === 'slim') return 1;
  if (value === 'relaxed' || value === 'loose') return 3;
  return 2;
}

interface FitData {
  brand: string;
  topSize: string;
  waistSize: string;
  heightUnit: 'ft' | 'cm';
  heightFt: string;
  heightIn: string;
  heightCm: string;
  weight: string;
  fitPreference: number;
}

interface Member {
  id: string;
  name: string;
  isPrimary: boolean;
  fitData: FitData;
}

interface Address {
  id: string;
  type: 'Home' | 'Work' | 'Friends' | 'Other';
  name: string;
  phone: string;
  houseNo: string;
  area: string;
  landmark: string;
  city: string;
  state: string;
  zip: string;
  isDefault: boolean;
  coords?: { lat: number; lng: number };
}

type ViewState = 'main' | 'manage-fits' | 'addresses' | 'edit-address' | 'permissions' | 'edit-profile' | 'seller-apply' | 'seller-profile' | 'admin-approvals' | 'app-settings';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

/** Editorial hairline toggle — settings switches. */
const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onClick}
    className={cn(
      'w-11 h-[26px] rounded-full flex items-center px-0.5 shrink-0 transition-colors duration-200',
      on ? 'bg-brand' : 'bg-surface-3 border border-line',
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        'w-[19px] h-[19px] rounded-full bg-surface-0 shadow-sm transition-transform duration-200',
        on ? 'translate-x-[19px]' : 'translate-x-0',
      )}
    />
  </button>
);

/** Grouped hairline menu container. */
const MenuGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('rounded-card border border-line bg-surface-1 px-4 divide-y divide-line overflow-hidden', className)}>
    {children}
  </div>
);

const Settings: React.FC = () => {
  const { goBack } = useAppNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { userProfile, setUserProfile, isHydrated, refreshProfile, clearProfile, deleteFitProfile } = useUserProfile();

  const [settingsSearch, setSettingsSearch] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [showFinalDeleteConfirm, setShowFinalDeleteConfirm] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthError, setReauthError] = useState('');
  const [reauthenticating, setReauthenticating] = useState(false);
  const [reauthenticated, setReauthenticated] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Deep link: other screens can open a specific view via navigate('/settings', { state: { view } })
  const [view, setView] = useState<ViewState>((location.state as { view?: ViewState } | null)?.view || 'main');
  const [addressStep, setAddressStep] = useState<'map' | 'form'>('map');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  // Seller State
  const [userRole, setUserRoleState] = useState(getUserRole());
  const [isServerAdmin, setIsServerAdmin] = useState(false);
  const [sellerStatus, setSellerStatusState] = useState(getSellerStatus());
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [pendingSellers, setPendingSellers] = useState<SellerProfile[]>([]);
  const [adminReason, setAdminReason] = useState('');
  const [adminActionTarget, setAdminActionTarget] = useState<SellerProfile | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const [sellerFormData, setSellerFormData] = useState({
      brandName: '',
      contactName: '',
      email: '',
      phone: '',
      storeLink: '',
      taxId: '',
      brandDescription: ''
  });

  // Permissions State synced with localStorage
  const [permissionsState, setPermissionsState] = useState({
      camera: localStorage.getItem('zipright_camera') === 'granted',
      location: localStorage.getItem('zipright_location') === 'granted',
      contacts: localStorage.getItem('zipright_contacts') === 'granted',
      microphone: localStorage.getItem('zipright_microphone') === 'granted',
      notifications: localStorage.getItem('zipright_notifications') === 'granted',
      photos: true,
      nearby: false
  });
  const { showToast } = useToast();

  const [profileImage, setProfileImage] = useState(
    userProfile.photoURL ||
    auth.currentUser?.photoURL ||
    ((auth.currentUser as typeof auth.currentUser & { photoUrl?: string })?.photoUrl ?? '') ||
    ''
  );

  useEffect(() => {
    if (typeof userProfile.photoURL !== 'undefined') {
      setProfileImage(userProfile.photoURL || '');
    }
  }, [userProfile.photoURL]);

  const [userData, setUserData] = useState({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      gender: 'Male',
      dob: '',
      planId: 'free',
      zipPoints: 0
  });

  const effectivePhoto = typeof userProfile.photoURL !== 'undefined'
    ? (userProfile.photoURL || '')
    : (profileImage || auth.currentUser?.photoURL || '');
  const effectiveDisplayName = userProfile.displayName || userProfile.profileName || (userData.firstName ? `${userData.firstName} ${userData.lastName}`.trim() : '') || auth.currentUser?.displayName || 'ZipRIGHT Member';
  const initialLetter = (effectiveDisplayName || 'Z').charAt(0).toUpperCase();

  // Edit Profile Temp State
  const [editUserData, setEditUserData] = useState(userData);
  const [loading, setLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(document.documentElement.classList.contains('dark'));
  const [showDeleteAddressConfirm, setShowDeleteAddressConfirm] = useState<string | null>(null);
  const [showDeleteMemberConfirm, setShowDeleteMemberConfirm] = useState<string | null>(null);
  const [showCancelApplyConfirm, setShowCancelApplyConfirm] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [showRedeemInput, setShowRedeemInput] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [userPlan, setUserPlan] = useState(getUserPlan());

  const buildMembersFromProfile = (profile: typeof userProfile): Member[] => {
    const profileRecords = Array.isArray(profile.fitProfiles) ? profile.fitProfiles : [];
    const records = profileRecords.length
      ? profileRecords
      : profile.profileName
        ? [profile as unknown as Record<string, unknown>]
        : [];

    return records.map((record, index) => {
      const profileId = String(record.profileId || record.id || profile.profileId || profile.selectedProfileId || `profile-${index + 1}`);
      const name = String(record.profileName || record.name || profile.profileName || `Fit Profile ${index + 1}`);
      return {
        id: profileId,
        name,
        isPrimary: record.isPrimary === true || profileId === profile.selectedProfileId || index === 0,
        fitData: {
          brand: String(record.preferredBrand || record.brand || profile.preferredBrand || ''),
          topSize: String(record.usualSize || record.baseSize || profile.usualSize || profile.baseSize || ''),
          waistSize: '',
          heightUnit: 'cm',
          heightFt: '',
          heightIn: '',
          heightCm: record.height ? String(record.height) : profile.height ? String(profile.height) : '',
          weight: record.weight ? String(record.weight) : profile.weight ? String(profile.weight) : '',
          fitPreference: fitPreferenceToSlider(String(record.fitPreference || profile.fitPreference || 'regular')),
        },
      };
    });
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setMembers([]);
    }
  }, []);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    showToast("Something went wrong. Please try again.", "error");
  };

  // Re-read storage and Firestore on mount and view change
  useEffect(() => {
    const init = async () => {
        const user = auth.currentUser;

        if (!user) {
            navigate('/login');
            return;
        }

        setLoading(true);

        // Sync Permissions
        const nextPerms = {
            camera: localStorage.getItem('zipright_camera') === 'granted',
            location: localStorage.getItem('zipright_location') === 'granted',
            contacts: localStorage.getItem('zipright_contacts') === 'granted',
            microphone: localStorage.getItem('zipright_microphone') === 'granted',
            notifications: localStorage.getItem('zipright_notifications') === 'granted',
            photos: true,
            nearby: false
        };
        setPermissionsState(nextPerms);

        if (user && !user.isAnonymous) {
            try {
                // Server-authoritative role synchronization
                try {
                    const access = await getAccessStatus();
                    setIsServerAdmin(Boolean(access.is_admin));
                    if (access.is_admin) {
                        setUserRole('admin');
                        setUserRoleState('admin');
                    } else if (access.is_seller) {
                        setUserRole('seller');
                        setUserRoleState('seller');
                    } else {
                        setUserRole('user');
                        setUserRoleState('user');
                    }
                } catch {
                    // Fail-closed to unprivileged user role on error
                    setIsServerAdmin(false);
                    setUserRole('user');
                    setUserRoleState('user');
                }

                // Sync Seller state
                try {
                    const sellerMeRes = await getSellerMe();
                    const status = sellerMeRes.status || 'none';
                    setSellerStatusState(status);
                    setSellerStatus(status);
                    if (sellerMeRes.profile) {
                        setSellerProfile(sellerMeRes.profile);
                        setSellerFormData({
                            brandName: sellerMeRes.profile.store_name || '',
                            contactName: sellerMeRes.profile.contact_name || '',
                            email: sellerMeRes.profile.email || '',
                            phone: sellerMeRes.profile.phone || '',
                            storeLink: sellerMeRes.profile.website || '',
                            taxId: sellerMeRes.profile.gst || '',
                            brandDescription: sellerMeRes.profile.brand_description || ''
                        });
                    }
                } catch (err) {
                    console.warn('[Settings] Failed to fetch seller info:', err);
                }

                const savedProfile = await refreshProfile();
                // Fetch User Data
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                const data = userDoc.exists() ? userDoc.data() : null;
                if (userDoc.exists()) {
                    const resolvedDisplayName = data?.displayName || data?.profileName || savedProfile.displayName || savedProfile.profileName || user.displayName || '';
                    const [firstName = '', ...lastNameParts] = resolvedDisplayName.split(' ').filter(Boolean);
                    const photo = data?.photoURL || savedProfile.photoURL || user.photoURL || '';
                    if (photo) setProfileImage(photo);
                    const u = {
                        firstName: firstName || 'ZipRIGHT',
                        lastName: lastNameParts.join(' '),
                        email: user.email || '',
                        phone: '',
                        gender: data?.gender || 'Male',
                        dob: '',
                        planId: 'free',
                        zipPoints: 0
                    };
                    setUserData(u);
                    setEditUserData(u);
                    const plan = Object.values(PLANS).find(p => p.id === 'free') || PLANS.FREE;
                    setUserPlan(plan);
                }

                const membersList = data?.profileName ? [{
                    id: user.uid,
                    name: data.profileName,
                    isPrimary: true,
                    fitData: {
                        brand: data.preferredBrand || '',
                        topSize: data.usualSize || '',
                        waistSize: '',
                        heightUnit: 'cm',
                        heightFt: '',
                        heightIn: '',
                        heightCm: data.height ? String(data.height) : '',
                        weight: data.weight ? String(data.weight) : '',
                        fitPreference: data.fitPreference === 'slim' ? 1 : data.fitPreference === 'relaxed' || data.fitPreference === 'loose' ? 3 : 2,
                    }
                }] as Member[] : [];
                const savedMembers = buildMembersFromProfile(savedProfile);
                setMembers(savedMembers.length ? savedMembers : membersList);

                setAddresses(readStoredAddresses());

            } catch (error) {
                console.error("Error loading settings data:", error);
            }
        } else if (user?.isAnonymous) {
            const savedProfile = await refreshProfile();
            const u = {
                firstName: savedProfile.profileName ? savedProfile.profileName.split(' ')[0] : 'ZipRIGHT',
                lastName: savedProfile.profileName ? savedProfile.profileName.split(' ').slice(1).join(' ') : 'User',
                email: '',
                phone: user?.phoneNumber || '',
                gender: savedProfile.gender || 'Male',
                dob: '',
                planId: 'free',
                zipPoints: 0
            };
            setUserData(u);
            setEditUserData(u);
            setMembers(buildMembersFromProfile(savedProfile));
            setAddresses(readStoredAddresses());
            setSellerStatusState('none');
        }

        setLoading(false);
    };

    init();
  }, [view, navigate, refreshProfile]);

  const defaultAddressData: Address = {
      id: '',
      type: 'Home',
      name: '',
      phone: '',
      houseNo: '',
      area: '',
      landmark: '',
      city: '',
      state: '',
      zip: '',
      isDefault: false,
      coords: undefined
  };
  const [editAddressData, setEditAddressData] = useState<Address>(defaultAddressData);

  const toggleDarkMode = () => {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('zipright_theme', 'light');
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('zipright_theme', 'dark');
      setIsDarkMode(true);
    }
  };

  const handleBack = () => {
    if (view === 'main') {
      goBack('/profile');
    } else if (view === 'edit-address') {
      if (addressStep === 'form') {
        setAddressStep('map');
      } else {
        setView('addresses');
      }
    } else if (view === 'seller-apply') {
      setView('main');
    } else {
      setView('main');
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file (JPG, PNG, or WebP).', 'error');
      return;
    }

    try {
      showToast('Updating profile photo...', 'info');
      const url = await uploadOrEncodeProfilePhoto(file);
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          await updateAuthProfile(user, { photoURL: url }).catch(() => {});
        }
        await setDoc(doc(db, 'users', user.uid), {
          photoURL: url,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        await setDoc(doc(db, 'publicProfiles', user.uid), {
          uid: user.uid,
          photoURL: url,
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }
      try { localStorage.setItem('zipright_profile_photo', url); } catch {}
      setProfileImage(url);
      setUserProfile(prev => ({ ...prev, photoURL: url }));
      showToast('Profile photo updated', 'success');
    } catch {
      showToast('Could not update photo. Try again.', 'error');
    }
  };

  const saveUserProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
          const profileName = [editUserData.firstName.trim(), editUserData.lastName.trim()].filter(Boolean).join(' ');
          const displayName = profileName || user.displayName || '';
          await setDoc(doc(db, 'users', user.uid), {
              profileName,
              // Keep the social-search fields in step with the edited name
              ...(displayName ? { displayName, displayNameLower: displayName.toLowerCase() } : {}),
              gender: editUserData.gender,
          }, { merge: true });
          setUserData(editUserData);
          setUserProfile(prev => ({
              ...prev,
              profileName,
              displayName,
              gender: editUserData.gender,
          }));

          showToast('Profile Updated', 'success');
          setView('main');
      } catch (error) {
          console.error("Error saving user profile:", error);
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      }
  };

  // Addresses Functions
  const openAddAddress = () => {
      setEditAddressData({
          ...defaultAddressData,
          id: '',
          name: userData.firstName + ' ' + userData.lastName,
          phone: userData.phone.replace(/\s+/g, '')
      });
      setAddressStep('map');
      setView('edit-address');
  };

  const openEditAddress = (addr: Address) => {
      setEditAddressData(addr);
      setAddressStep('form');
      setView('edit-address');
  };

  const saveAddress = async () => {
      if (!editAddressData.houseNo || !editAddressData.area || !editAddressData.city || !editAddressData.zip) {
          showToast("House No., Area, City, and ZIP are required.", "error");
          return;
      }

      try {
          const nextAddress = editAddressData.id
            ? editAddressData
            : { ...editAddressData, id: `local-${Date.now()}` };
          setAddresses(prev => {
              const baseAddresses = editAddressData.isDefault
                ? prev.map(address => ({ ...address, isDefault: false }))
                : [...prev];
              const withoutCurrent = baseAddresses.filter(address => address.id !== nextAddress.id);
              const next = [...withoutCurrent, nextAddress];
              writeStoredAddresses(next);
              return next;
          });
          showToast('Address Saved', 'success');
          setView('addresses');
      } catch (error) {
          console.error("Error saving address:", error);
          handleFirestoreError(error, OperationType.WRITE, `addresses/${editAddressData.id || 'new'}`);
      }
  };

  const deleteAddress = async (id: string) => {
      try {
          const next = addresses.filter(a => a.id !== id);
          setAddresses(next);
          writeStoredAddresses(next);
          setShowDeleteAddressConfirm(null);
          showToast('Address Deleted', 'success');
      } catch (error) {
          console.error("Error deleting address:", error);
          handleFirestoreError(error, OperationType.DELETE, `addresses/${id}`);
      }
  };

  const deleteMember = async (id: string) => {
      try {
          if (auth.currentUser) {
              await deleteFitProfile(id).catch(async () => {
                  await setDoc(doc(db, 'users', auth.currentUser!.uid), {
                      profileName: '',
                      updatedAt: serverTimestamp(),
                  }, { merge: true });
              });
          }
          setMembers([]);
          setShowDeleteMemberConfirm(null);
          showToast('Profile Deleted', 'success');
      } catch (error) {
          console.error("Error deleting member:", error);
          handleFirestoreError(error, OperationType.DELETE, `users/${id}`);
      }
  };

  const useCurrentLocation = () => {
      if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition((pos) => {
                  setEditAddressData({
                      ...editAddressData,
                      coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
                      area: 'Current Location'
                  });
                  localStorage.setItem('zipright_location', 'granted');
                  setPermissionsState(p => ({...p, location: true}));
              }, (err) => showToast("Permission denied. Enable it in browser settings.", "error")
          );
      }
  };

  const togglePermission = (id: string) => {
    const nextVal = !permissionsState[id as keyof typeof permissionsState];
    setPermissionsState(prev => ({ ...prev, [id]: nextVal }));
    localStorage.setItem(`zipright_${id}`, nextVal ? 'granted' : 'denied');
  };

  const handleSellerApply = async () => {
    if (!sellerFormData.brandName || !sellerFormData.contactName || !sellerFormData.email || !sellerFormData.phone) {
      showToast("Please fill in all required fields (Brand, Contact, Email, Phone).", "error");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sellerFormData.email)) {
      showToast("Please enter a valid email address.", "error");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showToast("Please sign in to apply as a seller.", "error");
      return;
    }

    try {
        setLoading(true);
        const profile = await onboardSeller({
            store_name: sellerFormData.brandName,
            contact_name: sellerFormData.contactName,
            email: sellerFormData.email,
            phone: sellerFormData.phone,
            website: sellerFormData.storeLink || undefined,
            gst: sellerFormData.taxId || undefined,
            brand_description: sellerFormData.brandDescription || undefined,
            terms_accepted: true
        });
        setSellerStatusState(profile.status);
        setSellerStatus(profile.status);
        setSellerProfile(profile);
        showToast("Application Submitted Successfully!", "success");
        setView('main');
    } catch (error: any) {
        console.error("Error applying for seller:", error);
        showToast(error.message || "Failed to submit seller application.", "error");
    } finally {
        setLoading(false);
    }
  };

  const toggleUserRole = () => {
    const nextRole = userRole === 'user' ? 'seller' : 'user';
    setUserRole(nextRole);
    setUserRoleState(nextRole);
    showToast(`Switched to ${nextRole === 'seller' ? 'Seller Mode' : 'User Mode'}.`, 'success');
  };


  const handleSelectPlan = (plan: any) => {
    setShowPremiumModal(false);
    showToast("Checkout is unavailable in this demo.", "error");
  };

  // Plans Configuration mapped from utils
  const plans = [
    {
      id: 'free',
      name: 'Basic',
      monthlyPrice: 0,
      discountPercent: 0,
      features: [
        '10 Size Recommendations/mo',
        '5 Virtual Try-Ons/mo',
        '3 Fit Profiles',
        'External product link analysis',
        'Basic Fit Confidence Score',
        'Basic Brand Size Mapping',
        'Community Support',
        'Save 3 favourite brands'
      ],
      color: 'bg-surface-2 text-ink-soft',
      planData: PLANS.FREE
    },
    {
      id: 'starter',
      name: 'Starter',
      monthlyPrice: 299,
      discountPercent: 10,
      features: [
        '25 Size Recommendations/mo',
        '15 Virtual Try-Ons/mo',
        '3 Fit Profiles',
        'Advanced Fit Explanation',
        'Unlimited favourite brands',
        'Brand Fit Intelligence',
        'Return Risk Score',
        'Early feature access'
      ],
      color: 'bg-info-soft text-info',
      planData: PLANS.STARTER
    },
    {
      id: 'pro',
      name: 'Pro',
      monthlyPrice: 899,
      discountPercent: 15,
      features: [
        '100 Size Recommendations/mo',
        '50 Virtual Try-Ons/mo',
        '5 Fit Profiles',
        'AI Model Image Generation',
        'AI Outfit Suggestions',
        'Monthly Style Report',
        'Priority Support',
        'Exclusive Brand Discounts'
      ],
      color: 'bg-brand text-on-brand',
      popular: true,
      planData: PLANS.PRO
    },
    {
      id: 'elite',
      name: 'Elite',
      monthlyPrice: 1999,
      discountPercent: 20,
      features: [
        '300 Size Recommendations/mo',
        '200 Virtual Try-Ons/mo',
        '10 Fit Profiles',
        'AI Personal Stylist (VIP)',
        'Personal shopping assistant',
        'Early experimental features',
        'VIP Support & Free Returns',
        'Elite Rewards Program'
      ],
      color: 'bg-ink text-ink-invert',
      planData: PLANS.ELITE
    }
  ];

  // --- VIEW: SELLER APPLY ---
  if (view === 'seller-apply') {
    return (
      <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
        <AppBar title="Seller Application" onBack={() => setView('main')} />
        <div className="flex-1 overflow-y-auto px-6 pt-8 pb-40 no-scrollbar">
          <div className="mb-8">
            <Eyebrow>Become a partner</Eyebrow>
            <h1 className="font-display text-[32px] leading-[1.05] font-light text-ink mt-3">
              Open your <em className="font-medium">house.</em>
            </h1>
            <p className="text-ink-soft text-[14px] leading-relaxed mt-4 max-w-[88%]">
              Tell us about your label. We review every application to keep the marketplace considered.
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <Input
              label="Brand / Store Name"
              required
              value={sellerFormData.brandName}
              onChange={(e) => setSellerFormData({...sellerFormData, brandName: e.target.value})}
              placeholder="e.g. ZipStyle"
            />
            <Input
              label="Contact Person Name"
              required
              value={sellerFormData.contactName}
              onChange={(e) => setSellerFormData({...sellerFormData, contactName: e.target.value})}
              placeholder="e.g. John Doe"
            />
            <Input
              label="Contact Email"
              required
              type="email"
              value={sellerFormData.email}
              onChange={(e) => setSellerFormData({...sellerFormData, email: e.target.value})}
              placeholder="seller@example.com"
            />
            <Input
              label="Contact Phone"
              required
              value={sellerFormData.phone}
              onChange={(e) => setSellerFormData({...sellerFormData, phone: e.target.value})}
              placeholder="e.g. +91 90000 00000"
            />
            <Input
              label="Website or Store Link"
              value={sellerFormData.storeLink}
              onChange={(e) => setSellerFormData({...sellerFormData, storeLink: e.target.value})}
              placeholder="https://yourstore.com"
            />
            <Input
              label="Tax ID / GSTIN (Optional)"
              value={sellerFormData.taxId}
              onChange={(e) => setSellerFormData({...sellerFormData, taxId: e.target.value})}
              placeholder="e.g. 29AAAAA0000A1Z5"
            />
            <TextArea
              label="Brand Description / Story (Optional)"
              rows={4}
              value={sellerFormData.brandDescription}
              onChange={(e) => setSellerFormData({...sellerFormData, brandDescription: e.target.value})}
              placeholder="Describe your brand and products..."
            />
            <p className="text-[12px] text-ink-faint text-center leading-relaxed mt-1">
              By submitting, you agree to the ZipRIGHT Seller Terms of Use.
            </p>
          </div>
        </div>
        <div className="fixed bottom-0 inset-x-0 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent z-50 phone-fixed-bottom">
          <Button size="lg" fullWidth loading={loading} trailingIcon="send" onClick={handleSellerApply}>
            Submit application
          </Button>
        </div>
      </div>
    );
  }


  // --- VIEW: EDIT PROFILE ---
  if (view === 'edit-profile') {
      return (
        <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
            <AppBar title="Edit Profile" onBack={() => setView('main')} />
            <div className="flex-1 overflow-y-auto px-6 pt-8 pb-40 no-scrollbar">
                <div className="flex flex-col items-center mb-10">
                    <button
                        type="button"
                        aria-label="Change photo"
                        className="relative group"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div className="h-24 w-24 rounded-full overflow-hidden border border-line bg-surface-1 flex items-center justify-center">
                            {effectivePhoto ? (
                              <img src={effectivePhoto} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                            ) : (
                              <span className="font-display text-[32px] font-medium text-ink">{initialLetter}</span>
                            )}
                        </div>
                        <div className="absolute bottom-0 right-0 bg-ink text-ink-invert h-8 w-8 rounded-full flex items-center justify-center border-2 border-surface-0">
                            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">photo_camera</span>
                        </div>
                    </button>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand mt-4">Change Photo</p>
                </div>

                <div className="flex flex-col gap-6">
                    <Input
                        label="First Name"
                        value={editUserData.firstName}
                        onChange={(e) => setEditUserData({...editUserData, firstName: e.target.value})}
                    />
                    <Input
                        label="Last Name"
                        value={editUserData.lastName}
                        onChange={(e) => setEditUserData({...editUserData, lastName: e.target.value})}
                    />
                    <Input
                        label="Email Address"
                        type="email"
                        value={editUserData.email}
                        onChange={(e) => setEditUserData({...editUserData, email: e.target.value})}
                    />
                    <Input
                        label="Phone Number"
                        type="tel"
                        value={editUserData.phone}
                        onChange={(e) => setEditUserData({...editUserData, phone: e.target.value})}
                    />

                    {/* Gender */}
                    <div className="flex flex-col gap-2.5">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Gender</label>
                        <SegmentedControl
                            aria-label="Gender"
                            value={editUserData.gender}
                            onChange={(v) => setEditUserData({...editUserData, gender: v})}
                            options={[
                                { value: 'Male', label: 'Male' },
                                { value: 'Female', label: 'Female' },
                                { value: 'Other', label: 'Other' },
                            ]}
                        />
                    </div>

                    {/* Date of Birth */}
                    <Input
                        label="Date of Birth"
                        hint="Optional"
                        type="date"
                        value={editUserData.dob}
                        onChange={(e) => setEditUserData({...editUserData, dob: e.target.value})}
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                    />
                </div>
            </div>
            <div className="fixed bottom-0 inset-x-0 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent z-50 phone-fixed-bottom">
                <Button size="lg" fullWidth onClick={saveUserProfile}>Save changes</Button>
            </div>
        </div>
      );
  }

  // --- VIEW: EDIT ADDRESS ---
  if (view === 'edit-address') {
    return (
        <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
            {addressStep === 'map' && (
                <div className="relative flex-1 flex flex-col">
                    <div className="absolute top-0 left-0 right-0 z-10 flex items-center p-4 pt-safe">
                        <button aria-label="Go back" onClick={() => setView('addresses')} className="h-10 w-10 rounded-full bg-surface-1 shadow-lift flex items-center justify-center border border-line text-ink"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
                    </div>
                    <div className="flex-1 bg-surface-2 relative">
                         <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                             <div className="flex flex-col items-center mb-8">
                                 <div className="px-3 py-1 bg-ink text-ink-invert text-[11px] font-semibold uppercase tracking-[0.1em] rounded-lg mb-1 animate-bounce">I'm here</div>
                                 <span className="material-symbols-outlined text-4xl text-brand" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">location_on</span>
                             </div>
                         </div>
                    </div>
                    <div className="absolute bottom-44 right-4 flex flex-col gap-3">
                        <button onClick={useCurrentLocation} aria-label="Use current location" className="h-12 w-12 rounded-full bg-surface-1 shadow-float flex items-center justify-center text-brand border border-line"><span className="material-symbols-outlined" aria-hidden="true">my_location</span></button>
                    </div>
                    <div className="bg-surface-1 rounded-t-sheet px-6 pt-6 pb-8 shadow-float z-20 border-t border-line">
                        <div className="flex items-start gap-4 mb-6">
                            <span className="material-symbols-outlined text-brand text-3xl mt-1" aria-hidden="true">location_on</span>
                            <div>
                                <h3 className="font-display text-[22px] font-light text-ink">{editAddressData.area || 'Select Location'}</h3>
                                <p className="text-[13px] text-ink-soft leading-relaxed mt-1">{editAddressData.city}, {editAddressData.state}</p>
                            </div>
                        </div>
                        <Button size="lg" fullWidth trailingIcon="arrow_forward" onClick={() => setAddressStep('form')}>Confirm & proceed</Button>
                    </div>
                </div>
            )}
            {addressStep === 'form' && (
                <div className="flex flex-col flex-1 bg-surface-0 overflow-y-auto no-scrollbar">
                    <AppBar
                      title="Edit Address"
                      onBack={() => setAddressStep('map')}
                      trailing={<button onClick={saveAddress} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand px-2">Save</button>}
                    />
                    <div className="px-6 pt-8 flex flex-col gap-10 pb-40">
                         <div className="flex flex-col gap-6">
                            <Input label="Full Name" value={editAddressData.name} onChange={(e) => setEditAddressData({...editAddressData, name: e.target.value})} placeholder="Enter recipient name" />
                            <Input label="Phone Number" type="tel" value={editAddressData.phone} onChange={(e) => setEditAddressData({...editAddressData, phone: e.target.value})} placeholder="Enter 10-digit number" />
                            <Input label="House / Flat / Block No." value={editAddressData.houseNo} onChange={(e) => setEditAddressData({...editAddressData, houseNo: e.target.value})} placeholder="Enter details" />
                            <Input label="Apartment / Road / Area" value={editAddressData.area} onChange={(e) => setEditAddressData({...editAddressData, area: e.target.value})} placeholder="Enter details" />
                            <Input label="Landmark (Optional)" value={editAddressData.landmark} onChange={(e) => setEditAddressData({...editAddressData, landmark: e.target.value})} placeholder="e.g. Near Central Mall" />
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="City" value={editAddressData.city} onChange={(e) => setEditAddressData({...editAddressData, city: e.target.value})} placeholder="Enter city" />
                                <Input label="ZIP Code" value={editAddressData.zip} onChange={(e) => setEditAddressData({...editAddressData, zip: e.target.value})} placeholder="Enter zip" />
                            </div>
                         </div>
                         <div className="flex flex-col gap-3">
                            <Eyebrow>Save as</Eyebrow>
                            <div className="flex flex-wrap gap-2">
                                {['Home', 'Work', 'Friends', 'Other'].map((type) => (
                                    <button key={type} onClick={() => setEditAddressData({...editAddressData, type: type as any})} className={cn('px-5 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors border', editAddressData.type === type ? 'bg-ink text-ink-invert border-ink' : 'bg-surface-1 text-ink-soft border-line')}>{type}</button>
                                ))}
                            </div>
                         </div>
                         <div className="flex items-center justify-between">
                            <span className="text-[13px] text-ink-soft">Make this my default address</span>
                            <Toggle
                                label="Make this my default address"
                                on={editAddressData.isDefault}
                                onClick={() => setEditAddressData({...editAddressData, isDefault: !editAddressData.isDefault})}
                            />
                         </div>
                    </div>
                    <div className="fixed bottom-0 inset-x-0 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent z-50 phone-fixed-bottom">
                        <Button size="lg" fullWidth variant="accent" onClick={saveAddress}>Save address</Button>
                    </div>
                </div>
            )}
        </div>
    );
  }

  // --- VIEW: ADDRESSES LIST ---
  if (view === 'addresses') {
      return (
        <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
            <AppBar
              title="Saved Addresses"
              onBack={() => setView('main')}
              trailing={<button onClick={openAddAddress} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand px-2">Add new</button>}
            />
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-24 no-scrollbar">
                <div className="flex flex-col gap-4">
                    {addresses.map((addr) => {
                        if (!addr) return null;
                        return (
                        <div key={addr.id} className="flex flex-col p-5 rounded-card bg-surface-1 border border-line">
                            <div className="flex justify-between items-start mb-3">
                                <span className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] bg-brand-soft text-brand">{addr.type}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => openEditAddress(addr)} aria-label="Edit address" className="h-8 w-8 rounded-full border border-line flex items-center justify-center text-ink-soft"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit</span></button>
                                    <button onClick={() => setShowDeleteAddressConfirm(addr.id)} aria-label="Delete address" className="h-8 w-8 rounded-full border border-danger/30 flex items-center justify-center text-danger"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span></button>
                                </div>
                            </div>
                            <h3 className="font-display text-[17px] font-medium mb-1 text-ink">{addr.name}</h3>
                            <p className="text-[13px] text-ink-soft leading-relaxed">{addr.houseNo}, {addr.area}</p>
                            <p className="text-[13px] text-ink-soft leading-relaxed">{addr.city}, {addr.state} - {addr.zip}</p>
                            <p className="text-[12px] text-ink-faint mt-2 font-mono">{addr.phone}</p>
                        </div>
                        );
                    })}
                    {addresses.length === 0 && (
                        <EmptyState icon="location_off" title="No saved addresses" description="Add a delivery address to speed up checkout." action={<Button variant="outline" icon="add" onClick={openAddAddress}>Add address</Button>} />
                    )}
                </div>
            </div>

            {/* Delete Address Confirmation Modal */}
            <Modal
                open={!!showDeleteAddressConfirm}
                onClose={() => setShowDeleteAddressConfirm(null)}
                title="Delete address?"
                description="Are you sure you want to delete this address? This action cannot be undone."
                actions={
                    <>
                        <Button variant="secondary" fullWidth onClick={() => setShowDeleteAddressConfirm(null)}>Cancel</Button>
                        <Button variant="danger" fullWidth onClick={() => showDeleteAddressConfirm && deleteAddress(showDeleteAddressConfirm)}>Delete</Button>
                    </>
                }
            />
        </div>
      );
  }

  // --- VIEW: MANAGE FITS ---
  if (view === 'manage-fits') {
      return (
        <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
            <AppBar title="Manage Profiles" onBack={() => setView('main')} />
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-24 no-scrollbar">
                <div className="flex flex-col gap-4">
                    {members.map(member => (
                        <div
                            key={member.id}
                            onClick={() => navigate('/fit-profile', { state: { mode: 'edit', memberId: member.id } })}
                            className="flex items-center justify-between p-5 rounded-card bg-surface-1 border border-line cursor-pointer active:scale-[0.99] transition-transform"
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-14 w-14 rounded-full bg-ink text-ink-invert flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-2xl" aria-hidden="true">person</span>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="font-display text-[18px] font-medium text-ink leading-tight truncate">{member.name}</h3>
                                    <p className="text-[12px] text-ink-soft mt-1">
                                        {member.fitData?.heightFt}'{member.fitData?.heightIn}" • {member.fitData?.weight}kg
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate('/fit-profile', { state: { mode: 'edit', memberId: member.id } });
                                    }}
                                    aria-label="Edit profile"
                                    className="h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink-soft"
                                >
                                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">edit</span>
                                </button>
                                {!member.isPrimary && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeleteMemberConfirm(member.id);
                                        }}
                                        aria-label="Delete profile"
                                        className="h-10 w-10 rounded-full border border-danger/30 flex items-center justify-center text-danger"
                                    >
                                        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">delete</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Delete Member Confirmation Modal */}
                    <Modal
                        open={!!showDeleteMemberConfirm}
                        onClose={() => setShowDeleteMemberConfirm(null)}
                        title="Delete profile?"
                        description="Are you sure you want to delete this fit profile? This action cannot be undone."
                        actions={
                            <>
                                <Button variant="secondary" fullWidth onClick={() => setShowDeleteMemberConfirm(null)}>Cancel</Button>
                                <Button variant="danger" fullWidth onClick={() => showDeleteMemberConfirm && deleteMember(showDeleteMemberConfirm)}>Delete</Button>
                            </>
                        }
                    />

                    {(() => {
                        const currentPlan = plans.find(p => p.id === userData.planId)?.planData || PLANS.FREE;
                        const limit = currentPlan.limits.profiles || 1;
                        const isLimitReached = members.length >= limit;

                        return (
                            <button
                                onClick={() => {
                                    if (isLimitReached) {
                                        setShowPremiumModal(true);
                                        return;
                                    }
                                    navigate('/fit-profile', { state: { mode: 'add' } });
                                }}
                                className={cn(
                                    'flex items-center justify-center gap-3 p-7 rounded-card border border-dashed transition-colors',
                                    isLimitReached ? 'border-line text-ink-faint bg-surface-2' : 'border-line-strong text-ink-soft hover:bg-surface-2',
                                )}
                            >
                                <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{isLimitReached ? 'lock' : 'add_circle'}</span>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Add new profile</span>
                                {isLimitReached && (
                                    <span className="ml-1 flex items-center gap-1 bg-brass text-ink px-2 py-1 rounded-full">
                                        <span className="material-symbols-outlined text-[12px]" aria-hidden="true">verified</span>
                                        <span className="text-[10px] font-semibold tracking-[0.1em]">UPGRADE</span>
                                    </span>
                                )}
                            </button>
                        );
                    })()}
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: PERMISSIONS ---
  if (view === 'permissions') {
    const permissionsList = [
        { id: 'camera', title: 'Camera', icon: 'camera', desc: 'Required for AI virtual try-on and SmartFit body scanning.' },
        { id: 'notifications', title: 'Notifications', icon: 'notifications', desc: 'Stay updated on order status and sizing alerts.' }
    ];

    return (
      <div className="flex flex-col min-h-screen min-h-dvh w-full bg-surface-0 text-ink relative overflow-x-hidden">
        <AppBar title="Permissions" onBack={() => setView('main')} />
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
             <div className="flex flex-col gap-3">
                {permissionsList.map(p => {
                     const isAllowed = permissionsState[p.id as keyof typeof permissionsState];
                     return (
                        <div key={p.id} className="flex items-start gap-4 p-5 bg-surface-1 rounded-card border border-line">
                            <div className={cn('h-10 w-10 rounded-full flex items-center justify-center shrink-0 border', isAllowed ? 'bg-brand-soft border-brand/20 text-brand' : 'border-line text-ink-faint')}>
                                <span className="material-symbols-outlined" aria-hidden="true">{p.icon}</span>
                            </div>
                            <div className="flex-1">
                                <p className="text-[15px] font-medium text-ink">{p.title}</p>
                                <p className="text-[12px] text-ink-soft mt-1 leading-relaxed">{p.desc}</p>
                            </div>
                            <Toggle label={p.title} on={!!isAllowed} onClick={() => togglePermission(p.id)} />
                        </div>
                     );
                })}
            </div>
        </div>
      </div>
    );
  }

  // --- VIEW: APP SETTINGS ---
  if (view === 'app-settings') {
      return (
        <div className="flex flex-col min-h-screen min-h-dvh w-full bg-surface-0 text-ink relative overflow-x-hidden">
            <AppBar title="App Settings" onBack={() => setView('main')} />
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
                <div className="flex flex-col gap-4">
                    <Eyebrow>Notifications</Eyebrow>
                    <div className="flex items-center gap-4 p-5 bg-surface-1 rounded-card border border-line">
                        <div className="h-10 w-10 rounded-full bg-brand-soft border border-brand/20 flex items-center justify-center text-brand shrink-0">
                            <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
                        </div>
                        <div className="flex-1">
                            <p className="text-[15px] font-medium text-ink">Push Notifications</p>
                            <p className="text-[12px] text-ink-soft mt-0.5">Alerts for orders and fits.</p>
                        </div>
                        <Toggle label="Push Notifications" on={permissionsState.notifications} onClick={() => togglePermission('notifications')} />
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: SELLER PROFILE (EDIT/VIEW BRAND DETAILS) ---
  if (view === 'seller-profile') {
    return (
      <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
        <AppBar title="Seller Profile" onBack={() => setView('main')} />
        <div className="flex-1 overflow-y-auto px-6 pt-8 pb-40 no-scrollbar">
          <div className="flex flex-col gap-6">

            {/* Logo Upload Section */}
            <div className="flex flex-col items-center gap-4 bg-surface-1 p-6 rounded-card border border-line">
              <Eyebrow>Brand Logo</Eyebrow>
              <button type="button" aria-label="Upload brand logo" className="relative group" onClick={() => {
                const el = document.getElementById('logo-file-input');
                el?.click();
              }}>
                <div className="h-24 w-24 rounded-full overflow-hidden border border-line bg-surface-2 flex items-center justify-center">
                  {sellerProfile?.brand_logo_url ? (
                    <img src={sellerProfile.brand_logo_url} alt="Logo" className="h-full w-full object-cover"/>
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-brand" aria-hidden="true">storefront</span>
                  )}
                </div>
                {logoUploading && (
                  <div className="absolute inset-0 bg-scrim rounded-full flex items-center justify-center">
                    <span className="h-6 w-6 border-2 border-ink-invert border-t-transparent rounded-full animate-spin"></span>
                  </div>
                )}
                <div className="absolute bottom-0 right-0 bg-ink text-ink-invert h-7 w-7 rounded-full flex items-center justify-center border-2 border-surface-1">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">upload</span>
                </div>
              </button>
              <input
                id="logo-file-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setLogoUploading(true);
                    const updated = await uploadSellerLogo(file);
                    setSellerProfile(updated);
                    showToast("Logo uploaded successfully!", "success");
                  } catch (err: any) {
                    console.error(err);
                    showToast(err.message || "Failed to upload logo.", "error");
                  } finally {
                    setLogoUploading(false);
                  }
                }}
              />
              <p className="text-[12px] text-ink-faint text-center">Supports PNG, JPG, or WebP. Max 5MB.</p>
            </div>

            {/* Business Info Form */}
            <div className="flex flex-col bg-surface-1 p-6 rounded-card border border-line gap-6">
              <Input label="Brand Name" value={sellerFormData.brandName} onChange={(e) => setSellerFormData({...sellerFormData, brandName: e.target.value})} />
              <Input label="Contact Person Name" value={sellerFormData.contactName} onChange={(e) => setSellerFormData({...sellerFormData, contactName: e.target.value})} />
              <Input label="Contact Email" type="email" value={sellerFormData.email} onChange={(e) => setSellerFormData({...sellerFormData, email: e.target.value})} />
              <Input label="Contact Phone" value={sellerFormData.phone} onChange={(e) => setSellerFormData({...sellerFormData, phone: e.target.value})} />
              <Input label="Website Link" value={sellerFormData.storeLink} onChange={(e) => setSellerFormData({...sellerFormData, storeLink: e.target.value})} placeholder="https://..." />
              <Input label="GSTIN / Tax ID" value={sellerFormData.taxId} onChange={(e) => setSellerFormData({...sellerFormData, taxId: e.target.value})} />
              <TextArea label="Brand Description / Story" rows={4} value={sellerFormData.brandDescription} onChange={(e) => setSellerFormData({...sellerFormData, brandDescription: e.target.value})} />

              <Button
                fullWidth
                loading={loading}
                onClick={async () => {
                  try {
                    setLoading(true);
                    const updated = await updateSellerProfile({
                      store_name: sellerFormData.brandName,
                      contact_name: sellerFormData.contactName,
                      email: sellerFormData.email,
                      phone: sellerFormData.phone,
                      website: sellerFormData.storeLink || undefined,
                      gst: sellerFormData.taxId || undefined,
                      brand_description: sellerFormData.brandDescription || undefined
                    });
                    setSellerProfile(updated);
                    showToast("Profile updated successfully!", "success");
                    setView('main');
                  } catch (err: any) {
                    console.error(err);
                    showToast(err.message || "Failed to update profile.", "error");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Save changes
              </Button>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: ADMIN PENDING APPROVALS ---
  if (view === 'admin-approvals') {
    if (!isServerAdmin) {
      setView('main');
      return null;
    }
    return (
      <div className="flex flex-col h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-hidden">
        <AppBar title="Seller Applications" onBack={() => setView('main')} />

        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
          {pendingSellers.length === 0 ? (
            <EmptyState icon="check_circle" title="All caught up" description="No pending applications right now." />
          ) : (
            <div className="flex flex-col gap-5">
              {pendingSellers.map((seller) => (
                <div key={seller.uid} className="bg-surface-1 p-6 rounded-card border border-line flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-full bg-surface-2 border border-line flex items-center justify-center text-brand shrink-0">
                      <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-display text-[17px] font-medium text-ink truncate">{seller.store_name}</h4>
                      <p className="text-[11px] text-ink-faint mt-0.5 font-mono truncate">UID: {seller.uid}</p>
                    </div>
                  </div>

                  <Divider />

                  <div className="grid grid-cols-1 gap-2.5">
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-ink-faint">Contact</span>
                      <span className="font-medium text-ink">{seller.contact_name}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-ink-faint">Email</span>
                      <span className="font-medium text-ink truncate max-w-[180px]">{seller.email}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-ink-faint">Phone</span>
                      <span className="font-medium text-ink">{seller.phone}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-ink-faint">Website</span>
                      <span className="font-medium text-ink truncate max-w-[180px]">{seller.website || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-ink-faint">GSTIN</span>
                      <span className="font-medium text-ink">{seller.gst || 'N/A'}</span>
                    </div>
                    {seller.brand_description && (
                      <div className="flex flex-col gap-1.5 mt-1 text-[13px]">
                        <span className="text-ink-faint">Description</span>
                        <p className="p-3 bg-surface-2 rounded-xl text-ink leading-relaxed">{seller.brand_description}</p>
                      </div>
                    )}
                  </div>

                  <Divider className="mt-1" />

                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => {
                        setAdminActionTarget(seller);
                        setAdminReason('');
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={async () => {
                        try {
                          setLoading(true);
                          await adminSetSellerStatus(seller.uid, 'active');
                          setPendingSellers(prev => prev.filter(s => s.uid !== seller.uid));
                          showToast(`Approved ${seller.store_name} successfully!`, "success");
                        } catch (err: any) {
                          console.error(err);
                          showToast(err.message || "Failed to approve seller.", "error");
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reject Dialog */}
        <Modal
          open={!!adminActionTarget}
          onClose={() => setAdminActionTarget(null)}
          title="Reject application"
          description={adminActionTarget ? `Provide a reason for rejecting the application for ${adminActionTarget.store_name}:` : undefined}
          actions={
            <>
              <Button variant="secondary" fullWidth onClick={() => setAdminActionTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                fullWidth
                onClick={async () => {
                  if (!adminActionTarget) return;
                  try {
                    setLoading(true);
                    await adminSetSellerStatus(adminActionTarget.uid, 'rejected', adminReason || undefined);
                    setPendingSellers(prev => prev.filter(s => s.uid !== adminActionTarget.uid));
                    showToast(`Rejected ${adminActionTarget.store_name} application.`, "success");
                    setAdminActionTarget(null);
                  } catch (err: any) {
                    console.error(err);
                    showToast(err.message || "Failed to reject seller.", "error");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Yes, reject
              </Button>
            </>
          }
        >
          <TextArea
            value={adminReason}
            onChange={(e) => setAdminReason(e.target.value)}
            placeholder="e.g. Invalid GSTIN, incomplete business proof..."
            rows={3}
          />
        </Modal>
      </div>
    );
  }

  // --- MAIN VIEW ---
  return (
    <div className="relative flex h-full min-h-screen min-h-dvh w-full flex-col bg-surface-0 text-ink overflow-x-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>

      <AppBar title="Settings" onBack={handleBack} />

      {/* Sticky Search Bar */}
      <div className="px-6 pt-4 pb-2 sticky top-[57px] z-30 bg-surface-0/90 backdrop-blur-md border-b border-line/40">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint text-[18px]" aria-hidden="true">search</span>
          <input
            type="text"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            placeholder="Search settings..."
            className="w-full bg-surface-1 border border-line rounded-ctl pl-10 pr-4 h-11 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar">
        {/* Profile masthead */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-6 pt-8 pb-6"
        >
          <Eyebrow>Account</Eyebrow>
          <div className="mt-5 flex items-center gap-5">
            <button
              type="button"
              aria-label="Change profile photo"
              className="relative shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="h-20 w-20 rounded-full overflow-hidden border border-line bg-surface-1 flex items-center justify-center">
                {effectivePhoto ? (
                  <img src={effectivePhoto} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                ) : (
                  <span className="font-display text-[28px] font-medium text-ink">{initialLetter}</span>
                )}
              </div>
              <div className="absolute bottom-0 right-0 bg-ink text-ink-invert h-7 w-7 rounded-full flex items-center justify-center border-2 border-surface-0">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
              </div>
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-[26px] leading-[1.1] font-light text-ink truncate">
                  {userData.firstName || effectiveDisplayName.split(' ')[0] || 'ZipRIGHT'} <em className="font-medium">{userData.lastName || effectiveDisplayName.split(' ').slice(1).join(' ')}</em>
                </h1>
                <button
                  onClick={() => {
                    setEditUserData(userData);
                    setView('edit-profile');
                  }}
                  aria-label="Edit profile"
                  className="text-ink-faint shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit</span>
                </button>
              </div>
              <p className="text-[12px] text-ink-soft mt-1 truncate">{userData.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-5">
            {sellerStatus === 'active' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleUserRole();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-line-strong text-ink active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">swap_horiz</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {userRole === 'user' ? 'Seller Mode' : 'User Mode'}
                </span>
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPremiumModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-on-brand shadow-glow active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">verified</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">Premium</span>
            </button>
          </div>
        </motion.div>

        {/* Wallet Section */}
        {userRole !== 'seller' && (
          <div id="wallet-section" className="px-6 mb-8">
            <Eyebrow className="mb-4 ml-1">Wallet & Rewards</Eyebrow>
            <div className="rounded-card border border-line bg-surface-1 overflow-hidden">
              <div className="flex items-center justify-between p-6 bg-brass-soft">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brass">ZipCoins Balance</p>
                  <h2 className="font-display text-[38px] font-light text-ink leading-none mt-2">{userData.zipPoints}</h2>
                </div>
                <div className="h-12 w-12 rounded-full bg-brass text-ink flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
                </div>
              </div>

              {!showRedeemInput ? (
                <button onClick={() => {
                  if (userData.zipPoints < 100) {
                    showToast("Minimum 100 ZipCoins required to redeem.", "error");
                    return;
                  }
                  setShowRedeemInput(true);
                }} className="flex items-center gap-4 p-4 w-full text-left border-t border-line active:scale-[0.99] transition-transform">
                  <div className="h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink-soft shrink-0"><span className="material-symbols-outlined text-[19px]" aria-hidden="true">payments</span></div>
                  <div className="flex-1 text-[15px] font-medium text-ink">Redeem to Bank</div>
                  <span className="material-symbols-outlined text-ink-faint text-[18px]" aria-hidden="true">arrow_forward_ios</span>
                </button>
              ) : (
                <div className="p-6 bg-surface-2 border-t border-line">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Redeem ₹{(userData.zipPoints / 100).toFixed(2)}</p>
                  <input
                    type="text"
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value)}
                    placeholder="Enter UPI ID (e.g., user@upi)"
                    className="w-full bg-surface-1 border border-line rounded-ctl px-4 h-12 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow] mb-4"
                  />
                  <div className="flex gap-3">
                    <Button variant="secondary" fullWidth onClick={() => setShowRedeemInput(false)}>Cancel</Button>
                    <Button
                      fullWidth
                      loading={isRedeeming}
                      disabled={isRedeeming}
                      onClick={async () => {
                        if (!redeemInput) {
                          showToast("Please enter UPI ID", "error");
                          return;
                        }
                        setIsRedeeming(true);
                        try {
                          const user = auth.currentUser;
                          if (user) {
                            await setDoc(doc(db, 'users', user.uid), {
                              zipPoints: 0
                            }, { merge: true });
                            showToast(`Redemption request of ₹${(userData.zipPoints / 100).toFixed(2)} sent to ${redeemInput} successfully!`, "success");
                            setUserData(prev => ({ ...prev, zipPoints: 0 }));
                            setShowRedeemInput(false);
                            setRedeemInput('');
                          }
                        } catch (error) {
                          console.error("Redemption failed:", error);
                          showToast("Redemption failed. Try again.", "error");
                        } finally {
                          setIsRedeeming(false);
                        }
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                </div>
              )}

              {/* Ways to Earn */}
              <div className="p-6 bg-surface-2 border-t border-line">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft mb-4">Ways to Earn</p>
                <div className="flex flex-col gap-3.5">
                  {[
                    { icon: 'shopping_bag', title: 'Shop & Earn', desc: 'Up to 5000 coins per order' },
                    { icon: 'group_add', title: 'Refer a Friend', desc: '500 coins per referral' },
                    { icon: 'rate_review', title: 'Write a Review', desc: '100 coins per review' }
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-surface-1 flex items-center justify-center text-brand border border-line shrink-0">
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span>
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-ink leading-none">{item.title}</p>
                        <p className="text-[12px] text-ink-soft mt-1">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Administrator Controls */}
        {isServerAdmin && (
          <div className="px-6 mb-8">
            <Eyebrow className="mb-4 ml-1 text-brand">Admin Controls</Eyebrow>
            <MenuGroup>
              <ListRow icon="verified_user" title="Seller Applications" subtitle="Review partner onboarding" onClick={() => setView('admin-approvals')} />
              <ListRow icon="analytics" title="Platform Analytics" subtitle="Sizing accuracy & telemetry" onClick={() => navigate('/admin')} />
            </MenuGroup>
          </div>
        )}

        {/* Seller Hub Section */}
        {userRole === 'seller' && (
          <div className="px-6 mb-8">
            <Eyebrow className="mb-4 ml-1">Seller Hub</Eyebrow>
            <MenuGroup>
              <ListRow icon="storefront" title="Seller Profile & Settings" onClick={() => setView('seller-profile')} />
              <ListRow icon="dashboard" title="Seller Dashboard" onClick={() => navigate('/seller/dashboard')} />
            </MenuGroup>
          </div>
        )}

        {/* Seller Tools Section */}
        {userRole !== 'seller' && (
          <div className="px-6 mb-8">
            <Eyebrow className="mb-4 ml-1">Seller Tools</Eyebrow>
            {sellerStatus === 'none' && (
              <MenuGroup>
                <ListRow icon="storefront" title="Apply to Become a Seller" onClick={() => setView('seller-apply')} />
              </MenuGroup>
            )}
            {sellerStatus === 'pending' && (
              <div className="rounded-card border border-line bg-surface-1 p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-12 w-12 rounded-full bg-warning-soft flex items-center justify-center text-warning shrink-0">
                    <span className="material-symbols-outlined text-2xl" aria-hidden="true">pending</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-[19px] font-medium text-ink leading-tight">Pending Review</p>
                    <p className="text-[12px] text-ink-soft mt-1 leading-relaxed">Your application is currently being verified. This usually takes 24-48 hours.</p>
                  </div>
                </div>

                <div className="bg-surface-2 rounded-2xl p-4 border border-line mb-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft mb-3">Application Details</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-ink-faint">Brand</span>
                      <span className="text-[13px] font-medium text-ink">{sellerFormData.brandName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-ink-faint">Contact</span>
                      <span className="text-[13px] font-medium text-ink">{sellerFormData.contactName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-ink-faint">Phone</span>
                      <span className="text-[13px] font-medium text-ink">{sellerFormData.phone}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-ink-faint">Email</span>
                      <span className="text-[13px] font-medium text-ink">{sellerFormData.email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" fullWidth onClick={() => setView('seller-apply')}>Edit</Button>
                  <Button variant="secondary" fullWidth onClick={() => setShowCancelApplyConfirm(true)}>Cancel</Button>
                </div>
              </div>
            )}
            {sellerStatus === 'rejected' && (
              <div className="rounded-card border border-danger/25 bg-danger-soft p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-12 w-12 rounded-full bg-surface-1 flex items-center justify-center text-danger shrink-0 border border-danger/20">
                    <span className="material-symbols-outlined text-2xl" aria-hidden="true">error</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-[19px] font-medium text-danger leading-tight">Application Rejected</p>
                    <p className="text-[12px] text-ink-soft mt-1 leading-relaxed">Your seller registration application was declined. You can update your details and submit again.</p>
                  </div>
                </div>
                <Button variant="outline" fullWidth onClick={() => setView('seller-apply')}>Re-apply</Button>
              </div>
            )}
            {sellerStatus === 'suspended' && (
              <div className="rounded-card border border-warning/25 bg-warning-soft p-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-surface-1 flex items-center justify-center text-warning shrink-0 border border-warning/20">
                    <span className="material-symbols-outlined text-2xl" aria-hidden="true">block</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-[19px] font-medium text-warning leading-tight">Account Suspended</p>
                    <p className="text-[12px] text-ink-soft mt-1 leading-relaxed">Your seller privileges have been suspended. Please contact support at partner@zipright.in for assistance.</p>
                  </div>
                </div>
              </div>
            )}
            {sellerStatus === 'active' && (
              <MenuGroup>
                <ListRow icon="storefront" title="Seller Profile & Settings" onClick={() => setView('seller-profile')} />
              </MenuGroup>
            )}
          </div>
        )}

        {/* Cancel Application Confirmation Modal */}
        <Modal
          open={showCancelApplyConfirm}
          onClose={() => setShowCancelApplyConfirm(false)}
          title="Cancel application?"
          description="Are you sure you want to cancel your seller application? You will need to apply again later."
          actions={
            <>
              <Button variant="secondary" fullWidth onClick={() => setShowCancelApplyConfirm(false)}>No, keep it</Button>
              <Button
                variant="danger"
                fullWidth
                onClick={async () => {
                  setSellerStatusState('none');
                  setSellerStatus('none');
                  showToast('Application Cancelled', 'success');
                  setShowCancelApplyConfirm(false);
                }}
              >
                Yes, cancel
              </Button>
            </>
          }
        />

        {/* Instagram-Style Settings Menu */}
        <div className="px-6 mb-8">
          <Eyebrow className="mb-4 ml-1">Settings</Eyebrow>
          <MenuGroup>
            <ListRow icon="lock" title="Privacy" subtitle="Account privacy & data control" onClick={() => navigate('/privacy-center')} />
            <ListRow icon="notifications" title="Notifications" subtitle="Push & email preferences" onClick={() => setView('permissions')} />
            <ListRow icon="account_balance_wallet" title="Wallet" subtitle={`ZipCoins Balance: ${userData.zipPoints}`} onClick={() => {
              const el = document.getElementById('wallet-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }} />
            <ListRow icon="local_shipping" title="Orders" subtitle="Track orders & purchases" onClick={() => navigate('/order-history')} />
            <ListRow icon="groups" title="Manage Profiles" subtitle="Family & member fit cards" onClick={() => navigate('/manage-profiles')} />
            <ListRow icon="code" title="Developer" subtitle="APIs & integrations portal" onClick={() => navigate('/developer')} />
            <ListRow
              icon="storefront"
              title="Seller"
              subtitle={sellerStatus === 'active' ? 'Seller dashboard & catalog' : 'Apply for brand partnership'}
              onClick={() => sellerStatus === 'active' ? navigate('/seller/dashboard') : setView('seller-apply')}
            />
          </MenuGroup>
        </div>

        {/* Preferences Section */}
        <div className="px-6 mb-8">
          <Eyebrow className="mb-4 ml-1">Preferences</Eyebrow>
          <MenuGroup>
            <ListRow
              icon="dark_mode"
              title="Dark Mode"
              trailing={<Toggle label="Dark Mode" on={isDarkMode} onClick={toggleDarkMode} />}
            />
            <ListRow icon="settings" title="App Settings" onClick={() => setView('app-settings')} />
          </MenuGroup>
        </div>

        {/* Support Section */}
        <div className="px-6 mb-8">
          <Eyebrow className="mb-4 ml-1">Support & Legal</Eyebrow>
          <MenuGroup>
            <ListRow icon="help" title="Help & FAQs" onClick={() => navigate('/faqs')} />
            <ListRow icon="info" title="About Us" onClick={() => navigate('/about-us')} />
            <ListRow icon="shield" title="Privacy Center" onClick={() => navigate('/privacy-center')} />
            <ListRow icon="policy" title="Privacy Policy" onClick={() => navigate('/privacy-policy')} />
            <ListRow icon="gavel" title="Terms of Use" onClick={() => navigate('/terms-of-use')} />
            <ListRow icon="cookie" title="Cookie Policy" onClick={() => navigate('/cookie-policy')} />
            <ListRow icon="payments" title="Refund Policy" onClick={() => navigate('/refund-policy')} />
            <ListRow icon="tune" title="Cookie Preferences" onClick={openCookiePreferences} />
          </MenuGroup>
        </div>

        <div className="px-6 py-4 flex flex-col gap-3">
          <Button
            variant="outline"
            fullWidth
            className="!text-danger !border-danger/30"
            onClick={() => setShowLogoutConfirm(true)}
          >
            Log out
          </Button>
          <button
            onClick={() => setShowDeleteAccountConfirm(true)}
            className="text-[12px] font-semibold text-danger/80 uppercase tracking-[0.1em] text-center hover:underline mt-1"
          >
            Delete Account
          </button>
          <p className="text-[11px] text-center text-ink-faint mt-6">
            <span className="text-ink font-medium">Zip</span><span className="text-brand font-medium">RIGHT</span> v1.0
          </p>
        </div>
      </div>

      {/* Logout Confirmation Sheet */}
      <Sheet open={showLogoutConfirm} onClose={() => setShowLogoutConfirm(false)} title="Log out of ZipRIGHT?">
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-[13.5px] text-ink-soft leading-relaxed">
            You will need to sign in again to access your fit profiles, wishlist, and try-ons.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setShowLogoutConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              fullWidth
              onClick={async () => {
                setShowLogoutConfirm(false);
                try { await auth.signOut(); } catch {}
                try { clearProfile(); } catch {}
                navigate('/welcome', { replace: true });
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </Sheet>

      {/* 1. Initial Warning Modal */}
      <Modal
        open={showDeleteAccountConfirm}
        onClose={() => {
          if (!deletingAccount && !reauthenticating) {
            setShowDeleteAccountConfirm(false);
          }
        }}
        title="Delete your account?"
        description="This will permanently delete your account, fit profiles, wishlist, and saved try-ons. This action CANNOT be undone."
        actions={
          <>
            <Button variant="secondary" fullWidth onClick={() => setShowDeleteAccountConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                setShowDeleteAccountConfirm(false);
                setReauthError('');
                setReauthPassword('');
                setShowReauthModal(true);
              }}
            >
              Continue to verification
            </Button>
          </>
        }
      />

      {/* 2. Secure Reauthentication Modal */}
      <Modal
        open={showReauthModal}
        onClose={() => {
          if (!reauthenticating) {
            setShowReauthModal(false);
            setReauthPassword('');
            setReauthError('');
          }
        }}
        title="Verify your identity"
        description="For your security, please verify your identity before deleting your account."
        actions={
          <div className="w-full flex flex-col gap-3">
            {auth.currentUser?.providerData.some(p => p.providerId === 'google.com') ? (
              <Button
                variant="primary"
                fullWidth
                loading={reauthenticating}
                onClick={async () => {
                  const currentUser = auth.currentUser;
                  if (!currentUser) return;
                  setReauthenticating(true);
                  setReauthError('');
                  const res = await reauthenticateGoogle(currentUser);
                  setReauthenticating(false);
                  if (res.success) {
                    setShowReauthModal(false);
                    setReauthenticated(true);
                    setShowFinalDeleteConfirm(true);
                  } else {
                    setReauthError(res.error || 'Google verification failed.');
                  }
                }}
              >
                Verify with Google
              </Button>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const currentUser = auth.currentUser;
                  if (!currentUser) return;
                  if (!reauthPassword) {
                    setReauthError('Please enter your current password.');
                    return;
                  }
                  setReauthenticating(true);
                  setReauthError('');
                  const passToVerify = reauthPassword;
                  setReauthPassword('');
                  const res = await reauthenticateEmail(currentUser, passToVerify);
                  setReauthenticating(false);
                  if (res.success) {
                    setShowReauthModal(false);
                    setReauthenticated(true);
                    setShowFinalDeleteConfirm(true);
                  } else {
                    setReauthError(res.error || 'Verification failed.');
                  }
                }}
                className="w-full flex flex-col gap-3"
              >
                <div className="w-full text-left">
                  <label className="eyebrow !text-[9px] mb-1.5 block">Current Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    aria-label="Current Password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full h-12 bg-surface-1 border border-line rounded-ctl px-4 text-ink font-medium text-[15px] outline-none focus:border-ink"
                    autoFocus
                  />
                </div>
                {reauthError && <p role="alert" className="text-[12.5px] font-medium text-danger text-center">{reauthError}</p>}
                <div className="flex gap-2.5 pt-2">
                  <Button variant="secondary" fullWidth disabled={reauthenticating} onClick={() => { setShowReauthModal(false); setReauthPassword(''); setReauthError(''); }}>Cancel</Button>
                  <Button type="submit" variant="danger" fullWidth loading={reauthenticating}>Verify & Proceed</Button>
                </div>
              </form>
            )}
            {auth.currentUser?.providerData.some(p => p.providerId === 'google.com') && reauthError && (
              <p role="alert" className="text-[12.5px] font-medium text-danger text-center">{reauthError}</p>
            )}
            {auth.currentUser?.providerData.some(p => p.providerId === 'google.com') && (
              <Button variant="secondary" fullWidth disabled={reauthenticating} onClick={() => { setShowReauthModal(false); setReauthError(''); }}>Cancel</Button>
            )}
          </div>
        }
      />

      {/* 3. Final Permanent Deletion Confirmation Modal */}
      <Modal
        open={showFinalDeleteConfirm}
        onClose={() => {
          if (!deletingAccount) {
            setShowFinalDeleteConfirm(false);
            setReauthenticated(false);
          }
        }}
        title="Final confirmation"
        description="Identity verified. Are you absolutely sure you want to permanently delete your ZipRIGHT account and all associated fit data?"
        actions={
          <>
            <Button variant="secondary" fullWidth disabled={deletingAccount} onClick={() => { setShowFinalDeleteConfirm(false); setReauthenticated(false); }}>Cancel</Button>
            <Button
              variant="danger"
              fullWidth
              loading={deletingAccount}
              onClick={async () => {
                const currentUser = auth.currentUser;
                if (!currentUser || !reauthenticated) {
                  showToast('Re-authentication required.', 'error');
                  setShowFinalDeleteConfirm(false);
                  return;
                }

                setDeletingAccount(true);
                let result;
                try {
                  result = await deleteAccountPermanently(currentUser);
                } catch (err: any) {
                  result = { success: false, error: err?.message || 'Unexpected deletion error.' };
                } finally {
                  setDeletingAccount(false);
                  setShowFinalDeleteConfirm(false);
                }

                if (!result.success) {
                  showToast(result.error || 'Failed to delete account.', 'error');
                  return;
                }

                // Deletion actually succeeded
                try {
                  const uid = currentUser.uid;
                  localStorage.removeItem(`zipright_fit_profile:${uid}`);
                  localStorage.removeItem('zipright_profile_photo');
                  localStorage.removeItem('zipright_role');
                  localStorage.removeItem('zipright_seller_status');
                  localStorage.removeItem('zipright_plan');
                } catch {}

                try { clearProfile(); } catch {}
                try { await auth.signOut(); } catch {}
                showToast('Your account has been permanently deleted.', 'info');
                navigate('/welcome', { replace: true });
              }}
            >
              Permanently delete
            </Button>
          </>
        }
      />

      {/* Premium Membership Sheet */}
      <Sheet open={showPremiumModal} onClose={() => setShowPremiumModal(false)} title="ZipRIGHT Premium">
        <div className="text-center mb-8 -mt-1">
          <span className="inline-block px-3 py-1 rounded-full bg-brand-soft text-brand text-[10px] font-semibold uppercase tracking-[0.14em] mb-3">Upgrade Now</span>
          <p className="text-[13px] text-ink-soft leading-relaxed max-w-xs mx-auto">Unlock advanced fit analysis and exclusive rewards for shoppers & sellers.</p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-8">
          <div className="flex bg-surface-2 p-1 rounded-full relative">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={cn('px-6 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors', billingCycle === 'monthly' ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-faint')}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={cn('px-6 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors flex items-center gap-1.5', billingCycle === 'yearly' ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-faint')}
            >
              Yearly
              <span className="text-[10px] bg-brass text-ink px-1.5 py-0.5 rounded-full">-16%</span>
            </button>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="flex flex-col gap-4">
          {plans.map((plan) => {
            if (!plan) return null;
            const isYearly = billingCycle === 'yearly';
            const monthlyRate = plan.monthlyPrice;

            const yearlyTotal = Math.round(monthlyRate * 12 * (1 - (plan.discountPercent / 100)));
            const priceToDisplay = isYearly ? yearlyTotal : monthlyRate;

            return (
              <div
                key={plan.name}
                className={cn('relative p-5 rounded-card border bg-surface-1 overflow-hidden', plan.popular ? 'border-brand' : 'border-line')}
              >
                {plan.popular && (
                  <div className="absolute top-0 right-0 bg-brand text-on-brand text-[9px] font-semibold uppercase tracking-[0.12em] px-3 py-1 rounded-bl-xl">
                    Most Popular
                  </div>
                )}

                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-display text-[20px] font-medium text-ink">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="font-display text-[26px] font-light text-ink">
                        {priceToDisplay === 0 ? 'Free' : `₹${priceToDisplay.toLocaleString()}`}
                      </span>
                      {priceToDisplay !== 0 && <span className="text-[12px] text-ink-faint">/{isYearly ? 'yr' : 'mo'}</span>}
                    </div>
                    {isYearly && (
                      <p className="text-[12px] font-medium text-success mt-1">
                        Save {plan.discountPercent}% (₹{Math.round(monthlyRate * 12 * (plan.discountPercent/100)).toLocaleString()})
                      </p>
                    )}
                  </div>
                  <div className={cn('h-10 w-10 rounded-full flex items-center justify-center', plan.color)}>
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">star</span>
                  </div>
                </div>

                <Divider className="mb-4" />

                <ul className="flex flex-col gap-2 mb-5">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-[13px] text-ink-soft">
                      <span className="material-symbols-outlined text-success text-[17px]" aria-hidden="true">check</span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  fullWidth
                  variant={plan.id === userPlan.id ? 'secondary' : plan.popular ? 'accent' : 'primary'}
                  disabled={plan.id === userPlan.id}
                  onClick={() => {
                    if (plan.id === userPlan.id) return;
                    handleSelectPlan(plan.planData);
                  }}
                >
                  {plan.id === userPlan.id ? 'Current Plan' : `Choose ${plan.name}`}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[12px] text-ink-faint mt-6">
          Recurring billing. Cancel anytime. Terms apply.
        </p>
      </Sheet>
    </div>
  );
};

export default Settings;
