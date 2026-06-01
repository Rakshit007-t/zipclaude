import React from "react";
import ProductCard from "../components/ProductCard";

const products = [
  {
    title: "Midnight Satin Drape Dress",
    price: "₹2,999",
    brand: "VELA",
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Oversized Linen Resort Shirt",
    price: "₹1,899",
    brand: "NOUVEAU",
    image:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Structured Utility Co-ord Set",
    price: "₹3,499",
    brand: "AERON",
    image:
      "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Classic Streetwear Bomber",
    price: "₹4,299",
    brand: "RIVR",
    image:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Minimal Monochrome Evening Set",
    price: "₹5,199",
    brand: "ZIPRIGHT EDIT",
    image:
      "https://images.unsplash.com/photo-1464863979621-258859e62245?auto=format&fit=crop&w=1400&q=80",
  },
];

const Home = () => {
  return (
    <main className="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth bg-black no-scrollbar">
      {products.map((product) => (
        <ProductCard key={`${product.brand}-${product.title}`} product={product} />
      ))}
    </main>
  );
};

export default Home;
