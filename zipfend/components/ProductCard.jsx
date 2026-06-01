import React from "react";

const ProductCard = ({ product, onSeeMore }) => {
  return (
    <div className="absolute bottom-20 left-0 right-20 z-40 pl-4">
      <div className="bg-black/60 backdrop-blur-xl rounded-[1.5rem] px-5 py-4 border border-white/10 shadow-2xl">
        <div className="flex items-end justify-between">
          <div className="flex-1 mr-4">
            <p className="text-white font-bold text-base tracking-tight">{product.brand}</p>
            <p className="text-white/80 text-xs mt-0.5 line-clamp-1 font-medium">{product.title}</p>
          </div>
          <button
            onClick={onSeeMore}
            className="text-white/90 text-xs font-bold underline underline-offset-4 active:scale-95 shrink-0"
          >
            see more...
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
