import React, { useMemo, useRef, useState } from "react";

const CLOSE_THRESHOLD = 90;

const BottomSheet = ({
  open,
  product,
  hasRunEngine,
  recommendedSize,
  confidence,
  reason,
  onClose,
  onRunFitEngine,
  onShopNow,
}) => {
  const startYRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const transform = useMemo(() => {
    if (!open) {
      return "translateY(100%)";
    }
    return `translateY(${Math.max(0, dragY)}px)`;
  }, [open, dragY]);

  const beginDrag = (clientY) => {
    startYRef.current = clientY;
    setDragging(true);
  };

  const moveDrag = (clientY) => {
    if (startYRef.current === null) return;
    const delta = clientY - startYRef.current;
    setDragY(delta > 0 ? delta : 0);
  };

  const endDrag = () => {
    if (dragY > CLOSE_THRESHOLD) {
      onClose();
    }
    startYRef.current = null;
    setDragY(0);
    setDragging(false);
  };

  const handleTouchStart = (event) => {
    beginDrag(event.touches[0].clientY);
  };

  const handleTouchMove = (event) => {
    moveDrag(event.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    endDrag();
  };

  const handlePointerDown = (event) => {
    beginDrag(event.clientY);
  };

  const handlePointerMove = (event) => {
    if (!dragging) return;
    moveDrag(event.clientY);
  };

  const handlePointerUp = () => {
    if (!dragging) return;
    endDrag();
  };

  if (!product) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-[55] bg-black/65 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      <div
        className={`fixed inset-x-0 bottom-0 z-[60] h-[80vh] bg-[#111111] rounded-t-[2.5rem] border-t border-white/10 overflow-y-auto no-scrollbar ${dragging ? "" : "transition-transform duration-300 ease-out"}`}
        style={{ transform }}
      >
        <div
          className="sticky top-0 z-10 bg-[#111111]/95 backdrop-blur-md"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="flex justify-center pt-4 pb-2">
            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
          </div>
          <div className="absolute right-4 top-3">
            <button onClick={onClose} className="h-9 w-9 rounded-full bg-white/10 border border-white/15 active:scale-95">
              <span className="material-symbols-outlined text-white text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="px-6 pb-8 pt-4">
          <div className="flex gap-4 mb-8">
            <div className="h-24 w-24 rounded-2xl overflow-hidden border border-white/10 shrink-0">
              <img src={product.image} alt={product.title} className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col justify-center">
              <h3 className="text-white font-bold text-xl tracking-tight">{product.brand}</h3>
              <p className="text-white/60 text-sm mt-1 line-clamp-2">{product.title}</p>
              <p className="text-[#B5853F] font-black text-lg mt-2">{product.price}</p>
            </div>
          </div>

          <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10 mb-8 text-center">
            <span className="material-symbols-outlined text-[#B5853F] text-4xl mb-3">straighten</span>
            <p className="text-white font-bold mb-2">Get Your Perfect Fit</p>
            {hasRunEngine && recommendedSize ? (
              <div className="mb-6 px-4">
                <p className="text-lg font-semibold text-white">
                  Recommended Size: {recommendedSize}
                </p>
                {reason ? (
                  <p className="text-sm text-gray-400 mt-1">
                    {reason}
                  </p>
                ) : null}
                {confidence ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Confidence: {confidence}
                  </p>
                ) : null}
              </div>
            ) : null}
            <button
              onClick={onRunFitEngine}
              className="bg-[#B5853F] text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest active:scale-95"
            >
              RUN FIT ENGINE
            </button>
          </div>

          <button
            onClick={onShopNow}
            className="w-full bg-white text-[#111111] py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl active:scale-95"
          >
            SHOP NOW
          </button>
        </div>
      </div>
    </>
  );
};

export default BottomSheet;
