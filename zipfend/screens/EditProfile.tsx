import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteField, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { updateProfile as updateAuthProfile } from 'firebase/auth';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { useAppNavigation } from '../utils/useAppNavigation';
import { compressImage } from '../utils/media';
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
  const currentUser = auth.currentUser;

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
    const init = async () => {
      setLoading(true);
      const user = auth.currentUser;
      const currentPhoto = user?.photoURL || localStorage.getItem('zipright_profile_photo') || '';
      setProfileImage(currentPhoto);

      let initialData = {
        displayName: user?.displayName || userProfile.profileName || '',
        username: userProfile.username || (userProfile.profileName ? userProfile.profileName.toLowerCase().replace(/\s+/g, '_') : ''),
        bio: 'Style enthusiast on ZipRIGHT',
        website: '',
        pronouns: '',
        gender: userProfile.gender || 'Male',
        location: 'Bengaluru, India',
        birthday: '1998-05-15',
        bannerImage: '',
      };

      if (user && !user.isAnonymous) {
        try {
          const docSnap = await getDoc(doc(db, 'users', user.uid));
          if (docSnap.exists()) {
            const data = docSnap.data();
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

      setDisplayName(initialData.displayName);
      setUsername(initialData.username);
      setBio(initialData.bio);
      setWebsite(initialData.website);
      setPronouns(initialData.pronouns);
      setGender(initialData.gender);
      setLocation(initialData.location);
      setBirthday(initialData.birthday);
      setBannerImage(initialData.bannerImage);
      // Dirty-state comparison must mirror the fields that are actually
      // editable on this screen. Including the retired banner/pronoun fields
      // made every visit look unsaved and trapped users behind the discard UI.
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
  }, [userProfile]);

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
      const blob = await compressImage(file, 512, 0.85);
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        const storageRef = ref(getStorage(app), `profiles/${user.uid}.jpg`);
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        await updateAuthProfile(user, { photoURL: url }).catch(() => {});
        await setDoc(doc(db, 'users', user.uid), { photoURL: url }, { merge: true });
        await setDoc(doc(db, 'publicProfiles', user.uid), { photoURL: url, updatedAt: serverTimestamp() }, { merge: true });
        setProfileImage(url);
        setUserProfile(prev => ({ ...prev, photoURL: url }));
        showToast('Profile photo updated', 'success');
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setProfileImage(base64);
          try { localStorage.setItem('zipright_profile_photo', base64); } catch {}
        };
        reader.readAsDataURL(blob);
      }
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
        await updateAuthProfile(user, { photoURL: null });
        await setDoc(doc(db, 'users', user.uid), { photoURL: deleteField() }, { merge: true });
        await setDoc(doc(db, 'publicProfiles', user.uid), { photoURL: deleteField(), updatedAt: serverTimestamp() }, { merge: true });
      } else {
        localStorage.removeItem('zipright_profile_photo');
      }
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
      showToast('Compressing & uploading banner...', 'info');
      const blob = await compressImage(file, 1024, 0.80);
      const user = auth.currentUser;
      if (user && !user.isAnonymous) {
        const storageRef = ref(getStorage(app), `banners/${user.uid}.jpg`);
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        await setDoc(doc(db, 'users', user.uid), { bannerImage: url }, { merge: true });
        setBannerImage(url);
        showToast('Banner photo updated!', 'success');
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setBannerImage(base64);
        };
        reader.readAsDataURL(blob);
      }
    } catch {
      showToast('Could not update banner. Try again.', 'error');
    }
  };

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
          bannerImage,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        // Only the explicitly public projection is visible to other members.
        // Fit and account fields above remain in the owner-only users document.
        await setDoc(doc(db, 'publicProfiles', user.uid), {
          uid: user.uid,
          displayName: displayName.trim(),
          displayNameLower: displayName.trim().toLowerCase(),
          username: cleanUsername,
          photoURL: user.photoURL || profileImage || null,
          bio: bio.trim(),
          website: website.trim(),
          location: location.trim(),
          updatedAt: serverTimestamp(),
        }, { merge: true });

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
      }));

      showToast('Profile Saved', 'success');
      goBack('/profile');
    } catch (e) {
      console.error('[EditProfile] Save failed:', e);
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
          <ProfileField label="Bio"><textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 150))} rows={3} placeholder="Bio" className="profile-edit-input resize-none" /></ProfileField>
          <ProfileField label="Website"><input value={website} onChange={e => setWebsite(e.target.value)} placeholder="Website" className="profile-edit-input" /></ProfileField>
          <ProfileField label="Location"><input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" className="profile-edit-input" /></ProfileField>
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
