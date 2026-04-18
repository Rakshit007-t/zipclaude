import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';

const Splash: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (auth.currentUser) {
        navigate('/home');
      } else {
        navigate('/welcome');
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#111111] text-white">
      <div className="relative">
        <h1 className="text-5xl font-black tracking-tighter italic text-[#B5853F]">
          <span className="text-white">Zip</span>RIGHT
        </h1>
        <div className="absolute -bottom-2 right-0 h-1 w-12 bg-[#B5853F]"></div>
      </div>
      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#A0A0A0]">AI Fashion Tech</p>
    </div>
  );
};

export default Splash;
