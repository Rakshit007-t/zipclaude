import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteField, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { updateProfile as updateAuthProfile } from 'firebase/auth';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { compressImage, uploadOrEncodeProfilePhoto, uploadOrEncodeBannerPhoto } from '../utils/media';
import { AppBar, Button, Input, Modal, SegmentedControl, Spinner, Eyebrow } from '../components/ui';

const ProfileField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="grid grid-cols-[92px_1fr] gap-3 px-6 py-4 text-[14px] text-ink">
    <span className="pt-2 text-ink-soft">{label}</span>
    {children}
  </label>
);

const EditProfile: React.FC = () => {
  const { goBack } = useAppNavigation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { userProfile, setUserProfile } = useUserProfile();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [authUser, setAuthUser] = useState(auth.currentUser);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Form State
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [gender, setGender] = useState('Male');
  const [location, setLocation] = useState('');
  const [birthday, setBirthday] = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [bannerImage, setBannerImage] = useState('');

  // Initial State for dirty check
  const [initialFormState, setInitialFormState] = useState<string>('');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setAuthUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      const user = auth.currentUser || authUser;
      let initialPhoto = user?.photoURL || userProfile.photoURL || '';

      let initialData = {
        displayName: user?.displayName || userProfile.displayName || userProfile.profileName || '',
        username: userProfile.username || (userProfile.profileName ? userProfile.profileName.toLowerCase().replace(/\s+/g, '_') : ''),
        bio: userProfile.bio || '',
        website: userProfile.website || '',
        pronouns: '',
        gender: userProfile.gender || 'Male',
        location: userProfile.location || '',
        birthday: '',
        bannerImage: '',
      };

      if (user && !user.isAnonymous) {
        try {
          const docSnap = await getDoc(doc(db, 'users', user.uid));
          if (docSnap.exists() && active) {
            const data = docSnap.data();
            const remotePhoto = data.photoURL || data.photoUrl || '';
            if (remotePhoto) {
              initialPhoto = remotePhoto;
            }
            initialData = {
              displayName: data.displayName || data.profileName || initialData.displayName,
              username: data.username || initialData.username,
              bio: data.bio || initialData.bio,
              website: data.website || '',
              pronouns: data.pronouns || '',
              gender: data.gender || initialData.gender,
              location: data.location || initialData.location,
              birthday: data.birthday || initialData.birthday,
              bannerImage: data.bannerImage || '',
            };
          }
        } catch (e) {
          console.warn('[EditProfile] Error loading user doc:', e);
        }
      }

      if (!active) return;
      setProfileImage(initialPhoto);
      setDisplayName(initialData.displayName);
      setUsername(initialData.username);
      setBio(initialData.bio);
      setWebsite(initialData.website);
      setPronouns(initialData.pronouns);
      setGender(initialData.gender);
      setLocation(initialData.location);
      setBirthday(initialData.birthday);
      setBannerImage(initialData.bannerImage);

      setInitialFormState(JSON.stringify({
        displayName: initialData.displayName,
        username: initialData.username,
        bio: initialData.bio,
        website: initialData.website,
        gender: initialData.gender,
        location: initialData.location,
        birthday: initialData.birthday,
      }));
      setLoading(false);
    };

    void init();
    return () => { active = false; };
  }, [authUser, userProfile.displayName, userProfile.profileName, userProfile.photoURL, userProfile.username]);

  const currentFormState = JSON.stringify({
    displayName,
    username,
    bio,
    website,
    gender,
    location,
    birthday,
  });

  const isDirty = initialFormState !== '' && currentFormState !== initialFormState;

  const handleBackAttempt = () => {
    if (isDirty) {
      setShowDiscardModal(true);
    } else {
      goBack('/profile');
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

  const handleRemovePhoto = async () => {
    if (!profileImage) return;
    try {
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        // All profile photos are stored under this deterministic, owner-only
        // path. Never derive a Storage path from an arbitrary URL.
        await deleteObject(ref(getStorage(app), `profiles/${user.uid}.jpg`)).catch((error: { code?: string }) => {
          if (error?.code !== 'storage/object-not-found') throw error;
        });
        await updateAuthProfile(user, { photoURL: null }).catch(() => {});
        await setDoc(doc(db, 'users', user.uid), { photoURL: deleteField() }, { merge: true });
        await setDoc(doc(db, 'publicProfiles', user.uid), {
          uid: user.uid,
          photoURL: deleteField(),
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }
      localStorage.removeItem('zipright_profile_photo');
      setProfileImage('');
      setUserProfile(prev => ({ ...prev, photoURL: '' }));
      showToast('Profile photo removed', 'success');
    } catch {
      showToast('Could not remove your photo. Please try again.', 'error');
    }
  };

  const handleBannerUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      showToast('Updating banner...', 'info');
      const url = await uploadOrEncodeBannerPhoto(file);
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        await setDoc(doc(db, 'users', user.uid), { bannerImage: url }, { merge: true });
      }
      setBannerImage(url);
      showToast('Banner photo updated!', 'success');
    } catch {
      showToast('Could not update banner. Try again.', 'error');
    }
  };

  // Location Autocomplete State
  const [locationQuery, setLocationQuery] = useState('');
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);

  const POPULAR_LOCATIONS = [
    'New York, USA',
    'London, UK',
    'Paris, France',
    'Milan, Italy',
    'Tokyo, Japan',
    'Los Angeles, USA',
    'Seoul, South Korea',
    'Berlin, Germany',
    'Mumbai, India',
    'Delhi, India',
    'Bengaluru, India',
    'Punjab, India',
    'Chandigarh, India',
    'Hyderabad, India',
    'Dubai, UAE',
    'Singapore',
    'Toronto, Canada',
    'Sydney, Australia',
    'Rome, Italy',
    'Barcelona, Spain',
    'San Francisco, USA',
    'Amsterdam, Netherlands',
    'Stockholm, Sweden',
    'Miami, USA',
    'Hong Kong',
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(event.target as Node)) {
        setShowLocationSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredLocations = location
    ? POPULAR_LOCATIONS.filter(loc => loc.toLowerCase().includes(location.toLowerCase()))
    : POPULAR_LOCATIONS.slice(0, 8);

  const handleSave = async () => {
    if (!displayName.trim()) {
      showToast('Please enter your display name.', 'error');
      return;
    }

    setSaving(true);
    try {
      const user = auth.currentUser;
      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

      if (user && !user.isAnonymous) {
        await setDoc(doc(db, 'users', user.uid), {
          displayName: displayName.trim(),
          displayNameLower: displayName.trim().toLowerCase(),
          username: cleanUsername,
          bio: bio.trim(),
          website: website.trim(),
          pronouns: pronouns.trim(),
          gender,
          location: location.trim(),
          birthday,
          photoURL: profileImage || null,
          bannerImage,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        const pubSnap = await getDoc(doc(db, 'publicProfiles', user.uid)).catch(() => null);
        const existingPub = pubSnap?.exists() ? pubSnap.data() : {};

        // Build a strict, clean projection containing ONLY valid public profile keys
        const publicProfilePayload: Record<string, any> = {
          uid: user.uid,
          displayName: displayName.trim(),
          displayNameLower: displayName.trim().toLowerCase(),
          username: cleanUsername,
          photoURL: profileImage || null,
          bio: bio.trim(),
          website: website.trim(),
          location: location.trim(),
          updatedAt: serverTimestamp(),
        };

        if (typeof existingPub?.followersCount === 'number') {
          publicProfilePayload.followersCount = existingPub.followersCount;
        }
        if (typeof existingPub?.followingCount === 'number') {
          publicProfilePayload.followingCount = existingPub.followingCount;
        }
        if (typeof existingPub?.postsCount === 'number') {
          publicProfilePayload.postsCount = existingPub.postsCount;
        }
        if (existingPub?.lastActiveAt) {
          publicProfilePayload.lastActiveAt = existingPub.lastActiveAt;
        }

        await setDoc(doc(db, 'publicProfiles', user.uid), publicProfilePayload).catch(() => {});

        if (user.displayName !== displayName.trim()) {
          await updateAuthProfile(user, { displayName: displayName.trim() }).catch(() => {});
        }
      }

      setUserProfile(prev => ({
        ...prev,
        displayName: displayName.trim(),
        profileName: displayName.trim(),
        username: cleanUsername,
        gender,
        bio: bio.trim(),
        location: location.trim(),
        website: website.trim(),
        photoURL: profileImage || undefined,
      }));

      showToast('Profile Saved', 'success');
      goBack('/profile');
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      console.error('[EditProfile] Save failed — code:', err?.code, '| message:', err?.message);
      showToast('Failed to save profile. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col relative pb-32">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
      <AppBar title="Edit profile" onBack={handleBackAttempt} />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
        <div className="flex flex-col items-center border-b border-line px-6 py-8">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="h-24 w-24 overflow-hidden rounded-full bg-surface-2 active:scale-95 transition-transform">
            {profileImage ? <img src={profileImage} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <span className="flex h-full items-center justify-center font-display text-[36px] text-ink">{(displayName || 'Z').charAt(0).toUpperCase()}</span>}
          </button>
          <div className="mt-3 flex items-center gap-5 text-[12px] font-semibold">
            <button onClick={() => fileInputRef.current?.click()} className="text-brand">Change profile photo</button>
            {profileImage && <button onClick={handleRemovePhoto} className="text-danger">Remove photo</button>}
          </div>
        </div>
        <div className="divide-y divide-line">
          <ProfileField label="Name"><input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Name" className="profile-edit-input" /></ProfileField>
          <ProfileField label="Username"><input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" className="profile-edit-input" /></ProfileField>
          <ProfileField label="Bio">
            <div className="w-full flex flex-col gap-1">
              <textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 150))} rows={3} placeholder="Bio" className="profile-edit-input resize-none" maxLength={150} />
              <span className="text-[10px] text-ink-faint text-right">{bio.length} / 150</span>
            </div>
          </ProfileField>
          <ProfileField label="Website"><input value={website} onChange={e => setWebsite(e.target.value)} placeholder="Website" className="profile-edit-input" /></ProfileField>
          <ProfileField label="Location">
            <div ref={locationRef} className="relative w-full">
              <input
                value={location}
                onChange={e => {
                  setLocation(e.target.value);
                  setShowLocationSuggestions(true);
                }}
                onFocus={() => setShowLocationSuggestions(true)}
                placeholder="City, Country"
                className="profile-edit-input"
              />
              {showLocationSuggestions && filteredLocations.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface-1 py-1 shadow-2xl backdrop-blur-xl">
                  {filteredLocations.map(loc => (
                    <button
                      key={loc}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setLocation(loc);
                        setShowLocationSuggestions(false);
                      }}
                      className="w-full px-4 py-2 text-left text-[13px] text-ink hover:bg-surface-2 transition-colors flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[16px] text-ink-soft">location_on</span>
                      <span>{loc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </ProfileField>
          <ProfileField label="Birthday"><input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} className="profile-edit-input" /></ProfileField>
          <ProfileField label="Gender"><select value={gender} onChange={e => setGender(e.target.value)} className="profile-edit-input"><option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option></select></ProfileField>
        </div>
      </div>

      {/* Floating Glass Save Action */}
      <div className="fixed bottom-0 inset-x-0 z-50 w-full px-6 pb-8 pt-4 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent phone-fixed-bottom">
        <Button
          size="lg"
          fullWidth
          loading={saving}
          onClick={handleSave}
          icon="check"
        >
          Save
        </Button>
      </div>

      {/* Unsaved Changes Discard Confirmation */}
      <Modal
        open={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        title="Discard unsaved changes?"
        description="You have unsaved changes. Are you sure you want to discard them and return to your profile?"
        actions={
          <>
            <Button variant="secondary" fullWidth onClick={() => setShowDiscardModal(false)}>Keep editing</Button>
            <Button variant="danger" fullWidth onClick={() => { setShowDiscardModal(false); goBack('/profile'); }}>Discard</Button>
          </>
        }
      />
    </div>
  );
};

export default EditProfile;
