import React from "react";

const ProductCard = ({ product }) => {
  return (
    <article className="relative h-screen w-full snap-start overflow-hidden bg-black">
      <img
        src={product.image}
        alt={product.title}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 z-10 p-6 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-white/70">{product.brand}</p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight">{product.title}</h2>
        <p className="mt-2 text-lg font-medium">{product.price}</p>
        <p className="mt-1 text-sm text-white/80">Recommended Size: M</p>
      </div>
    </article>
  );
};

export default ProductCard;
