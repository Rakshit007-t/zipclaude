import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PLANS, getUserRole, setUserRole, getSellerStatus, setSellerStatus, getUserPlan } from '../utils/subscription';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';

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

type ViewState = 'main' | 'manage-fits' | 'addresses' | 'edit-address' | 'permissions' | 'edit-profile' | 'seller-apply' | 'app-settings';

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
  
  const [view, setView] = useState<ViewState>('main');
  const [addressStep, setAddressStep] = useState<'map' | 'form'>('map');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  
  // Seller State
  const [userRole, setUserRoleState] = useState(getUserRole());
  const [sellerStatus, setSellerStatusState] = useState(getSellerStatus());
  const [sellerFormData, setSellerFormData] = useState({
      brandName: '',
      businessType: 'Brand',
      storeLink: '',
      monthlyOrders: '',
      email: '',
      businessAddress: '',
      taxId: ''
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

  const [profileImage, setProfileImage] = useState(auth.currentUser?.photoURL || 'https://picsum.photos/seed/profile/200/200');
  
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

        if (user) {
            try {
                // Fetch User Data
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    const u = {
                        firstName: data.firstName || '',
                        lastName: data.lastName || '',
                        email: data.email || user.email || '',
                        phone: data.phone || '',
                        gender: data.gender || 'Male',
                        dob: data.dob || '',
                        planId: data.planId || 'free',
                        zipPoints: data.zipPoints || 0
                    };
                    setUserData(u);
                    setEditUserData(u);
                    const plan = Object.values(PLANS).find(p => p.id === (data.planId || 'free')) || PLANS.FREE;
                    setUserPlan(plan);
                    if (data.photoURL) setProfileImage(data.photoURL);
                }

                // Fetch Members
                const membersQ = query(collection(db, 'members'), where('uid', '==', user.uid));
                const membersSnapshot = await getDocs(membersQ);
                const membersList = membersSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Member[];
                setMembers(membersList);

                // Fetch Addresses
                const addressesQ = query(collection(db, 'addresses'), where('uid', '==', user.uid));
                const addressesSnapshot = await getDocs(addressesQ);
                const addressesList = addressesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Address[];
                setAddresses(addressesList);

                // Fetch Seller Application
                const sellerDoc = await getDoc(doc(db, 'seller_applications', user.uid));
                if (sellerDoc.exists()) {
                    setSellerFormData(sellerDoc.data() as any);
                    setSellerStatusState(sellerDoc.data().status || 'pending');
                }

            } catch (error) {
                console.error("Error loading settings data:", error);
            }
        }
        
        setLoading(false);
    };

    init();
  }, [view, navigate]);

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
          
          const user = auth.currentUser;
          if (user) {
              try {
                  await setDoc(doc(db, 'users', user.uid), {
                      photoURL: base64
                  }, { merge: true });
              } catch (error) {
                  console.error("Error updating profile image:", error);
              }
          }
        }
      };
      reader.readAsDataURL(event.target.files[0]);
    }
  };

  const saveUserProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
          await setDoc(doc(db, 'users', user.uid), {
              ...editUserData,
              updatedAt: new Date()
          }, { merge: true });
          setUserData(editUserData);

          // Update primary member name if it exists
          const q = query(collection(db, 'members'), where('uid', '==', user.uid), where('isPrimary', '==', true));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
              await updateDoc(doc(db, 'members', snapshot.docs[0].id), {
                  name: `${editUserData.firstName} ${editUserData.lastName}`.trim()
              });
          }

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

      const user = auth.currentUser;
      if (!user) return;

      try {
          // If this is set as default, unset other defaults first
          if (editAddressData.isDefault) {
              const q = query(collection(db, 'addresses'), where('uid', '==', user.uid), where('isDefault', '==', true));
              const snapshot = await getDocs(q);
              for (const d of snapshot.docs) {
                  if (d.id !== editAddressData.id) {
                      await updateDoc(doc(db, 'addresses', d.id), { isDefault: false });
                  }
              }
          }

          if (editAddressData.id) {
              // Update
              await updateDoc(doc(db, 'addresses', editAddressData.id), {
                  ...editAddressData,
                  updatedAt: new Date()
              });
          } else {
              // Create
              await addDoc(collection(db, 'addresses'), {
                  ...editAddressData,
                  uid: user.uid,
                  createdAt: new Date()
              });
          }
          showToast('Address Saved', 'success');
          setView('addresses');
      } catch (error) {
          console.error("Error saving address:", error);
          handleFirestoreError(error, OperationType.WRITE, `addresses/${editAddressData.id || 'new'}`);
      }
  };

  const deleteAddress = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'addresses', id));
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
          await deleteDoc(doc(db, 'members', id));
          setMembers(members.filter(m => m.id !== id));
          setShowDeleteMemberConfirm(null);
          showToast('Profile Deleted', 'success');
      } catch (error) {
          console.error("Error deleting member:", error);
          handleFirestoreError(error, OperationType.DELETE, `members/${id}`);
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
    if (!sellerFormData.brandName || !sellerFormData.email) {
      showToast("Please fill in all required fields.", "error");
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
        // Create the application document
        await setDoc(doc(db, 'seller_applications', user.uid), {
            ...sellerFormData,
            uid: user.uid,
            status: 'pending',
            createdAt: new Date()
        });
        
        // Also update the user's profile to reflect pending status
        await setDoc(doc(db, 'users', user.uid), {
            sellerStatus: 'pending'
        }, { merge: true });

        setSellerStatus('pending');
        setSellerStatusState('pending');
        showToast("Application Submitted Successfully!", "success");
        setView('main');
    } catch (error) {
        console.error("Error applying for seller:", error);
        handleFirestoreError(error, OperationType.WRITE, `seller_applications/${user.uid}`);
    }
  };

  const toggleUserRole = async () => {
    const user = auth.currentUser;

    try {
      const nextRole = userRole === 'seller' ? 'user' : 'seller';
      
      // Update local state first for immediate feedback
      setUserRole(nextRole);
      setUserRoleState(nextRole);
      
      // Update Firestore if real user
      if (user) {
        await setDoc(doc(db, 'users', user.uid), {
          role: nextRole
        }, { merge: true });
      }

      showToast(`Switched to ${nextRole === 'seller' ? 'Seller' : 'User'} Mode`, "success");
      
      if (nextRole === 'seller') {
        navigate('/seller/dashboard');
      } else {
        navigate('/home');
      }
    } catch (error) {
      console.error("Error switching role:", error);
      if (user) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      } else {
        showToast("Role switch failed.", "error");
      }
    }
  };

  const handleSelectPlan = (plan: any) => {
    navigate('/select-payment', { state: { plan } });
    setShowPremiumModal(false);
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
        '1 Fit Profile',
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
      <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-hidden">
        <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
          <button onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#C9A06C]"><span className="material-symbols-outlined">arrow_back</span></button>
          <h2 className="text-lg font-bold text-[#C9A06C]">Seller Application</h2>
          <div className="w-8"></div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
          <div className="flex flex-col gap-6">
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Brand / Store Name</label>
              <input 
                type="text" 
                value={sellerFormData.brandName}
                onChange={(e) => setSellerFormData({...sellerFormData, brandName: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                placeholder="e.g. ZipStyle"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Business Type</label>
              <select 
                value={sellerFormData.businessType}
                onChange={(e) => setSellerFormData({...sellerFormData, businessType: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
              >
                <option>Brand</option>
                <option>Reseller</option>
                <option>Creator</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Website or Store Link</label>
              <input 
                type="text" 
                value={sellerFormData.storeLink}
                onChange={(e) => setSellerFormData({...sellerFormData, storeLink: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                placeholder="https://yourstore.com"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Estimated Monthly Orders</label>
              <input 
                type="number" 
                value={sellerFormData.monthlyOrders}
                onChange={(e) => setSellerFormData({...sellerFormData, monthlyOrders: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                placeholder="e.g. 500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Contact Email</label>
              <input 
                type="email" 
                value={sellerFormData.email}
                onChange={(e) => setSellerFormData({...sellerFormData, email: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                placeholder="seller@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Business Address</label>
              <textarea 
                value={sellerFormData.businessAddress}
                onChange={(e) => setSellerFormData({...sellerFormData, businessAddress: e.target.value})}
                className="w-full h-24 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 py-3 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] resize-none"
                placeholder="Enter full registered address"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Tax ID / GSTIN (Optional)</label>
              <input 
                type="text" 
                value={sellerFormData.taxId}
                onChange={(e) => setSellerFormData({...sellerFormData, taxId: e.target.value})}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                placeholder="e.g. 29AAAAA0000A1Z5"
              />
            </div>
            <div className="pt-6 pb-8 flex flex-col gap-3">
              <button onClick={handleSellerApply} className="w-full h-14 rounded-2xl bg-[#111111] text-white dark:bg-white dark:text-[#111111] font-black text-lg shadow-xl active:scale-95">Submit Application</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: EDIT PROFILE ---
  if (view === 'edit-profile') {
      return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-hidden">
            <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
            <button onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#C9A06C]"><span className="material-symbols-outlined">arrow_back</span></button>
            <h2 className="text-lg font-bold text-[#C9A06C]">Edit Profile</h2>
            <div className="w-8"></div>
        </div>
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
                <div className="flex flex-col items-center mb-8">
                    <div className="relative cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                        <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-black/5 dark:border-white/5">
                            <img src={profileImage} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                        </div>
                        <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0">
                            <span className="material-symbols-outlined text-white">edit</span>
                        </div>
                        <div className="absolute bottom-0 right-0 bg-[#111111] dark:bg-white text-white dark:text-[#111111] h-8 w-8 rounded-full flex items-center justify-center border-2 border-[#FAF9F6] dark:border-[#121212]">
                            <span className="material-symbols-outlined text-sm">photo_camera</span>
                        </div>
                    </div>
                    <p className="text-xs font-bold text-[#B5853F] dark:text-[#C9A06C] mt-3 uppercase tracking-wide">Change Photo</p>
                </div>

                <div className="flex flex-col gap-6">
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">First Name</label>
                        <input 
                            type="text" 
                            value={editUserData.firstName} 
                            onChange={(e) => setEditUserData({...editUserData, firstName: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Last Name</label>
                        <input 
                            type="text" 
                            value={editUserData.lastName} 
                            onChange={(e) => setEditUserData({...editUserData, lastName: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Email Address</label>
                        <input 
                            type="email" 
                            value={editUserData.email} 
                            onChange={(e) => setEditUserData({...editUserData, email: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Phone Number</label>
                        <input 
                            type="tel" 
                            value={editUserData.phone} 
                            onChange={(e) => setEditUserData({...editUserData, phone: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                        />
                    </div>
                    
                    {/* Gender Radio Buttons */}
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-3 block">Gender</label>
                        <div className="flex gap-6">
                            {['Male', 'Female', 'Other'].map((g) => (
                                <label key={g} className="flex items-center gap-2 cursor-pointer group">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${editUserData.gender === g ? 'border-[#111111] dark:border-white' : 'border-black/10 dark:border-white/10'}`}>
                                        {editUserData.gender === g && <div className="w-2.5 h-2.5 rounded-full bg-[#111111] dark:bg-white"></div>}
                                    </div>
                                    <input 
                                        type="radio" 
                                        name="gender" 
                                        value={g} 
                                        checked={editUserData.gender === g} 
                                        onChange={(e) => setEditUserData({...editUserData, gender: e.target.value})}
                                        className="hidden"
                                    />
                                    <span className={`font-bold text-sm ${editUserData.gender === g ? 'text-[#111111] dark:text-white' : 'text-[#555555] dark:text-[#A0A0A0]'}`}>{g}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Date of Birth */}
                    <div>
                        <label className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wide mb-2 block">Date of Birth <span className="text-[#555555]/60 dark:text-[#A0A0A0]/60 normal-case tracking-normal">(Optional)</span></label>
                        <input 
                            type="date" 
                            value={editUserData.dob} 
                            onChange={(e) => setEditUserData({...editUserData, dob: e.target.value})}
                            className="w-full h-12 bg-[#FAF9F6] dark:bg-[#121212] border border-black/5 dark:border-white/5 rounded-2xl px-4 font-bold text-[#111111] dark:text-white focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-colors"
                            style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                        />
                    </div>

                    {/* Save Button in Scroll View */}
                    <div className="pt-6 pb-8">
                        <button onClick={saveUserProfile} className="w-full h-14 rounded-2xl bg-[#111111] text-white dark:bg-white dark:text-[#111111] font-black text-lg shadow-xl active:scale-95">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: EDIT ADDRESS ---
  if (view === 'edit-address') {
    return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-hidden">
            {addressStep === 'map' && (
                <div className="relative flex-1 flex flex-col animate-in fade-in duration-300">
                    <div className="absolute top-0 left-0 right-0 z-10 flex items-center p-4">
                        <button onClick={() => setView('addresses')} className="h-10 w-10 rounded-full bg-white dark:bg-[#1E1E1E] shadow-lg flex items-center justify-center border border-black/5 dark:border-white/5 text-[#C9A06C]"><span className="material-symbols-outlined">arrow_back</span></button>
                    </div>
                    <div className="flex-1 bg-gray-200 dark:bg-gray-800 relative">
                         <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                             <div className="flex flex-col items-center mb-8 drop-shadow-2xl">
                                 <div className="px-3 py-1 bg-[#111111] dark:bg-white text-white dark:text-[#111111] text-[10px] font-black rounded-lg mb-1 animate-bounce">I'm here</div>
                                 <span className="material-symbols-outlined text-4xl text-[#B5853F] dark:text-[#C9A06C] filled" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
                             </div>
                         </div>
                    </div>
                    <div className="absolute bottom-40 right-4 flex flex-col gap-3">
                        <button onClick={useCurrentLocation} className="h-12 w-12 rounded-full bg-white dark:bg-[#1E1E1E] shadow-xl flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">my_location</span></button>
                    </div>
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-t-[2.5rem] p-6 shadow-2xl z-20 border-t border-black/5 dark:border-white/5">
                        <div className="flex items-start gap-4 mb-6">
                            <span className="material-symbols-outlined text-[#B5853F] dark:text-[#C9A06C] text-3xl mt-1">location_on</span>
                            <div>
                                <h3 className="text-xl font-black text-[#111111] dark:text-white">{editAddressData.area || 'Select Location'}</h3>
                                <p className="text-sm text-[#555555] dark:text-[#A0A0A0] font-medium leading-relaxed mt-1">{editAddressData.city}, {editAddressData.state}</p>
                            </div>
                        </div>
                        <button onClick={() => setAddressStep('form')} className="w-full h-14 rounded-2xl bg-[#111111] text-white dark:bg-white dark:text-[#111111] font-black text-lg uppercase tracking-widest shadow-xl active:scale-95">Confirm & Proceed</button>
                    </div>
                </div>
            )}
            {addressStep === 'form' && (
                <div className="flex flex-col flex-1 bg-[#FAF9F6] dark:bg-[#121212] animate-in slide-in-from-right duration-300 overflow-y-auto no-scrollbar">
                    <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
                        <button onClick={() => setAddressStep('map')} className="material-symbols-outlined p-2 -ml-2 rounded-full transition-colors text-[#C9A06C]">arrow_back</button>
                        <h2 className="text-lg font-black uppercase text-[#C9A06C]">Edit Address</h2>
                        <button onClick={saveAddress} className="text-[#B5853F] dark:text-[#C9A06C] font-black text-sm">SAVE</button>
                    </div>
                    <div className="p-6 flex flex-col gap-8 pb-32">
                         <div className="flex flex-col gap-6">
                            <div className="border-b border-black/10 dark:border-white/10">
                                <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">FULL NAME</label>
                                <input type="text" value={editAddressData.name} onChange={(e) => setEditAddressData({...editAddressData, name: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter recipient name" />
                            </div>
                            <div className="border-b border-black/10 dark:border-white/10">
                                <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">PHONE NUMBER</label>
                                <input type="tel" value={editAddressData.phone} onChange={(e) => setEditAddressData({...editAddressData, phone: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter 10-digit number" />
                            </div>
                            <div className="border-b border-black/10 dark:border-white/10">
                                <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">HOUSE / FLAT / BLOCK NO.</label>
                                <input type="text" value={editAddressData.houseNo} onChange={(e) => setEditAddressData({...editAddressData, houseNo: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter details" />
                            </div>
                            <div className="border-b border-black/10 dark:border-white/10">
                                <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">APARTMENT / ROAD / AREA</label>
                                <input type="text" value={editAddressData.area} onChange={(e) => setEditAddressData({...editAddressData, area: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter details" />
                            </div>
                            <div className="border-b border-black/10 dark:border-white/10">
                                <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">LANDMARK (OPTIONAL)</label>
                                <input type="text" value={editAddressData.landmark} onChange={(e) => setEditAddressData({...editAddressData, landmark: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="e.g. Near Central Mall" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="border-b border-black/10 dark:border-white/10">
                                    <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">CITY</label>
                                    <input type="text" value={editAddressData.city} onChange={(e) => setEditAddressData({...editAddressData, city: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter city" />
                                </div>
                                <div className="border-b border-black/10 dark:border-white/10">
                                    <label className="text-[11px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">ZIP CODE</label>
                                    <input type="text" value={editAddressData.zip} onChange={(e) => setEditAddressData({...editAddressData, zip: e.target.value})} className="w-full h-10 bg-transparent border-none outline-none font-bold p-0 pb-2 text-[#111111] dark:text-white" placeholder="Enter zip" />
                                </div>
                            </div>
                         </div>
                         <div className="flex flex-col gap-4">
                            <label className="text-[10px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">SAVE AS</label>
                            <div className="flex flex-wrap gap-2">
                                {['Home', 'Work', 'Friends', 'Other'].map((type) => (
                                    <button key={type} onClick={() => setEditAddressData({...editAddressData, type: type as any})} className={`px-5 py-2 rounded-full text-xs font-black transition-all border ${editAddressData.type === type ? 'bg-[#B5853F] text-white border-transparent' : 'bg-white dark:bg-[#1E1E1E] text-[#555555] dark:text-[#A0A0A0] border-black/5 dark:border-white/5'}`}>{type}</button>
                                ))}
                            </div>
                         </div>
                         <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setEditAddressData({...editAddressData, isDefault: !editAddressData.isDefault})}
                                className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${editAddressData.isDefault ? 'bg-[#B5853F] dark:bg-[#C9A06C]' : 'bg-black/10 dark:bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 bg-white dark:bg-[#121212] rounded-full shadow-sm transition-transform ${editAddressData.isDefault ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </button>
                            <span className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest">Make this my default address</span>
                         </div>
                    </div>
                    <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-t border-black/5 dark:border-white/5 z-30 max-w-md mx-auto">
                        <button onClick={saveAddress} className="w-full h-14 rounded-2xl bg-[#B5853F] dark:bg-[#C9A06C] text-white dark:text-[#111111] font-black text-lg shadow-xl shadow-[#B5853F]/20 active:scale-95 transition-all">Save Address</button>
                    </div>
                </div>
            )}
        </div>
    );
  }

  // --- VIEW: ADDRESSES LIST ---
  if (view === 'addresses') {
      return (
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-hidden">
             <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
                <button onClick={() => setView('main')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#C9A06C]"><span className="material-symbols-outlined">arrow_back</span></button>
                <h2 className="text-lg font-bold text-[#C9A06C]">Saved Addresses</h2>
                <button onClick={openAddAddress} className="text-[#B5853F] dark:text-[#C9A06C] font-bold text-sm">ADD NEW</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-20 no-scrollbar">
                <div className="flex flex-col gap-4">
                    {addresses.map((addr) => {
                        if (!addr) return null;
                        const typeColors = {
                            Home: 'bg-[#B5853F]/10 text-[#B5853F] dark:bg-[#C9A06C]/10 dark:text-[#C9A06C]',
                            Work: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                            Friends: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
                            Other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        };
                        return (
                        <div key={addr.id} className="flex flex-col p-5 rounded-[2rem] bg-white dark:bg-[#1E1E1E] border border-black/5 dark:border-white/5 shadow-sm relative group">
                            <div className="flex justify-between items-start mb-2">
                                <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${typeColors[addr.type] || typeColors.Other}`}>{addr.type}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => openEditAddress(addr)} className="h-8 w-8 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] transition-colors"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                    <button onClick={() => setShowDeleteAddressConfirm(addr.id)} className="h-8 w-8 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-red-500 transition-colors"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-base mb-1 text-[#111111] dark:text-white">{addr.name}</h3>
                            <p className="text-sm text-[#555555] dark:text-[#A0A0A0] leading-relaxed">{addr.houseNo}, {addr.area}</p>
                            <p className="text-sm text-[#555555] dark:text-[#A0A0A0] leading-relaxed">{addr.city}, {addr.state} - {addr.zip}</p>
                            <p className="text-xs text-[#555555]/60 dark:text-[#A0A0A0]/60 mt-2 font-mono">{addr.phone}</p>
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
                        <h3 className="text-xl font-bold text-black dark:text-white mb-2">Delete Address?</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-6">Are you sure you want to delete this address? This action cannot be undone.</p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowDeleteAddressConfirm(null)}
                                className="flex-1 py-3 rounded-2xl bg-gray-100 dark:bg-white/5 text-black dark:text-white font-bold active:scale-95 transition-all"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => deleteAddress(showDeleteAddressConfirm)}
                                className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold active:scale-95 transition-all"
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
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-hidden">
             <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-6 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
                <button onClick={() => setView('main')} className="flex items-center justify-center h-12 w-12 -ml-2 rounded-full transition-colors text-[#C9A06C]">
                    <span className="material-symbols-outlined text-2xl">arrow_back</span>
                </button>
                <h2 className="text-xl font-black tracking-tight text-[#C9A06C]">Manage Profiles</h2>
                <div className="w-10"></div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-20 no-scrollbar">
                <div className="flex flex-col gap-5">
                    {members.map(member => (
                        <div 
                            key={member.id} 
                            onClick={() => navigate('/fit-profile', { state: { mode: 'edit', memberId: member.id } })}
                            className="flex items-center justify-between p-6 rounded-[2rem] bg-white dark:bg-[#1E1E1E] border border-black/5 dark:border-white/5 shadow-sm cursor-pointer active:scale-[0.98] transition-all"
                        >
                            <div className="flex items-center gap-5">
                                <div className="h-14 w-14 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5">
                                    <span className="material-symbols-outlined text-2xl">person</span>
                                </div>
                                <div>
                                    <h3 className="font-black text-lg text-[#111111] dark:text-white leading-tight">{member.name}</h3>
                                    <p className="text-sm text-[#555555] dark:text-[#A0A0A0] font-bold mt-1">
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
                                    className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                                {!member.isPrimary && (
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeleteMemberConfirm(member.id);
                                        }}
                                        className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-red-500 transition-colors"
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
                            <div className="w-full max-w-sm rounded-[2rem] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
                                <h3 className="text-xl font-bold text-[#111111] dark:text-white mb-2">Delete Profile?</h3>
                                <p className="text-[#555555] dark:text-[#A0A0A0] mb-6">Are you sure you want to delete this fit profile? This action cannot be undone.</p>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setShowDeleteMemberConfirm(null)}
                                        className="flex-1 py-3 rounded-2xl bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-bold active:scale-95 transition-all border border-black/5 dark:border-white/5"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={() => deleteMember(showDeleteMemberConfirm)}
                                        className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold active:scale-95 transition-all"
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
                                    ? 'border-black/10 dark:border-white/10 text-[#555555]/40 dark:text-[#A0A0A0]/40 bg-black/5 dark:bg-white/5' 
                                    : 'border-black/10 dark:border-white/10 text-[#555555] dark:text-[#A0A0A0] font-black'
                                }`}
                            >
                                <span className="material-symbols-outlined text-2xl">{isLimitReached ? 'lock' : 'add_circle'}</span>
                                <span className="text-lg">Add New Profile</span>
                                {isLimitReached && (
                                    <div className="ml-1 flex items-center gap-1 bg-[#B5853F] text-white px-2 py-1 rounded-lg">
                                        <span className="material-symbols-outlined text-[12px]">verified</span>
                                        <span className="text-[10px] font-black uppercase tracking-tighter">UPGRADE</span>
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
      <div className="flex flex-col min-h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display relative overflow-x-hidden">
        <div className="sticky top-0 z-50 flex items-center gap-4 px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
          <button onClick={() => setView('main')} className="material-symbols-outlined p-2 -ml-2 rounded-full text-[#C9A06C]">arrow_back</button>
          <h2 className="text-lg font-bold text-[#C9A06C]">Permissions</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 no-scrollbar">
             <div className="flex flex-col gap-3">
                {permissionsList.map(p => {
                     const isAllowed = permissionsState[p.id as keyof typeof permissionsState];
                     return (
                        <div key={p.id} className="flex items-start gap-4 p-5 bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 shadow-sm">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isAllowed ? 'bg-[#B5853F]/10 dark:bg-[#C9A06C]/10' : 'bg-[#FAF9F6] dark:bg-[#121212]'}`}>
                                <span className={`material-symbols-outlined ${isAllowed ? 'text-[#B5853F] dark:text-[#C9A06C]' : 'text-[#555555] dark:text-[#A0A0A0]'}`}>{p.icon}</span>
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-sm text-[#111111] dark:text-white">{p.title}</p>
                                <p className="text-[11px] text-[#555555] dark:text-[#A0A0A0] mt-1 leading-relaxed">{p.desc}</p>
                            </div>
                            <button onClick={() => togglePermission(p.id)} className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${isAllowed ? 'bg-[#B5853F] dark:bg-[#C9A06C]' : 'bg-black/10 dark:bg-white/10'}`}>
                                <div className={`w-4 h-4 bg-white dark:bg-[#121212] rounded-full shadow-sm transition-transform ${isAllowed ? 'translate-x-6' : 'translate-x-0'}`}></div>
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
        <div className="flex flex-col min-h-screen w-full bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display relative overflow-x-hidden">
            <div className="sticky top-0 z-50 flex items-center gap-4 px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
                <button onClick={() => setView('main')} className="material-symbols-outlined p-2 -ml-2 rounded-full text-[#C9A06C]">arrow_back</button>
                <h2 className="text-lg font-bold text-[#C9A06C]">App Settings</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 no-scrollbar">
                <div className="flex flex-col gap-6">
                    <div>
                        <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">Notifications</h3>
                        <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                            <div className="flex items-center justify-between p-5">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-[#B5853F]/10 dark:bg-[#C9A06C]/10 flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C]">
                                        <span className="material-symbols-outlined">notifications</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-[#111111] dark:text-white">Push Notifications</p>
                                        <p className="text-[11px] text-[#555555] dark:text-[#A0A0A0] mt-0.5">Alerts for orders and fits.</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => togglePermission('notifications')}
                                    className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${permissionsState.notifications ? 'bg-[#B5853F] dark:bg-[#C9A06C]' : 'bg-black/10 dark:bg-white/10'}`}
                                >
                                    <div className={`w-4 h-4 bg-white dark:bg-[#121212] rounded-full shadow-sm transition-transform ${permissionsState.notifications ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // --- MAIN VIEW ---
  return (
    <div className="relative flex h-full min-h-screen w-full flex-col bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-display overflow-x-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>
      
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-[#121212]/95 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <button onClick={() => navigate('/home')} className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#C9A06C]"><span className="material-symbols-outlined text-[24px]">arrow_back</span></button>
        <h2 className="text-lg font-bold text-[#C9A06C]">Profile & Settings</h2>
        <div className="w-8"></div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar">
        {/* Profile Card */}
        <div className="px-6 py-6">
            <div className="relative p-8 bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 shadow-sm overflow-hidden group">
                 
                 {/* Decorative Background Blobs */}
                 <div className="absolute top-[-20%] right-[-10%] w-48 h-48 bg-[#B5853F]/10 rounded-full blur-[60px] pointer-events-none"></div>
                 <div className="absolute bottom-[-10%] left-[-5%] w-32 h-32 bg-[#C9A06C]/10 rounded-full blur-[40px] pointer-events-none"></div>

                 <div className="relative z-10 flex items-center gap-4">
                    {/* Profile Image - Smaller */}
                    <div className="relative shrink-0 cursor-pointer group/img" onClick={() => fileInputRef.current?.click()}>
                        <div className="h-20 w-20 rounded-full overflow-hidden border-[3px] border-[#FAF9F6] dark:border-[#121212] shadow-sm transition-all duration-500">
                            <img src={profileImage} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer"/>
                        </div>
                         <div className="absolute bottom-0 right-0 bg-[#111111] dark:bg-white text-white dark:text-[#111111] h-7 w-7 rounded-full flex items-center justify-center border-[2px] border-[#FAF9F6] dark:border-[#121212] shadow-md transition-all duration-300">
                            <span className="material-symbols-outlined text-[14px] font-bold">edit</span>
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-black text-[#111111] dark:text-white leading-tight tracking-tight truncate">
                                {userData.firstName} {userData.lastName}
                            </h2>
                            <button 
                                onClick={() => {
                                    setEditUserData(userData);
                                    setView('edit-profile');
                                }}
                                className="text-[#555555] dark:text-[#A0A0A0] transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                        </div>
                        <p className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0] mt-0.5 truncate opacity-80">
                            {userData.email}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                             {sellerStatus === 'approved' && (
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleUserRole();
                                    }}
                                    className="inline-flex items-center justify-center gap-1.5 bg-[#FAF9F6] dark:bg-[#121212] px-3 py-1.5 rounded-full shadow-sm active:scale-95 transition-all border border-black/5 dark:border-white/5"
                                >
                                    <span className="material-symbols-outlined text-[#111111] dark:text-white text-[12px]">swap_horiz</span>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-[#111111] dark:text-white">
                                        {userRole === 'user' ? 'Seller Mode' : 'User Mode'}
                                    </span>
                                </button>
                            )}

                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowPremiumModal(true);
                                }}
                                className="inline-flex items-center justify-center gap-1.5 bg-gradient-to-r from-[#B5853F] to-[#C9A06C] px-3 py-1.5 rounded-full shadow-lg shadow-[#B5853F]/20 active:scale-95 transition-all"
                            >
                                <span className="material-symbols-outlined text-white text-[12px] filled" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                                <span className="text-[10px] font-black uppercase tracking-wider text-white">Premium</span>
                            </button>
                        </div>
                    </div>
                 </div>
            </div>
        </div>

        {/* Wallet Section */}
        <div className="px-6 mb-2">
            <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">Wallet & Rewards</h3>
            <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between p-6 bg-gradient-to-r from-[#B5853F] to-[#C9A06C] text-white">
                    <div>
                        <p className="text-xs font-bold opacity-90 uppercase tracking-wide">ZipCoins Balance</p>
                        <h2 className="text-3xl font-black mt-1">{userData.zipPoints}</h2>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
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
                    }} className="flex items-center gap-4 p-4 cursor-pointer transition-colors border-b border-black/5 dark:border-white/5">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">payments</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Redeem to Bank</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                    </div>
                ) : (
                    <div className="p-6 bg-[#FAF9F6] dark:bg-[#121212] animate-in fade-in slide-in-from-top-2 duration-300 border-b border-black/5 dark:border-white/5">
                        <p className="text-[10px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-3">Redeem ₹{(userData.zipPoints / 100).toFixed(2)}</p>
                        <input 
                            type="text"
                            value={redeemInput}
                            onChange={(e) => setRedeemInput(e.target.value)}
                            placeholder="Enter UPI ID (e.g., user@upi)"
                            className="w-full bg-white dark:bg-[#1E1E1E] border border-black/5 dark:border-white/5 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-[#B5853F] dark:focus:border-[#C9A06C] transition-all mb-4 text-[#111111] dark:text-white"
                        />
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowRedeemInput(false)}
                                className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#555555] dark:text-[#A0A0A0] border border-black/5 dark:border-white/5 bg-white dark:bg-[#1E1E1E]"
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
                                className="flex-[2] bg-[#111111] dark:bg-white text-white dark:text-[#111111] py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isRedeeming ? (
                                    <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                                ) : 'Confirm'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Ways to Earn */}
                <div className="p-6 bg-[#FAF9F6] dark:bg-[#121212]">
                    <h4 className="text-[10px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4">Ways to Earn</h4>
                    <div className="space-y-3">
                        {[
                            { icon: 'shopping_bag', title: 'Shop & Earn', desc: 'Up to 5000 coins per order' },
                            { icon: 'group_add', title: 'Refer a Friend', desc: '500 coins per referral' },
                            { icon: 'rate_review', title: 'Write a Review', desc: '100 coins per review' }
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-white dark:bg-[#1E1E1E] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5 shrink-0">
                                    <span className="material-symbols-outlined text-base">{item.icon}</span>
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-[#111111] dark:text-white leading-none">{item.title}</p>
                                    <p className="text-[10px] text-[#555555] dark:text-[#A0A0A0] mt-1">{item.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>

        {/* Seller Tools Section */}
        <div className="px-6 mb-2 mt-6">
            <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">Seller Tools</h3>
            <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                {sellerStatus === 'none' && (
                    <div onClick={() => setView('seller-apply')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">storefront</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Apply to Become a Seller</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                    </div>
                )}
                {sellerStatus === 'pending' && (
                    <div className="p-6 bg-[#FAF9F6] dark:bg-[#121212] transition-colors">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="h-12 w-12 rounded-2xl bg-white dark:bg-[#1E1E1E] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] shadow-sm border border-black/5 dark:border-white/5">
                                <span className="material-symbols-outlined text-2xl">pending</span>
                            </div>
                            <div className="flex-1">
                                <p className="font-black text-lg text-[#111111] dark:text-white leading-tight">Pending Review</p>
                                <p className="text-[11px] font-bold text-[#555555] dark:text-[#A0A0A0] mt-1">Your application is currently being verified. This usually takes 24-48 hours.</p>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-[#1E1E1E] rounded-2xl p-4 border border-black/5 dark:border-white/5 mb-6">
                            <h4 className="text-[10px] font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-3">Application Details</h4>
                            <div className="grid grid-cols-1 gap-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wider">Brand</span>
                                    <span className="text-xs font-black text-[#111111] dark:text-white">{sellerFormData.brandName}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wider">Type</span>
                                    <span className="text-xs font-black text-[#111111] dark:text-white">{sellerFormData.businessType}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wider">Store</span>
                                    <span className="text-xs font-black text-[#111111] dark:text-white truncate max-w-[150px]">{sellerFormData.storeLink || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-[#555555] dark:text-[#A0A0A0] uppercase tracking-wider">Email</span>
                                    <span className="text-xs font-black text-[#111111] dark:text-white">{sellerFormData.email}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button 
                                onClick={() => setView('seller-apply')}
                                className="flex-1 h-12 rounded-xl border border-black/5 dark:border-white/5 text-[#111111] dark:text-white font-black text-xs uppercase tracking-widest transition-all active:scale-95 bg-white dark:bg-[#1E1E1E]"
                            >
                                Edit
                            </button>
                            <button 
                                onClick={() => setShowCancelApplyConfirm(true)}
                                className="flex-1 h-12 rounded-xl border border-red-200 dark:border-red-900/50 text-red-500 font-black text-xs uppercase tracking-widest transition-all active:scale-95 bg-white dark:bg-[#1E1E1E]"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Cancel Application Confirmation Modal */}
                {showCancelApplyConfirm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
                        <div className="w-full max-w-sm rounded-[2rem] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl animate-in fade-in zoom-in duration-300">
                            <h3 className="text-xl font-bold text-[#111111] dark:text-white mb-2">Cancel Application?</h3>
                            <p className="text-[#555555] dark:text-[#A0A0A0] mb-6">Are you sure you want to cancel your seller application? You will need to apply again later.</p>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowCancelApplyConfirm(false)}
                                    className="flex-1 py-3 rounded-2xl bg-[#FAF9F6] dark:bg-[#121212] text-[#111111] dark:text-white font-bold active:scale-95 transition-all border border-black/5 dark:border-white/5"
                                >
                                    No, Keep it
                                </button>
                                <button 
                                    onClick={async () => {
                                        if (auth.currentUser) {
                                            try {
                                                await deleteDoc(doc(db, 'seller_applications', auth.currentUser.uid));
                                                await setDoc(doc(db, 'users', auth.currentUser.uid), {
                                                    sellerStatus: 'none'
                                                }, { merge: true });
                                            } catch (e) {
                                                console.error("Error cancelling application", e);
                                            }
                                        }
                                        setSellerStatus('none');
                                        setSellerStatusState('none');
                                        showToast('Application Cancelled', 'success');
                                        setShowCancelApplyConfirm(false);
                                    }}
                                    className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold active:scale-95 transition-all"
                                >
                                    Yes, Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {sellerStatus === 'approved' && (
                    <div onClick={() => toggleUserRole()} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                        <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">dashboard</span></div>
                        <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Switch to Seller Dashboard</div>
                        <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                    </div>
                )}
            </div>
        </div>

        {/* Account Section */}
        <div className="px-6 mb-2">
            <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">My Account</h3>
            <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                <div onClick={() => navigate('/order-history')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">shopping_bag</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">My Orders</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => navigate('/wishlist')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">favorite</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Wishlist</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => setView('addresses')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">location_on</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Addresses</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => setView('manage-fits')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#B5853F] dark:text-[#C9A06C] border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">straighten</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">My Fits & Measurements</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
            </div>
        </div>

        {/* Preferences Section */}
        <div className="px-6 mb-2 mt-6">
            <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">Preferences</h3>
            <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                <div onClick={toggleDarkMode} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">dark_mode</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Dark Mode</div>
                    <div className={`w-12 h-6 rounded-full flex items-center px-1 transition-all ${isDarkMode ? 'bg-[#B5853F] dark:bg-[#C9A06C]' : 'bg-black/10 dark:bg-white/10'}`}>
                        <div className={`w-4 h-4 rounded-full shadow-md transition-all ${isDarkMode ? 'bg-white dark:bg-[#121212] translate-x-6' : 'bg-white translate-x-0'}`}></div>
                    </div>
                </div>
                <div onClick={() => setView('app-settings')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">settings</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">App Settings</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => setView('permissions')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">security</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Permissions</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
            </div>
        </div>

        {/* Support Section */}
        <div className="px-6 mb-2 mt-6">
            <h3 className="text-xs font-black text-[#555555] dark:text-[#A0A0A0] uppercase tracking-widest mb-4 ml-2">Support & Legal</h3>
            <div className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-[2rem] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
                <div onClick={() => navigate('/faqs')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">help</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Help & FAQs</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => navigate('/about-us')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">info</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">About Us</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                <div onClick={() => navigate('/privacy-policy')} className="flex items-center gap-4 p-4 cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">policy</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Privacy Policy</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
                 <div onClick={() => navigate('/terms-of-use')} className="flex items-center gap-4 p-4 cursor-pointer transition-colors">
                    <div className="h-10 w-10 rounded-full bg-[#FAF9F6] dark:bg-[#121212] flex items-center justify-center text-[#111111] dark:text-white border border-black/5 dark:border-white/5"><span className="material-symbols-outlined">gavel</span></div>
                    <div className="flex-1 font-bold text-sm text-[#111111] dark:text-white">Terms of Use</div>
                    <span className="material-symbols-outlined text-[#555555] dark:text-[#A0A0A0]">chevron_right</span>
                </div>
            </div>
        </div>

        <div className="px-6 py-8">
            <button onClick={async () => {
                await auth.signOut();
                navigate('/welcome');
            }} className="w-full h-12 rounded-2xl border border-red-200 dark:border-red-900/50 text-red-500 font-bold text-sm uppercase tracking-wider active:scale-95 transition-all bg-white dark:bg-[#1E1E1E]">
                Log Out
            </button>
            <p className="text-[11px] text-center text-[#555555] dark:text-[#A0A0A0] mt-6 font-bold uppercase tracking-[0.2em] opacity-80">
                <span className="text-[#111111] dark:text-white">Zip</span><span className="text-[#B5853F]">RIGHT</span> v1.0
            </p>
        </div>
      </div>

      {/* Premium Membership Modal */}
      {showPremiumModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
            <div 
                className="bg-[#FAF9F6] dark:bg-[#121212] w-full max-w-lg sm:rounded-[2.5rem] rounded-t-[2.5rem] max-h-[90vh] overflow-y-auto no-scrollbar shadow-2xl animate-in slide-in-from-bottom duration-300 relative"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 pb-24 sm:pb-6 relative">
                    <div className="w-12 h-1.5 bg-black/10 dark:bg-white/10 rounded-full mx-auto mb-6 sm:hidden"></div>
                    
                    <button 
                        onClick={() => setShowPremiumModal(false)}
                        className="absolute top-6 right-6 h-8 w-8 rounded-full bg-black/5 flex items-center justify-center"
                    >
                        <span className="material-symbols-outlined text-[#111111] dark:text-white">close</span>
                    </button>

                    <div className="text-center mb-8">
                        <span className="inline-block px-3 py-1 rounded-full bg-[#B5853F]/10 text-[#B5853F] dark:bg-[#C9A06C]/10 dark:text-[#C9A06C] text-[10px] font-black uppercase tracking-widest mb-2">Upgrade Now</span>
                        <h2 className="text-3xl font-black text-[#111111] dark:text-white mb-2">
                            <span className="text-[#111111] dark:text-white">Zip</span><span className="text-[#B5853F]">RIGHT</span> Premium
                        </h2>
                        <p className="text-sm text-[#555555] dark:text-[#A0A0A0] font-medium max-w-xs mx-auto">Unlock advanced fit analysis and exclusive rewards for shoppers & sellers.</p>
                    </div>

                    {/* Toggle */}
                    <div className="flex justify-center mb-8">
                        <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-2xl relative">
                            <button 
                                onClick={() => setBillingCycle('monthly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all z-10 ${billingCycle === 'monthly' ? 'bg-white dark:bg-[#1E1E1E] text-[#111111] dark:text-white shadow-sm' : 'text-[#555555] dark:text-[#A0A0A0]'}`}
                            >
                                Monthly
                            </button>
                            <button 
                                onClick={() => setBillingCycle('yearly')}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all z-10 flex items-center gap-1 ${billingCycle === 'yearly' ? 'bg-white dark:bg-[#1E1E1E] text-[#111111] dark:text-white shadow-sm' : 'text-[#555555] dark:text-[#A0A0A0]'}`}
                            >
                                Yearly
                                <span className="text-[9px] bg-green-500 text-white px-1.5 py-0.5 rounded ml-1">-16%</span>
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
                                    className={`relative p-5 rounded-[2rem] border-2 transition-all cursor-pointer overflow-hidden group ${plan.popular ? 'border-[#B5853F] dark:border-[#C9A06C] bg-white dark:bg-[#1E1E1E]' : 'border-black/5 dark:border-white/5 bg-white dark:bg-[#1E1E1E]'}`}
                                >
                                    {plan.popular && (
                                        <div className="absolute top-0 right-0 bg-[#B5853F] dark:bg-[#C9A06C] text-white dark:text-[#111111] text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">
                                            Most Popular
                                        </div>
                                    )}

                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-lg font-black text-[#111111] dark:text-white">{plan.name}</h3>
                                            <div className="flex items-baseline gap-1 mt-1">
                                                <span className="text-2xl font-black text-[#111111] dark:text-white">
                                                    {priceToDisplay === 0 ? 'Free' : `₹${priceToDisplay.toLocaleString()}`}
                                                </span>
                                                {priceToDisplay !== 0 && <span className="text-xs font-bold text-[#555555] dark:text-[#A0A0A0]">/{isYearly ? 'yr' : 'mo'}</span>}
                                            </div>
                                            {isYearly && (
                                                <p className="text-xs font-bold text-green-600 dark:text-green-400 mt-1">
                                                    Save {plan.discountPercent}% (₹{Math.round(monthlyRate * 12 * (plan.discountPercent/100)).toLocaleString()})
                                                </p>
                                            )}
                                        </div>
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white ${plan.color}`}>
                                            <span className="material-symbols-outlined text-lg">star</span>
                                        </div>
                                    </div>

                                    <div className="h-[1px] bg-black/5 dark:bg-white/5 mb-4"></div>

                                    <ul className="flex flex-col gap-2 mb-4">
                                        {plan.features.map((feature, idx) => (
                                            <li key={idx} className="flex items-center gap-2 text-sm text-[#555555] dark:text-[#A0A0A0] font-medium">
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
                                        className={`w-full h-12 rounded-2xl font-bold text-sm uppercase tracking-wide transition-all active:scale-[0.98] ${
                                            plan.id === userPlan.id
                                            ? 'bg-black/5 dark:bg-white/5 text-[#555555] dark:text-[#A0A0A0] cursor-default'
                                            : plan.popular 
                                                ? 'bg-[#B5853F] dark:bg-[#C9A06C] text-white dark:text-[#111111] shadow-lg shadow-[#B5853F]/20' 
                                                : 'bg-[#111111] dark:bg-white text-white dark:text-[#111111]'
                                        }`}
                                    >
                                        {plan.id === userPlan.id ? 'Current Plan' : `Choose ${plan.name}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <p className="text-center text-[10px] text-[#555555] dark:text-[#A0A0A0] mt-6 font-medium">
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