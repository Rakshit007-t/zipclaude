import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';

const Welcome: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.currentUser) {
      navigate('/home');
    }
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#111111] text-white p-8 text-center">
      <h1 className="text-4xl font-black mb-4 tracking-tighter uppercase text-[#B5853F]">
        Welcome to <span className="text-white">Zip</span>RIGHT
      </h1>
      <p className="text-[#A0A0A0] mb-12 font-medium">Your personal AI fashion stylist and body-perfect fit analyzer.</p>
      <button 
        onClick={() => navigate('/login')}
        className="w-full h-14 bg-[#B5853F] text-white font-black rounded-2xl uppercase tracking-widest shadow-xl shadow-[#B5853F]/20 active:scale-95 transition-all"
      >
        Get Started
      </button>
    </div>
  );
};

export default Welcome;
