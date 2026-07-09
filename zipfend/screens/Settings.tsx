import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { PLANS, getUserRole, setUserRole, getSellerStatus, setSellerStatus, getUserPlan } from '../utils/subscription';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import {
  getSellerMe,
  onboardSeller,
  getSellerProfile,
  updateSellerProfile,
  uploadSellerLogo,
  adminListSellers,
  adminSetSellerStatus,
  SellerProfile
} from '../services/ziprightApi';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function readDemoUser() {
  try {
    const raw = localStorage.getItem(DEMO_AUTH_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.uid === 'string' ? parsed : null;
  } catch {
    return null;
  }
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

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { userProfile, isHydrated, refreshProfile } = useUserProfile();
  
  const [view, setView] = useState<ViewState>('main');
  const [addressStep, setAddressStep] = useState<'map' | 'form'>('map');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  
  // Seller State
  const [userRole, setUserRoleState] = useState(getUserRole());
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
    auth.currentUser?.photoURL ||
    ((auth.currentUser as typeof auth.currentUser & { photoUrl?: string })?.photoUrl ?? '') ||
    'https://picsum.photos/seed/profile/200/200'
  );
  
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
    if (!user && !readDemoUser()) {
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
        const demoUser = readDemoUser();
        
        if (!user && !demoUser) {
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

        if (user && !user.isAnonymous && !demoUser) {
            try {
                // Sync Admin role
                try {
                    const adminDoc = await getDoc(doc(db, 'admins', user.uid));
                    if (adminDoc.exists() && adminDoc.data()?.status === 'active') {
                        setUserRole('admin');
                        setUserRoleState('admin');
                    }
                } catch (err) {
                    console.warn('[Settings] Failed to fetch admin doc:', err);
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
                    const profileName = typeof data?.profileName === 'string' ? data.profileName : '';
                    const [firstName = '', ...lastNameParts] = profileName.split(' ').filter(Boolean);
                    const u = {
                        firstName,
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
                    if (user.photoURL) setProfileImage(user.photoURL);
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

                setAddresses([]);

            } catch (error) {
                console.error("Error loading settings data:", error);
            }
        } else if (demoUser || user?.isAnonymous) {
            const savedProfile = await refreshProfile();
            const u = {
                firstName: savedProfile.profileName ? savedProfile.profileName.split(' ')[0] : 'ZipRIGHT',
                lastName: savedProfile.profileName ? savedProfile.profileName.split(' ').slice(1).join(' ') : 'Demo',
                email: '',
                phone: demoUser?.phoneNumber || user?.phoneNumber || '',
                gender: savedProfile.gender || 'Male',
                dob: '',
                planId: 'free',
                zipPoints: 0
            };
            setUserData(u);
            setEditUserData(u);
            setMembers(buildMembersFromProfile(savedProfile));
            setAddresses([]);
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
      city: 'Bengaluru',
      state: 'Karnataka',
      zip: '',
      isDefault: false,
      coords: { lat: 12.9716, lng: 77.5946 }
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
        navigate('/home');
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
    if (event.target.files && event.target.files[0]) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          const base64 = e.target.result as string;
          setProfileImage(base64);
          showToast('Profile image preview updated for this session.', 'success');
        }
      };
      reader.readAsDataURL(event.target.files[0]);
    }
  };

  const saveUserProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
          const profileName = [editUserData.firstName.trim(), editUserData.lastName.trim()].filter(Boolean).join(' ');
          await setDoc(doc(db, 'users', user.uid), {
              profileName,
              gender: editUserData.gender,
          }, { merge: true });
          setUserData(editUserData);

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
              return [...withoutCurrent, nextAddress];
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
          setAddresses(addresses.filter(a => a.id !== id));
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
              await setDoc(doc(db, 'users', auth.currentUser.uid), {
                  profileName: '',
                  gender: '',
                  preferredBrand: '',
                  usualSize: '',
                  height: 0,
                  weight: 0,
                  bodyShape: '',
                  fitPreference: '',
                  smartFit: {}
              }, { merge: true });
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
    showToast('Permission Updated.', 'success');
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
      color: 'bg-gray-400',
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
      color: 'bg-blue-500',
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
      color: 'bg-purple-500',
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
      color: 'bg-black dark:bg-white',
      planData: PLANS.ELITE
    }
  ];

  // --- VIEW: SELLER APPLY ---
  if (view === 'seller-apply') {
    return (
      <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
        <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
          <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
          <h2 className="text-lg font-bold text-[#6157FF]">Seller Application</h2>
          <div className="w-8"></div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
          <div className="flex flex-col gap-6">
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Brand / Store Name *</label>
              <input 
                type="text" 
                value={sellerFormData.brandName}
                onChange={(e) => setSellerFormData({...sellerFormData, brandName: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="e.g. ZipStyle"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Person Name *</label>
              <input 
                type="text" 
                value={sellerFormData.contactName}
                onChange={(e) => setSellerFormData({...sellerFormData, contactName: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Email *</label>
              <input 
                type="email" 
                value={sellerFormData.email}
                onChange={(e) => setSellerFormData({...sellerFormData, email: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="seller@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Phone *</label>
              <input 
                type="text" 
                value={sellerFormData.phone}
                onChange={(e) => setSellerFormData({...sellerFormData, phone: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="e.g. +91 90000 00000"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Website or Store Link</label>
              <input 
                type="text" 
                value={sellerFormData.storeLink}
                onChange={(e) => setSellerFormData({...sellerFormData, storeLink: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="https://yourstore.com"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Tax ID / GSTIN (Optional)</label>
              <input 
                type="text" 
                value={sellerFormData.taxId}
                onChange={(e) => setSellerFormData({...sellerFormData, taxId: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                placeholder="e.g. 29AAAAA0000A1Z5"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Brand Description / Story (Optional)</label>
              <textarea 
                value={sellerFormData.brandDescription}
                onChange={(e) => setSellerFormData({...sellerFormData, brandDescription: e.target.value})}
                className="w-full h-24 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 py-3 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] resize-none"
                placeholder="Describe your brand and products..."
              />
            </div>
            <div className="pt-6 pb-8 flex flex-col gap-3">
              <p className="text-[12px] text-[#555555] dark:text-ink-soft font-bold text-center leading-tight">By submitting, you agree to the ZipRIGHT Seller Terms of Use.</p>
              <button onClick={handleSellerApply} className="w-full h-14 rounded-2xl bg-surface-0 text-ink dark:bg-white dark:text-[#111111] font-bold text-lg shadow-xl active:scale-95">Submit Application</button>
            </div>
          </div>
        </div>
      </div>
    );
  }


  // --- VIEW: EDIT PROFILE ---
  if (view === 'edit-profile') {
      return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
            <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
            <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
            <h2 className="text-lg font-bold text-[#6157FF]">Edit Profile</h2>
            <div className="w-8"></div>
        </div>
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
                <div className="flex flex-col items-center mb-8">
                    <div className="relative cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                        <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-black/5 dark:border-line">
                            <img src={profileImage} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                        </div>
                        <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0">
                            <span className="material-symbols-outlined text-ink">edit</span>
                        </div>
                        <div className="absolute bottom-0 right-0 bg-surface-0 dark:bg-white text-ink dark:text-[#111111] h-8 w-8 rounded-full flex items-center justify-center border-2 border-[#FAF9F6] dark:border-[#121212]">
                            <span className="material-symbols-outlined text-sm">photo_camera</span>
                        </div>
                    </div>
                    <p className="text-xs font-bold text-[#6157FF] dark:text-[#6157FF] mt-3 tracking-wide">Change Photo</p>
                </div>

                <div className="flex flex-col gap-6">
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">First Name</label>
                        <input 
                            type="text" 
                            value={editUserData.firstName} 
                            onChange={(e) => setEditUserData({...editUserData, firstName: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Last Name</label>
                        <input 
                            type="text" 
                            value={editUserData.lastName} 
                            onChange={(e) => setEditUserData({...editUserData, lastName: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Email Address</label>
                        <input 
                            type="email" 
                            value={editUserData.email} 
                            onChange={(e) => setEditUserData({...editUserData, email: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Phone Number</label>
                        <input 
                            type="tel" 
                            value={editUserData.phone} 
                            onChange={(e) => setEditUserData({...editUserData, phone: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                        />
                    </div>
                    
                    {/* Gender Radio Buttons */}
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-3 block">Gender</label>
                        <div className="flex gap-6">
                            {['Male', 'Female', 'Other'].map((g) => (
                                <label key={g} className="flex items-center gap-2 cursor-pointer group">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${editUserData.gender === g ? 'border-surface-0 dark:border-white' : 'border-black/10 dark:border-line'}`}>
                                        {editUserData.gender === g && <div className="w-2.5 h-2.5 rounded-full bg-surface-0 dark:bg-white"></div>}
                                    </div>
                                    <input 
                                        type="radio" 
                                        name="gender" 
                                        value={g} 
                                        checked={editUserData.gender === g} 
                                        onChange={(e) => setEditUserData({...editUserData, gender: e.target.value})}
                                        className="hidden"
                                    />
                                    <span className={`font-bold text-sm ${editUserData.gender === g ? 'text-[#111111] dark:text-ink' : 'text-[#555555] dark:text-ink-soft'}`}>{g}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Date of Birth */}
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Date of Birth <span className="text-[#555555]/60 dark:text-ink-soft/60 normal-case tracking-normal">(Optional)</span></label>
                        <input 
                            type="date" 
                            value={editUserData.dob} 
                            onChange={(e) => setEditUserData({...editUserData, dob: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                            style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                        />
                    </div>

                    {/* Save Button in Scroll View */}
                    <div className="pt-6 pb-8">
                        <button onClick={saveUserProfile} className="w-full h-14 rounded-2xl bg-surface-0 text-ink dark:bg-white dark:text-[#111111] font-bold text-lg shadow-xl active:scale-95">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: EDIT ADDRESS ---
  if (view === 'edit-address') {
    return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
            {addressStep === 'map' && (
                <div className="relative flex-1 flex flex-col animate-in fade-in duration-300">
                    <div className="absolute top-0 left-0 right-0 z-10 flex items-center p-4">
                        <button aria-label="Go back" onClick={() => setView('addresses')} className="h-10 w-10 rounded-full bg-white dark:bg-surface-1 shadow-lg flex items-center justify-center border border-black/5 dark:border-line text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
                    </div>
                    <div className="flex-1 bg-gray-200 dark:bg-gray-800 relative">
                         <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                             <div className="flex flex-col items-center mb-8 drop-shadow-2xl">
                                 <div className="px-3 py-1 bg-surface-0 dark:bg-white text-ink dark:text-[#111111] text-[12px] font-bold rounded-lg mb-1 animate-bounce">I'm here</div>
                                 <span className="material-symbols-outlined text-4xl text-[#6157FF] dark:text-[#6157FF] filled" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
                             </div>
                         </div>
                    </div>
                    <div className="absolute bottom-40 right-4 flex flex-col gap-3">
                        <button onClick={useCurrentLocation} className="h-12 w-12 rounded-full bg-white dark:bg-surface-1 shadow-xl flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">my_location</span></button>
                    </div>
                    <div className="bg-white dark:bg-surface-1 rounded-t-[2.5rem] p-6 shadow-2xl z-20 border-t border-black/5 dark:border-line">
                        <div className="flex items-start gap-4 mb-6">
                            <span className="material-symbols-outlined text-[#6157FF] dark:text-[#6157FF] text-3xl mt-1">location_on</span>
                            <div>
                                <h3 className="text-xl font-bold text-[#111111] dark:text-ink">{editAddressData.area || 'Select Location'}</h3>
                                <p className="text-sm text-[#555555] dark:text-ink-soft font-medium leading-relaxed mt-1">{editAddressData.city}, {editAddressData.state}</p>
                            </div>
                        </div>
                        <button onClick={() => setAddressStep('form')} className="w-full h-14 rounded-2xl bg-surface-0 text-ink dark:bg-white dark:text-[#111111] font-bold text-lg shadow-xl active:scale-95">Confirm & Proceed</button>
                    </div>
                </div>
            )}
            {addressStep === 'form' && (
                <div className="flex flex-col flex-1 bg-[#FAF9F6] dark:bg-surface-0 animate-in slide-in-from-right duration-300 overflow-y-auto no-scrollbar">
                    <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
                        <button aria-label="Go back" onClick={() => setAddressStep('map')} className="material-symbols-outlined p-2 -ml-2 rounded-full transition-colors text-[#6157FF]">arrow_back</button>
                        <h2 className="text-lg font-bold text-[#6157FF]">Edit Address</h2>
                        <button onClick={saveAddress} className="text-[#6157FF] dark:text-[#6157FF] font-bold text-sm">SAVE</button>
                    </div>
                    <div className="p-6 flex flex-col gap-8 pb-32">
                         <div className="flex flex-col gap-6">
                            <div className="border-b border-black/10 dark:border-line">
                                <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">FULL NAME</label>
                                <input type="text" value={editAddressData.name} onChange={(e) => setEditAddressData({...editAddressData, name: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter recipient name" />
                            </div>
                            <div className="border-b border-black/10 dark:border-line">
                                <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">PHONE NUMBER</label>
                                <input type="tel" value={editAddressData.phone} onChange={(e) => setEditAddressData({...editAddressData, phone: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter 10-digit number" />
                            </div>
                            <div className="border-b border-black/10 dark:border-line">
                                <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">HOUSE / FLAT / BLOCK NO.</label>
                                <input type="text" value={editAddressData.houseNo} onChange={(e) => setEditAddressData({...editAddressData, houseNo: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter details" />
                            </div>
                            <div className="border-b border-black/10 dark:border-line">
                                <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">APARTMENT / ROAD / AREA</label>
                                <input type="text" value={editAddressData.area} onChange={(e) => setEditAddressData({...editAddressData, area: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter details" />
                            </div>
                            <div className="border-b border-black/10 dark:border-line">
                                <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">LANDMARK (OPTIONAL)</label>
                                <input type="text" value={editAddressData.landmark} onChange={(e) => setEditAddressData({...editAddressData, landmark: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="e.g. Near Central Mall" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="border-b border-black/10 dark:border-line">
                                    <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">CITY</label>
                                    <input type="text" value={editAddressData.city} onChange={(e) => setEditAddressData({...editAddressData, city: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter city" />
                                </div>
                                <div className="border-b border-black/10 dark:border-line">
                                    <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft">ZIP CODE</label>
                                    <input type="text" value={editAddressData.zip} onChange={(e) => setEditAddressData({...editAddressData, zip: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-ink" placeholder="Enter zip" />
                                </div>
                            </div>
                         </div>
                         <div className="flex flex-col gap-4">
                            <label className="text-[12px] font-bold text-[#555555] dark:text-ink-soft">SAVE AS</label>
                            <div className="flex flex-wrap gap-2">
                                {['Home', 'Work', 'Friends', 'Other'].map((type) => (
                                    <button key={type} onClick={() => setEditAddressData({...editAddressData, type: type as any})} className={`px-5 py-2 rounded-full text-xs font-bold transition-all border ${editAddressData.type === type ? 'bg-[#6157FF] text-ink border-transparent' : 'bg-white dark:bg-surface-1 text-[#555555] dark:text-ink-soft border-black/5 dark:border-line'}`}>{type}</button>
                                ))}
                            </div>
                         </div>
                         <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setEditAddressData({...editAddressData, isDefault: !editAddressData.isDefault})}
                                className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${editAddressData.isDefault ? 'bg-[#6157FF] dark:bg-[#6157FF]' : 'bg-black/10 dark:bg-surface-2'}`}
                            >
                                <div className={`w-4 h-4 bg-white dark:bg-surface-0 rounded-full shadow-sm transition-transform ${editAddressData.isDefault ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </button>
                            <span className="text-xs font-bold text-[#555555] dark:text-ink-soft">Make this my default address</span>
                         </div>
                    </div>
                    <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-t border-black/5 dark:border-line z-30 max-w-md mx-auto">
                        <button onClick={saveAddress} className="w-full h-14 rounded-2xl bg-[#6157FF] dark:bg-[#6157FF] text-ink dark:text-[#111111] font-bold text-lg shadow-xl shadow-[#6157FF]/20 active:scale-95 transition-all">Save Address</button>
                    </div>
                </div>
            )}
        </div>
    );
  }

  // --- VIEW: ADDRESSES LIST ---
  if (view === 'addresses') {
      return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
             <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
                <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
                <h2 className="text-lg font-bold text-[#6157FF]">Saved Addresses</h2>
                <button onClick={openAddAddress} className="text-[#6157FF] dark:text-[#6157FF] font-bold text-sm">ADD NEW</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-20 no-scrollbar">
                <div className="flex flex-col gap-4">
                    {addresses.map((addr) => {
                        if (!addr) return null;
                        const typeColors = {
                            Home: 'bg-[#6157FF]/10 text-[#6157FF] dark:bg-[#6157FF]/10 dark:text-[#6157FF]',
                            Work: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                            Friends: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
                            Other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        };
                        return (
                        <div key={addr.id} className="flex flex-col p-5 rounded-[2rem] bg-white dark:bg-surface-1 border border-black/5 dark:border-line shadow-sm relative group">
                            <div className="flex justify-between items-start mb-2">
                                <span className={`px-3 py-1 rounded-lg text-[12px] font-bold ${typeColors[addr.type] || typeColors.Other}`}>{addr.type}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => openEditAddress(addr)} className="h-8 w-8 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] transition-colors"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                    <button onClick={() => setShowDeleteAddressConfirm(addr.id)} className="h-8 w-8 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-red-500 transition-colors"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-base mb-1 text-[#111111] dark:text-ink">{addr.name}</h3>
                            <p className="text-sm text-[#555555] dark:text-ink-soft leading-relaxed">{addr.houseNo}, {addr.area}</p>
                            <p className="text-sm text-[#555555] dark:text-ink-soft leading-relaxed">{addr.city}, {addr.state} - {addr.zip}</p>
                            <p className="text-xs text-[#555555]/60 dark:text-ink-soft/60 mt-2 font-mono">{addr.phone}</p>
                        </div>
                        );
                    })}
                    {addresses.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 opacity-50">
                            <span className="material-symbols-outlined text-4xl mb-2">location_off</span>
                            <p className="font-bold text-sm">No saved addresses</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Address Confirmation Modal */}
            {showDeleteAddressConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
                    <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
                        <h3 className="text-xl font-bold text-black dark:text-ink mb-2">Delete Address?</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-6">Are you sure you want to delete this address? This action cannot be undone.</p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowDeleteAddressConfirm(null)}
                                className="flex-1 py-3 rounded-2xl bg-gray-100 dark:bg-surface-2 text-black dark:text-ink font-bold active:scale-95 transition-all"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => deleteAddress(showDeleteAddressConfirm)}
                                className="flex-1 py-3 rounded-2xl bg-red-500 text-ink font-bold active:scale-95 transition-all"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
      );
  }

  // --- VIEW: MANAGE FITS ---
  if (view === 'manage-fits') {
      return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
             <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
                <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-12 w-12 -ml-2 rounded-full transition-colors text-[#6157FF]">
                    <span className="material-symbols-outlined text-2xl">arrow_back</span>
                </button>
                <h2 className="text-xl font-bold tracking-tight text-[#6157FF]">Manage Profiles</h2>
                <div className="w-10"></div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-20 no-scrollbar">
                <div className="flex flex-col gap-5">
                    {members.map(member => (
                        <div 
                            key={member.id} 
                            onClick={() => navigate('/fit-profile', { state: { mode: 'edit', memberId: member.id } })}
                            className="flex items-center justify-between p-6 rounded-[2rem] bg-white dark:bg-surface-1 border border-black/5 dark:border-line shadow-sm cursor-pointer active:scale-[0.98] transition-all"
                        >
                            <div className="flex items-center gap-5">
                                <div className="h-14 w-14 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line">
                                    <span className="material-symbols-outlined text-2xl">person</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-[#111111] dark:text-ink leading-tight">{member.name}</h3>
                                    <p className="text-sm text-[#555555] dark:text-ink-soft font-bold mt-1">
                                        {member.fitData?.heightFt}'{member.fitData?.heightIn}" • {member.fitData?.weight}kg
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate('/fit-profile', { state: { mode: 'edit', memberId: member.id } });
                                    }}
                                    className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                                {!member.isPrimary && (
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeleteMemberConfirm(member.id);
                                        }}
                                        className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-red-500 transition-colors"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">delete</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    
                    {/* Delete Member Confirmation Modal */}
                    {showDeleteMemberConfirm && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
                            <div className="w-full max-w-sm rounded-[2rem] bg-white dark:bg-surface-1 p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
                                <h3 className="text-xl font-bold text-[#111111] dark:text-ink mb-2">Delete Profile?</h3>
                                <p className="text-[#555555] dark:text-ink-soft mb-6">Are you sure you want to delete this fit profile? This action cannot be undone.</p>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setShowDeleteMemberConfirm(null)}
                                        className="flex-1 py-3 rounded-2xl bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-bold active:scale-95 transition-all border border-black/5 dark:border-line"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={() => deleteMember(showDeleteMemberConfirm)}
                                        className="flex-1 py-3 rounded-2xl bg-red-500 text-ink font-bold active:scale-95 transition-all"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    
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
                                className={`flex items-center justify-center gap-3 p-8 rounded-[2rem] border-2 border-dashed transition-all ${
                                    isLimitReached 
                                    ? 'border-black/10 dark:border-line text-[#555555]/40 dark:text-ink-soft/40 bg-black/5 dark:bg-surface-2' 
                                    : 'border-black/10 dark:border-line text-[#555555] dark:text-ink-soft font-bold'
                                }`}
                            >
                                <span className="material-symbols-outlined text-2xl">{isLimitReached ? 'lock' : 'add_circle'}</span>
                                <span className="text-lg">Add New Profile</span>
                                {isLimitReached && (
                                    <div className="ml-1 flex items-center gap-1 bg-[#6157FF] text-ink px-2 py-1 rounded-lg">
                                        <span className="material-symbols-outlined text-[12px]">verified</span>
                                        <span className="text-[12px] font-bold tracking-tighter">UPGRADE</span>
                                    </div>
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
        { id: 'camera', title: 'Camera', icon: 'camera', desc: 'Required for AI body scanning.' },
        { id: 'location', title: 'Location', icon: 'location_on', desc: 'Used to find nearby delivery hubs.' },
        { id: 'contacts', title: 'Contacts', icon: 'group', desc: 'Connect with style friends.' },
        { id: 'microphone', title: 'Microphone', icon: 'mic', desc: 'Voice search and assistant.' },
        { id: 'notifications', title: 'Notifications', icon: 'notifications', desc: 'Stay updated on orders and fits.' }
    ];

    return (
      <div className="flex flex-col min-h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans relative overflow-x-hidden">
        <div className="sticky top-0 z-50 flex items-center gap-4 px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
          <button aria-label="Go back" onClick={() => setView('main')} className="material-symbols-outlined p-2 -ml-2 rounded-full text-[#6157FF]">arrow_back</button>
          <h2 className="text-lg font-bold text-[#6157FF]">Permissions</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 no-scrollbar">
             <div className="flex flex-col gap-3">
                {permissionsList.map(p => {
                     const isAllowed = permissionsState[p.id as keyof typeof permissionsState];
                     return (
                        <div key={p.id} className="flex items-start gap-4 p-5 bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line shadow-sm">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isAllowed ? 'bg-[#6157FF]/10 dark:bg-[#6157FF]/10' : 'bg-[#FAF9F6] dark:bg-surface-0'}`}>
                                <span className={`material-symbols-outlined ${isAllowed ? 'text-[#6157FF] dark:text-[#6157FF]' : 'text-[#555555] dark:text-ink-soft'}`}>{p.icon}</span>
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-sm text-[#111111] dark:text-ink">{p.title}</p>
                                <p className="text-[11px] text-[#555555] dark:text-ink-soft mt-1 leading-relaxed">{p.desc}</p>
                            </div>
                            <button onClick={() => togglePermission(p.id)} className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${isAllowed ? 'bg-[#6157FF] dark:bg-[#6157FF]' : 'bg-black/10 dark:bg-surface-2'}`}>
                                <div className={`w-4 h-4 bg-white dark:bg-surface-0 rounded-full shadow-sm transition-transform ${isAllowed ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </button>
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
        <div className="flex flex-col min-h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans relative overflow-x-hidden">
            <div className="sticky top-0 z-50 flex items-center gap-4 px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
                <button aria-label="Go back" onClick={() => setView('main')} className="material-symbols-outlined p-2 -ml-2 rounded-full text-[#6157FF]">arrow_back</button>
                <h2 className="text-lg font-bold text-[#6157FF]">App Settings</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 no-scrollbar">
                <div className="flex flex-col gap-6">
                    <div>
                        <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Notifications</h3>
                        <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                            <div className="flex items-center justify-between p-5">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#6157FF]/10 dark:bg-[#6157FF]/10 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF]">
                                        <span className="material-symbols-outlined">notifications</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-[#111111] dark:text-ink">Push Notifications</p>
                                        <p className="text-[11px] text-[#555555] dark:text-ink-soft mt-0.5">Alerts for orders and fits.</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => togglePermission('notifications')}
                                    className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${permissionsState.notifications ? 'bg-[#6157FF] dark:bg-[#6157FF]' : 'bg-black/10 dark:bg-surface-2'}`}
                                >
                                    <div className={`w-4 h-4 bg-white dark:bg-surface-0 rounded-full shadow-sm transition-transform ${permissionsState.notifications ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: SELLER PROFILE (EDIT/VIEW BRAND DETAILS) ---
  if (view === 'seller-profile') {
    return (
      <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
        <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
          <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
          <h2 className="text-lg font-bold text-[#6157FF]">Seller Profile & Settings</h2>
          <div className="w-8"></div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
          <div className="flex flex-col gap-6">
            
            {/* Logo Upload Section */}
            <div className="flex flex-col items-center gap-4 bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm">
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft text-center">Brand Logo</label>
              <div className="relative group cursor-pointer" onClick={() => {
                const el = document.getElementById('logo-file-input');
                el?.click();
              }}>
                <div className="h-24 w-24 rounded-full overflow-hidden border-[3px] border-[#FAF9F6] dark:border-[#121212] shadow-md bg-gray-100 dark:bg-black flex items-center justify-center">
                  {sellerProfile?.brand_logo_url ? (
                    <img src={sellerProfile.brand_logo_url} alt="Logo" className="h-full w-full object-cover"/>
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-[#6157FF]">storefront</span>
                  )}
                </div>
                {logoUploading && (
                  <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center">
                    <span className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  </div>
                )}
                <div className="absolute bottom-0 right-0 bg-surface-0 dark:bg-white text-ink dark:text-[#111111] h-7 w-7 rounded-full flex items-center justify-center border-[2px] border-[#FAF9F6] dark:border-[#121212] shadow-md">
                  <span className="material-symbols-outlined text-[14px] font-bold">upload</span>
                </div>
              </div>
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
              <p className="text-[12px] text-[#555555] dark:text-ink-soft font-medium text-center">Supports PNG, JPG, or WebP. Max 5MB.</p>
            </div>

            {/* Business Info Form */}
            <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-6">
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Brand Name</label>
                <input 
                  type="text" 
                  value={sellerFormData.brandName}
                  onChange={(e) => setSellerFormData({...sellerFormData, brandName: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Person Name</label>
                <input 
                  type="text" 
                  value={sellerFormData.contactName}
                  onChange={(e) => setSellerFormData({...sellerFormData, contactName: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Email</label>
                <input 
                  type="email" 
                  value={sellerFormData.email}
                  onChange={(e) => setSellerFormData({...sellerFormData, email: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Contact Phone</label>
                <input 
                  type="text" 
                  value={sellerFormData.phone}
                  onChange={(e) => setSellerFormData({...sellerFormData, phone: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Website Link</label>
                <input 
                  type="text" 
                  value={sellerFormData.storeLink}
                  onChange={(e) => setSellerFormData({...sellerFormData, storeLink: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">GSTIN / Tax ID</label>
                <input 
                  type="text" 
                  value={sellerFormData.taxId}
                  onChange={(e) => setSellerFormData({...sellerFormData, taxId: e.target.value})}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Brand Description / Story</label>
                <textarea 
                  value={sellerFormData.brandDescription}
                  onChange={(e) => setSellerFormData({...sellerFormData, brandDescription: e.target.value})}
                  className="w-full h-24 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 py-3 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] resize-none"
                />
              </div>
              
              <button 
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
                className="w-full h-14 bg-surface-0 text-ink dark:bg-white dark:text-[#111111] rounded-2xl font-bold text-sm active:scale-95 shadow-md animate-in duration-300"
              >
                Save Changes
              </button>
            </div>
            
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: ADMIN PENDING APPROVALS ---
  if (view === 'admin-approvals') {
    return (
      <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden">
        <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
          <button aria-label="Go back" onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined">arrow_back</span></button>
          <h2 className="text-lg font-bold text-[#6157FF]">Seller Applications</h2>
          <div className="w-8"></div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
          {pendingSellers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#555555] dark:text-ink-soft">
              <span className="material-symbols-outlined text-5xl mb-3 animate-bounce">check_circle</span>
              <p className="font-bold text-sm">All caught up! No pending applications.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {pendingSellers.map((seller) => (
                <div key={seller.uid} className="bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line flex items-center justify-center text-[#6157FF] dark:text-[#6157FF]">
                      <span className="material-symbols-outlined">storefront</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#111111] dark:text-ink">{seller.store_name}</h4>
                      <p className="text-[12px] text-[#555555] dark:text-ink-soft mt-0.5">UID: {seller.uid}</p>
                    </div>
                  </div>
                  
                  <div className="h-[1px] bg-black/5 dark:bg-surface-2"></div>
                  
                  <div className="grid grid-cols-1 gap-2.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#555555] dark:text-ink-soft font-bold">Contact</span>
                      <span className="font-bold text-[#111111] dark:text-ink">{seller.contact_name}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#555555] dark:text-ink-soft font-bold">Email</span>
                      <span className="font-bold text-[#111111] dark:text-ink">{seller.email}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#555555] dark:text-ink-soft font-bold">Phone</span>
                      <span className="font-bold text-[#111111] dark:text-ink">{seller.phone}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#555555] dark:text-ink-soft font-bold">Website</span>
                      <span className="font-bold text-[#111111] dark:text-ink truncate max-w-[180px]">{seller.website || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#555555] dark:text-ink-soft font-bold">GSTIN</span>
                      <span className="font-bold text-[#111111] dark:text-ink">{seller.gst || 'N/A'}</span>
                    </div>
                    {seller.brand_description && (
                      <div className="flex flex-col gap-1 mt-1 text-xs">
                        <span className="text-[#555555] dark:text-ink-soft font-bold">Description</span>
                        <p className="p-3 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl font-bold text-[#111111] dark:text-ink leading-relaxed">{seller.brand_description}</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="h-[1px] bg-black/5 dark:bg-surface-2 mt-2"></div>
                  
                  <div className="flex gap-3">
                    <button 
                      onClick={() => {
                        setAdminActionTarget(seller);
                        setAdminReason('');
                      }}
                      className="flex-1 py-3 rounded-2xl bg-red-100 dark:bg-red-950/20 text-red-500 font-bold active:scale-95 transition-all text-xs"
                    >
                      Reject
                    </button>
                    <button 
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
                      className="flex-1 py-3 rounded-2xl bg-green-500 text-ink font-bold active:scale-95 transition-all text-xs"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reject Dialog */}
        {adminActionTarget && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
            <div className="w-full max-w-sm rounded-[2rem] bg-white dark:bg-surface-1 p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
              <h3 className="text-xl font-bold text-[#111111] dark:text-ink mb-2">Reject Application</h3>
              <p className="text-xs text-[#555555] dark:text-ink-soft mb-4">Provide a reason for rejecting the application for {adminActionTarget.store_name}:</p>
              
              <textarea 
                value={adminReason}
                onChange={(e) => setAdminReason(e.target.value)}
                placeholder="e.g. Invalid GSTIN, incomplete business proof..."
                className="w-full h-24 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] resize-none mb-6 text-[#111111] dark:text-ink"
              />

              <div className="flex gap-3">
                <button 
                  onClick={() => setAdminActionTarget(null)}
                  className="flex-1 py-3 rounded-2xl bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-bold active:scale-95 transition-all border border-black/5 dark:border-line text-xs"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
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
                  className="flex-1 py-3 rounded-2xl bg-red-500 text-ink font-bold active:scale-95 transition-all text-xs"
                >
                  Yes, Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- MAIN VIEW ---
  return (
    <div className="relative flex h-full min-h-screen w-full flex-col bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-x-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>
      
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line">
        <button aria-label="Go back" onClick={() => navigate('/home')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"><span className="material-symbols-outlined text-[24px]">arrow_back</span></button>
        <h2 className="text-lg font-bold text-[#6157FF]">Profile & Settings</h2>
        <div className="w-8"></div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar">
        {/* Profile Card */}
        <div className="px-6 py-6">
            <div className="relative p-8 bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line shadow-sm overflow-hidden group">
                 
                 {/* Decorative Background Blobs */}
                 <div className="absolute top-[-20%] right-[-10%] w-48 h-48 bg-[#6157FF]/10 rounded-full blur-[60px] pointer-events-none"></div>
                 <div className="absolute bottom-[-10%] left-[-5%] w-32 h-32 bg-[#6157FF]/10 rounded-full blur-[40px] pointer-events-none"></div>

                 <div className="relative z-10 flex items-center gap-4">
                    {/* Profile Image - Smaller */}
                    <div className="relative shrink-0 cursor-pointer group/img" onClick={() => fileInputRef.current?.click()}>
                        <div className="h-20 w-20 rounded-full overflow-hidden border-[3px] border-[#FAF9F6] dark:border-[#121212] shadow-sm transition-all duration-500">
                            <img src={profileImage} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                        </div>
                         <div className="absolute bottom-0 right-0 bg-surface-0 dark:bg-white text-ink dark:text-[#111111] h-7 w-7 rounded-full flex items-center justify-center border-[2px] border-[#FAF9F6] dark:border-[#121212] shadow-md transition-all duration-300">
                            <span className="material-symbols-outlined text-[14px] font-bold">edit</span>
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-[#111111] dark:text-ink leading-tight tracking-tight truncate">
                                {userData.firstName} {userData.lastName}
                            </h2>
                            <button 
                                onClick={() => {
                                    setEditUserData(userData);
                                    setView('edit-profile');
                                }}
                                className="text-[#555555] dark:text-ink-soft transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                        </div>
                        <p className="text-xs font-bold text-[#555555] dark:text-ink-soft mt-0.5 truncate opacity-80">
                            {userData.email}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                             {sellerStatus === 'active' && (
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleUserRole();
                                    }}
                                    className="inline-flex items-center justify-center gap-1.5 bg-[#FAF9F6] dark:bg-surface-0 px-3 py-1.5 rounded-full shadow-sm active:scale-95 transition-all border border-black/5 dark:border-line"
                                >
                                    <span className="material-symbols-outlined text-[#111111] dark:text-ink text-[12px]">swap_horiz</span>
                                    <span className="text-[12px] font-bold text-[#111111] dark:text-ink">
                                        {userRole === 'user' ? 'Seller Mode' : 'User Mode'}
                                    </span>
                                </button>
                            )}

                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowPremiumModal(true);
                                }}
                                className="inline-flex items-center justify-center gap-1.5 bg-gradient-to-r from-[#6157FF] to-[#6157FF] px-3 py-1.5 rounded-full shadow-lg shadow-[#6157FF]/20 active:scale-95 transition-all"
                            >
                                <span className="material-symbols-outlined text-ink text-[12px] filled" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                                <span className="text-[12px] font-bold text-ink">Premium</span>
                            </button>
                        </div>
                    </div>
                 </div>
            </div>
        </div>

        {/* Wallet Section */}
        {userRole !== 'seller' && (
            <div className="px-6 mb-2">
                <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Wallet & Rewards</h3>
                <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between p-6 bg-gradient-to-r from-[#6157FF] to-[#6157FF] text-ink">
                        <div>
                            <p className="text-xs font-bold opacity-90 tracking-wide">ZipCoins Balance</p>
                            <h2 className="text-3xl font-bold mt-1">{userData.zipPoints}</h2>
                        </div>
                        <div className="h-12 w-12 rounded-full bg-surface-3 backdrop-blur-md flex items-center justify-center">
                            <span className="material-symbols-outlined text-2xl filled" style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
                        </div>
                    </div>
                    
                    {!showRedeemInput ? (
                        <div onClick={() => {
                            if (userData.zipPoints < 100) {
                                showToast("Minimum 100 ZipCoins required to redeem.", "error");
                                return;
                            }
                            setShowRedeemInput(true);
                        }} className="flex items-center gap-4 p-4 cursor-pointer transition-colors border-b border-black/5 dark:border-line">
                            <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">payments</span></div>
                            <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Redeem to Bank</div>
                            <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                        </div>
                    ) : (
                        <div className="p-6 bg-[#FAF9F6] dark:bg-surface-0 animate-in fade-in slide-in-from-top-2 duration-300 border-b border-black/5 dark:border-line">
                            <p className="text-[12px] font-bold text-[#555555] dark:text-ink-soft mb-3">Redeem ₹{(userData.zipPoints / 100).toFixed(2)}</p>
                            <input 
                                type="text"
                                value={redeemInput}
                                onChange={(e) => setRedeemInput(e.target.value)}
                                placeholder="Enter UPI ID (e.g., user@upi)"
                                className="w-full bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-all mb-4 text-[#111111] dark:text-ink"
                            />
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowRedeemInput(false)}
                                    className="flex-1 py-3 rounded-2xl text-[12px] font-bold text-[#555555] dark:text-ink-soft border border-black/5 dark:border-line bg-white dark:bg-surface-1"
                                >
                                    Cancel
                                </button>
                                <button 
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
                                    className="flex-[2] bg-surface-0 dark:bg-white text-ink dark:text-[#111111] py-3 rounded-2xl text-[12px] font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isRedeeming ? (
                                        <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                                    ) : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    )}
    
                    {/* Ways to Earn */}
                    <div className="p-6 bg-[#FAF9F6] dark:bg-surface-0">
                        <h4 className="text-[12px] font-bold text-[#555555] dark:text-ink-soft mb-4">Ways to Earn</h4>
                        <div className="space-y-3">
                            {[
                                { icon: 'shopping_bag', title: 'Shop & Earn', desc: 'Up to 5000 coins per order' },
                                { icon: 'group_add', title: 'Refer a Friend', desc: '500 coins per referral' },
                                { icon: 'rate_review', title: 'Write a Review', desc: '100 coins per review' }
                            ].map((item, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-white dark:bg-surface-1 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line shrink-0">
                                        <span className="material-symbols-outlined text-base">{item.icon}</span>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-[#111111] dark:text-ink leading-none">{item.title}</p>
                                        <p className="text-[12px] text-[#555555] dark:text-ink-soft mt-1">{item.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Seller Hub Section */}
        {userRole === 'seller' && (
            <div className="px-6 mb-2">
                <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Seller Hub</h3>
                <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                    <div onClick={() => setView('seller-profile')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-[#6157FF]/10 dark:border-[#6157FF]/10 shadow-sm shrink-0"><span className="material-symbols-outlined">storefront</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Seller Profile & Settings</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                    <div onClick={() => navigate('/seller/dashboard')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-[#6157FF]/10 dark:border-[#6157FF]/10 shadow-sm shrink-0"><span className="material-symbols-outlined">dashboard</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Seller Dashboard</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                </div>
            </div>
        )}

        {/* Seller Tools Section */}
        {userRole !== 'seller' && (
          <div className="px-6 mb-2 mt-6">
              <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Seller Tools</h3>
              <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                  {sellerStatus === 'none' && (
                      <div onClick={() => setView('seller-apply')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                          <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">storefront</span></div>
                          <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Apply to Become a Seller</div>
                          <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                      </div>
                  )}
                  {sellerStatus === 'pending' && (
                      <div className="p-6 bg-[#FAF9F6] dark:bg-surface-0 transition-colors">
                          <div className="flex items-center gap-4 mb-6">
                              <div className="h-12 w-12 rounded-2xl bg-white dark:bg-surface-1 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] shadow-sm border border-black/5 dark:border-line">
                                  <span className="material-symbols-outlined text-2xl">pending</span>
                              </div>
                              <div className="flex-1">
                                  <p className="font-bold text-lg text-[#111111] dark:text-ink leading-tight">Pending Review</p>
                                  <p className="text-[11px] font-bold text-[#555555] dark:text-ink-soft mt-1">Your application is currently being verified. This usually takes 24-48 hours.</p>
                              </div>
                          </div>

                          <div className="bg-white dark:bg-surface-1 rounded-2xl p-4 border border-black/5 dark:border-line mb-6">
                              <h4 className="text-[12px] font-bold text-[#555555] dark:text-ink-soft mb-3">Application Details</h4>
                              <div className="grid grid-cols-1 gap-3">
                                  <div className="flex justify-between items-center">
                                      <span className="text-[12px] font-bold text-[#555555] dark:text-ink-soft">Brand</span>
                                      <span className="text-xs font-bold text-[#111111] dark:text-ink">{sellerFormData.brandName}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                      <span className="text-[12px] font-bold text-[#555555] dark:text-ink-soft">Contact</span>
                                      <span className="text-xs font-bold text-[#111111] dark:text-ink">{sellerFormData.contactName}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                      <span className="text-[12px] font-bold text-[#555555] dark:text-ink-soft">Phone</span>
                                      <span className="text-xs font-bold text-[#111111] dark:text-ink">{sellerFormData.phone}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                      <span className="text-[12px] font-bold text-[#555555] dark:text-ink-soft">Email</span>
                                      <span className="text-xs font-bold text-[#111111] dark:text-ink">{sellerFormData.email}</span>
                                  </div>
                              </div>
                          </div>

                          <div className="flex gap-3">
                              <button 
                                  onClick={() => setView('seller-apply')}
                                  className="flex-1 h-12 rounded-xl border border-black/5 dark:border-line text-[#111111] dark:text-ink font-bold text-xs transition-all active:scale-95 bg-white dark:bg-surface-1"
                              >
                                  Edit
                              </button>
                              <button 
                                  onClick={() => setShowCancelApplyConfirm(true)}
                                  className="flex-1 h-12 rounded-xl border border-red-200 dark:border-red-900/50 text-red-500 font-bold text-xs transition-all active:scale-95 bg-white dark:bg-surface-1"
                              >
                                  Cancel
                              </button>
                          </div>
                      </div>
                  )}
                  {sellerStatus === 'rejected' && (
                      <div className="p-6 bg-red-50 dark:bg-red-950/10 transition-colors">
                          <div className="flex items-center gap-4 mb-6">
                              <div className="h-12 w-12 rounded-2xl bg-white dark:bg-surface-1 flex items-center justify-center text-red-500 shadow-sm border border-red-100 dark:border-red-900/50">
                                  <span className="material-symbols-outlined text-2xl">error</span>
                              </div>
                              <div className="flex-1">
                                  <p className="font-bold text-lg text-red-500 leading-tight">Application Rejected</p>
                                  <p className="text-[11px] font-bold text-[#555555] dark:text-ink-soft mt-1">Your seller registration application was declined. You can update your details and submit again.</p>
                              </div>
                          </div>
                          <button 
                              onClick={() => setView('seller-apply')}
                              className="w-full h-12 rounded-xl bg-white dark:bg-surface-1 border border-black/5 dark:border-line text-[#111111] dark:text-ink font-bold text-xs transition-all active:scale-95"
                          >
                              Re-Apply
                          </button>
                      </div>
                  )}
                  {sellerStatus === 'suspended' && (
                      <div className="p-6 bg-yellow-50 dark:bg-yellow-950/10 transition-colors">
                          <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-2xl bg-white dark:bg-surface-1 flex items-center justify-center text-yellow-600 shadow-sm border border-yellow-100 dark:border-yellow-900/50">
                                  <span className="material-symbols-outlined text-2xl">block</span>
                              </div>
                              <div className="flex-1">
                                  <p className="font-bold text-lg text-yellow-600 leading-tight">Account Suspended</p>
                                  <p className="text-[11px] font-bold text-[#555555] dark:text-ink-soft mt-1">Your seller privileges have been suspended. Please contact support at partner@zipright.in for assistance.</p>
                              </div>
                          </div>
                      </div>
                  )}
                  {sellerStatus === 'active' && (
                      <div onClick={() => setView('seller-profile')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                          <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-[#6157FF]/10 dark:border-[#6157FF]/10 shadow-sm shrink-0"><span className="material-symbols-outlined">storefront</span></div>
                          <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Seller Profile & Settings</div>
                          <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                      </div>
                  )}
              </div>
          </div>
        )}

        {/* Cancel Application Confirmation Modal */}
        {showCancelApplyConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
                <div className="w-full max-w-sm rounded-[2rem] bg-white dark:bg-surface-1 p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
                    <h3 className="text-xl font-bold text-[#111111] dark:text-ink mb-2">Cancel Application?</h3>
                    <p className="text-[#555555] dark:text-ink-soft mb-6">Are you sure you want to cancel your seller application? You will need to apply again later.</p>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setShowCancelApplyConfirm(false)}
                            className="flex-1 py-3 rounded-2xl bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-bold active:scale-95 transition-all border border-black/5 dark:border-line"
                        >
                            No, Keep it
                        </button>
                        <button 
                            onClick={async () => {
                                setSellerStatusState('none');
                                setSellerStatus('none');
                                showToast('Application Cancelled', 'success');
                                setShowCancelApplyConfirm(false);
                            }}
                            className="flex-1 py-3 rounded-2xl bg-red-500 text-ink font-bold active:scale-95 transition-all"
                        >
                            Yes, Cancel
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Account Section */}
        {userRole !== 'seller' && (
            <div className="px-6 mb-2">
                <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">My Account</h3>
                <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                    <div onClick={() => navigate('/order-history')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">shopping_bag</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">My Orders</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                    <div onClick={() => navigate('/wishlist')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">favorite</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Wishlist</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                    <div onClick={() => setView('addresses')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">location_on</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Addresses</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                    <div onClick={() => setView('manage-fits')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">straighten</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">My Fits & Measurements</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                </div>
            </div>
        )}

        {/* Admin Tools Section */}
        {userRole === 'admin' && (
            <div className="px-6 mb-2 mt-6">
                <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Admin Tools</h3>
                <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                    <div onClick={async () => {
                        try {
                            setLoading(true);
                            const list = await adminListSellers('pending');
                            setPendingSellers(list);
                            setView('admin-approvals');
                        } catch (err: any) {
                            console.error(err);
                            showToast(err.message || "Failed to list applications.", "error");
                        } finally {
                            setLoading(false);
                        }
                    }} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#6157FF] dark:text-[#6157FF] border border-black/5 dark:border-line"><span className="material-symbols-outlined">gavel</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Pending Seller Applications</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                    </div>
                </div>
            </div>
        )}

        {/* Preferences Section */}
        <div className="px-6 mb-2 mt-6">
            <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Preferences</h3>
            <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                <div onClick={toggleDarkMode} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">dark_mode</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Dark Mode</div>
                    <div className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${isDarkMode ? 'bg-[#6157FF] dark:bg-[#6157FF]' : 'bg-black/10 dark:bg-surface-2'}`}>
                        <div className={`w-4 h-4 rounded-full shadow-md transition-all ${isDarkMode ? 'bg-white dark:bg-surface-0 translate-x-6' : 'bg-white translate-x-0'}`}></div>
                    </div>
                </div>
                <div onClick={() => setView('app-settings')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">settings</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">App Settings</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
                <div onClick={() => setView('permissions')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">security</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Permissions</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
            </div>
        </div>

        {/* Support Section */}
        <div className="px-6 mb-2 mt-6">
            <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft mb-4 ml-2">Support & Legal</h3>
            <div className="flex flex-col bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line overflow-hidden shadow-sm">
                <div onClick={() => navigate('/faqs')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">help</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Help & FAQs</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
                <div onClick={() => navigate('/about-us')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">info</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">About Us</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
                <div onClick={() => navigate('/privacy-policy')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-line transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">policy</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Privacy Policy</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
                 <div onClick={() => navigate('/terms-of-use')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-surface-0 flex items-center justify-center text-[#111111] dark:text-ink border border-black/5 dark:border-line"><span className="material-symbols-outlined">gavel</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-ink">Terms of Use</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-ink-soft">chevron_right</span>
                </div>
            </div>
        </div>

        <div className="px-6 py-8">
            <button onClick={async () => {
                await auth.signOut();
                navigate('/welcome');
            }} className="w-full h-12 rounded-2xl border border-red-200 dark:border-red-900/50 text-red-500 font-bold text-sm active:scale-95 transition-all bg-white dark:bg-surface-1">
                Log Out
            </button>
            <p className="text-[11px] text-center text-[#555555] dark:text-ink-soft mt-6 font-bold opacity-80">
                <span className="text-[#111111] dark:text-ink">Zip</span><span className="text-[#6157FF]">RIGHT</span> v1.0
            </p>
        </div>
      </div>

      {/* Premium Membership Modal */}
      {showPremiumModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
            <div 
                className="bg-[#FAF9F6] dark:bg-surface-0 w-full max-w-lg sm:rounded-[2.5rem] rounded-t-[2.5rem] max-h-[90vh] overflow-y-auto no-scrollbar shadow-2xl animate-in slide-in-from-bottom duration-300 relative"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 pb-24 sm:pb-6 relative">
                    <div className="w-12 h-1.5 bg-black/10 dark:bg-surface-2 rounded-full mx-auto mb-6 sm:hidden"></div>
                    
                    <button 
                        onClick={() => setShowPremiumModal(false)}
                        className="absolute top-6 right-6 h-8 w-8 rounded-full bg-black/5 flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[#111111] dark:text-ink">close</span>
                    </button>

                    <div className="text-center mb-8">
                        <span className="inline-block px-3 py-1 rounded-full bg-[#6157FF]/10 text-[#6157FF] dark:bg-[#6157FF]/10 dark:text-[#6157FF] text-[12px] font-bold mb-2">Upgrade Now</span>
                        <h2 className="text-3xl font-bold text-[#111111] dark:text-ink mb-2">
                            <span className="text-[#111111] dark:text-ink">Zip</span><span className="text-[#6157FF]">RIGHT</span> Premium
                        </h2>
                        <p className="text-sm text-[#555555] dark:text-ink-soft font-medium max-w-xs mx-auto">Unlock advanced fit analysis and exclusive rewards for shoppers & sellers.</p>
                    </div>

                    {/* Toggle */}
                    <div className="flex justify-center mb-8">
                        <div className="flex bg-black/5 dark:bg-surface-2 p-1 rounded-2xl relative">
                            <button 
                                onClick={() => setBillingCycle('monthly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all z-10 ${billingCycle === 'monthly' ? 'bg-white dark:bg-surface-1 text-[#111111] dark:text-ink shadow-sm' : 'text-[#555555] dark:text-ink-soft'}`}
                            >
                                Monthly
                            </button>
                            <button 
                                onClick={() => setBillingCycle('yearly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all z-10 flex items-center gap-1 ${billingCycle === 'yearly' ? 'bg-white dark:bg-surface-1 text-[#111111] dark:text-ink shadow-sm' : 'text-[#555555] dark:text-ink-soft'}`}
                            >
                                Yearly
                                <span className="text-[11px] bg-green-500 text-ink px-1.5 py-0.5 rounded ml-1">-16%</span>
                            </button>
                        </div>
                    </div>

                    {/* Plans Grid */}
                    <div className="flex flex-col gap-4">
                        {plans.map((plan) => {
                            if (!plan) return null;
                            const isYearly = billingCycle === 'yearly';
                            const monthlyRate = plan.monthlyPrice;
                            
                            // Calculate yearly cost with discount
                            const yearlyTotal = Math.round(monthlyRate * 12 * (1 - (plan.discountPercent / 100)));
                            const priceToDisplay = isYearly ? yearlyTotal : monthlyRate;
                            
                            return (
                                <div 
                                    key={plan.name} 
                                    className={`relative p-5 rounded-[2rem] border-2 transition-all cursor-pointer overflow-hidden group ${plan.popular ? 'border-[#6157FF] dark:border-[#6157FF] bg-white dark:bg-surface-1' : 'border-black/5 dark:border-line bg-white dark:bg-surface-1'}`}
                                >
                                    {plan.popular && (
                                        <div className="absolute top-0 right-0 bg-[#6157FF] dark:bg-[#6157FF] text-ink dark:text-[#111111] text-[12px] font-bold px-3 py-1 rounded-bl-xl">
                                            Most Popular
                                        </div>
                                    )}

                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-[#111111] dark:text-ink">{plan.name}</h3>
                                            <div className="flex items-baseline gap-1 mt-1">
                                                <span className="text-2xl font-bold text-[#111111] dark:text-ink">
                                                    {priceToDisplay === 0 ? 'Free' : `₹${priceToDisplay.toLocaleString()}`}
                                                </span>
                                                {priceToDisplay !== 0 && <span className="text-xs font-bold text-[#555555] dark:text-ink-soft">/{isYearly ? 'yr' : 'mo'}</span>}
                                            </div>
                                            {isYearly && (
                                                <p className="text-xs font-bold text-green-600 dark:text-green-400 mt-1">
                                                    Save {plan.discountPercent}% (₹{Math.round(monthlyRate * 12 * (plan.discountPercent/100)).toLocaleString()})
                                                </p>
                                            )}
                                        </div>
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center text-ink ${plan.color}`}>
                                            <span className="material-symbols-outlined text-lg">star</span>
                                        </div>
                                    </div>

                                    <div className="h-[1px] bg-black/5 dark:bg-surface-2 mb-4"></div>

                                    <ul className="flex flex-col gap-2 mb-4">
                                        {plan.features.map((feature, idx) => (
                                            <li key={idx} className="flex items-center gap-2 text-sm text-[#555555] dark:text-ink-soft font-medium">
                                                <span className="material-symbols-outlined text-green-500 text-base">check</span>
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>

                                    <button 
                                        onClick={() => {
                                            if (plan.id === userPlan.id) return;
                                            handleSelectPlan(plan.planData);
                                        }}
                                        className={`w-full h-12 rounded-2xl font-bold text-sm tracking-wide transition-all active:scale-[0.98] ${
                                            plan.id === userPlan.id
                                            ? 'bg-black/5 dark:bg-surface-2 text-[#555555] dark:text-ink-soft cursor-default'
                                            : plan.popular 
                                                ? 'bg-[#6157FF] dark:bg-[#6157FF] text-ink dark:text-[#111111] shadow-lg shadow-[#6157FF]/20' 
                                                : 'bg-surface-0 dark:bg-white text-ink dark:text-[#111111]'
                                        }`}
                                    >
                                        {plan.id === userPlan.id ? 'Current Plan' : `Choose ${plan.name}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <p className="text-center text-[12px] text-[#555555] dark:text-ink-soft mt-6 font-medium">
                        Recurring billing. Cancel anytime. Terms apply.
                    </p>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
