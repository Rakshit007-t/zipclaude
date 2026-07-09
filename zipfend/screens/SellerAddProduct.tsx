import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { importProduct, createProduct, ProductPreview, ProductDraft } from '../services/ziprightApi';

interface SizeRow {
  size: string;
  value: number;
}

const SellerAddProduct: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  // UI Navigation
  const [activeTab, setActiveTab] = useState<'url' | 'image'>('url');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('AI is analyzing product details...');
  const [previewData, setPreviewData] = useState<ProductPreview | null>(null);

  // URL Ingestion State
  const [urlInput, setUrlInput] = useState('');

  // Image Ingestion State
  const [imagesList, setImagesList] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit Preview States
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [gender, setGender] = useState('');
  const [description, setDescription] = useState('');
  const [fabric, setFabric] = useState('');
  const [sleeveType, setSleeveType] = useState('');
  const [neckType, setNeckType] = useState('');
  const [fitType, setFitType] = useState('');
  const [pattern, setPattern] = useState('');
  const [colorsInput, setColorsInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [sizeChart, setSizeChart] = useState<SizeRow[]>([]);

  // Size Chart Row Form State
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeValue, setNewSizeValue] = useState<number | ''>('');

  // Handle URL Import
  const handleUrlImport = async () => {
    if (!urlInput.trim()) {
      showToast('Please enter a product URL.', 'error');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Fetching store information and details...');
      const res = await importProduct({ url: urlInput });
      initPreview(res);
      showToast('Product analyzed successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to import from URL.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Base64 Uploader Helpers
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    Array.from(files).forEach((file) => {
      if (imagesList.length >= 6) {
        showToast('Maximum 6 images allowed.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Str = event.target?.result as string;
        if (base64Str) {
          setImagesList((prev) => [...prev, base64Str]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeUploadImage = (index: number) => {
    setImagesList((prev) => prev.filter((_, i) => i !== index));
  };

  // Handle Image Import
  const handleImageImport = async () => {
    if (imagesList.length === 0) {
      showToast('Please upload at least one image.', 'error');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Analyzing fabric textures and visual attributes...');
      const res = await importProduct({ images: imagesList });
      initPreview(res);
      showToast('Images analyzed successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to analyze images.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Initialize preview form states
  const initPreview = (data: ProductPreview) => {
    setPreviewData(data);
    const p = data.product;
    setTitle(p.title || '');
    setBrand(p.brand || '');
    setPrice(p.price || '');
    setCategory(p.category || '');
    setGender(p.gender || '');
    setDescription(p.description || '');
    setFabric(p.fabric || '');
    setSleeveType(p.sleeve_type || '');
    setNeckType(p.neck_type || '');
    setFitType(p.fit_type || '');
    setPattern(p.pattern || '');
    setColorsInput(p.colors ? p.colors.join(', ') : '');
    setTagsInput(p.tags ? p.tags.join(', ') : '');
    setSourceUrl(p.source_url || '');
    setProductImages(p.images || []);
    
    // Map backend dict to size rows
    if (p.size_chart) {
      const rows = Object.entries(p.size_chart).map(([size, value]) => ({
        size,
        value,
      }));
      setSizeChart(rows);
    } else {
      setSizeChart([]);
    }
  };

  // Add Row to Size Chart
  const handleAddSizeRow = () => {
    if (!newSizeName.trim()) {
      showToast('Enter size name (e.g. S, M, L)', 'error');
      return;
    }
    if (newSizeValue === '' || isNaN(Number(newSizeValue))) {
      showToast('Enter a valid measurement value', 'error');
      return;
    }
    
    const sizeName = newSizeName.trim().toUpperCase();
    if (sizeChart.some(r => r.size === sizeName)) {
      showToast('Size already exists in chart.', 'error');
      return;
    }

    setSizeChart(prev => [...prev, { size: sizeName, value: Number(newSizeValue) }]);
    setNewSizeName('');
    setNewSizeValue('');
  };

  const handleRemoveSizeRow = (sizeName: string) => {
    setSizeChart(prev => prev.filter(r => r.size !== sizeName));
  };

  // Persist product on approve
  const handleSaveProduct = async () => {
    if (!title.trim()) {
      showToast('Product title is required.', 'error');
      return;
    }
    if (!previewData) return;

    try {
      setLoading(true);
      setLoadingText('Saving product to repository...');
      
      const sizeChartDict: Record<string, number> = {};
      sizeChart.forEach((row) => {
        sizeChartDict[row.size] = row.value;
      });

      const colors = colorsInput.split(',').map(s => s.trim()).filter(Boolean);
      const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);

      const payload: ProductDraft & { generated_fields: string[] } = {
        title: title.trim(),
        description: description.trim(),
        brand: brand.trim(),
        category: category.trim(),
        gender: gender.trim(),
        fabric: fabric.trim(),
        colors,
        images: productImages,
        size_chart: Object.keys(sizeChartDict).length > 0 ? sizeChartDict : null,
        fit_type: fitType.trim(),
        sleeve_type: sleeveType.trim(),
        neck_type: neckType.trim(),
        pattern: pattern.trim(),
        tags,
        price: price.trim() || null,
        source_url: sourceUrl.trim() || null,
        generated_fields: previewData.generated_fields,
      };

      await createProduct(payload);
      showToast('Product onboarding completed successfully!', 'success');
      navigate('/settings');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to save product.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper component for AI field badge
  const AiBadge: React.FC<{ fieldName: string }> = ({ fieldName }) => {
    if (!previewData?.generated_fields.includes(fieldName)) return null;
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#6157FF] dark:text-[#6157FF] bg-[#6157FF]/10 dark:bg-[#6157FF]/10 px-2 py-0.5 rounded-full scale-90">
        <span className="material-symbols-outlined text-[12px] filled" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        AI Estimated
      </span>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-[1000] flex flex-col items-center justify-center p-6">
          <div className="bg-white dark:bg-surface-1 p-8 rounded-[2.5rem] border border-black/5 dark:border-line flex flex-col items-center max-w-sm text-center shadow-2xl">
            <div className="h-16 w-16 border-4 border-[#6157FF] dark:border-[#6157FF] border-t-transparent rounded-full animate-spin mb-6"></div>
            <h3 className="text-lg font-bold mb-2">Analyzing Product</h3>
            <p className="text-xs text-[#555555] dark:text-ink-soft font-medium leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Sticky Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button 
          onClick={() => {
            if (previewData) {
              setPreviewData(null);
            } else {
              navigate('/settings');
            }
          }} 
          aria-label="Go back" className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">{previewData ? 'Approve Product' : 'Import Product'}</h2>
        <div className="w-8"></div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        
        {!previewData ? (
          /* SECTION 1: INGESTION CONTROLS */
          <div className="p-6 max-w-md mx-auto flex flex-col gap-6">
            <div className="text-center">
              <span className="inline-block px-3 py-1 rounded-full bg-[#6157FF]/10 text-[#6157FF] dark:bg-[#6157FF]/10 dark:text-[#6157FF] text-[12px] font-bold mb-2">New Product Ingestion</span>
              <h1 className="text-2xl font-bold mb-1">Add to Catalog</h1>
              <p className="text-xs text-[#555555] dark:text-ink-soft font-medium max-w-xs mx-auto">Analyze details automatically from a product listing URL or pictures.</p>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex bg-black/5 dark:bg-surface-2 p-1 rounded-2xl relative w-full">
              <button 
                onClick={() => setActiveTab('url')}
                className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'url' ? 'bg-white dark:bg-surface-1 text-[#111111] dark:text-ink shadow-sm' : 'text-[#555555] dark:text-ink-soft'}`}
              >
                <span className="material-symbols-outlined text-sm">link</span>
                URL Import
              </button>
              <button 
                onClick={() => setActiveTab('image')}
                className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'image' ? 'bg-white dark:bg-surface-1 text-[#111111] dark:text-ink shadow-sm' : 'text-[#555555] dark:text-ink-soft'}`}
              >
                <span className="material-symbols-outlined text-sm">image</span>
                Image Upload
              </button>
            </div>

            {/* URL PANEL */}
            {activeTab === 'url' && (
              <div className="bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm flex flex-col gap-5">
                <div>
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Product Store URL</label>
                  <input 
                    type="url" 
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/product/123"
                    className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] dark:focus:border-[#6157FF] transition-colors text-sm"
                  />
                </div>
                <button 
                  onClick={handleUrlImport}
                  className="w-full h-14 bg-surface-0 text-ink dark:bg-white dark:text-[#111111] rounded-2xl font-bold text-sm active:scale-95 shadow-md flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">auto_awesome</span>
                  Analyze Listing
                </button>
              </div>
            )}

            {/* IMAGE PANEL */}
            {activeTab === 'image' && (
              <div className="bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm flex flex-col gap-6">
                <div>
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Upload Images (Max 6)</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-black/10 dark:border-line hover:border-[#6157FF] rounded-[1.5rem] py-8 px-4 flex flex-col items-center justify-center cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-3xl text-[#6157FF] mb-2">upload_file</span>
                    <span className="text-xs font-bold">Select Files</span>
                    <span className="text-[12px] text-[#555555] dark:text-ink-soft mt-1">PNG, JPG or WebP</span>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageFileChange}
                  />
                </div>

                {/* THUMBNAILS GRID */}
                {imagesList.length > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    {imagesList.map((imgUrl, index) => (
                      <div key={index} className="relative aspect-square rounded-xl overflow-hidden border border-black/5 dark:border-line group">
                        <img src={imgUrl} alt="Upload Preview" className="h-full w-full object-cover"/>
                        <button 
                          onClick={() => removeUploadImage(index)}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300"
                        >
                          <span className="material-symbols-outlined text-ink text-xl">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button 
                  onClick={handleImageImport}
                  disabled={imagesList.length === 0}
                  className="w-full h-14 bg-surface-0 text-ink dark:bg-white dark:text-[#111111] rounded-2xl font-bold text-sm active:scale-95 shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">auto_awesome</span>
                  Analyze Pictures
                </button>
              </div>
            )}

          </div>
        ) : (
          /* SECTION 2: EDITABLE PREVIEW FORM */
          <div className="p-6 max-w-md mx-auto flex flex-col gap-6 pb-36">
            
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-[12px] font-bold mb-2">Extraction Loaded</span>
              <h1 className="text-2xl font-bold mb-1">Verify Details</h1>
              <p className="text-xs text-[#555555] dark:text-ink-soft font-medium leading-relaxed">
                Review, correct, and populate catalog details below. AI generated fields are badged in gold.
              </p>
            </div>

            {/* PREVIEW: BASIC CARD */}
            <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-5">
              
              {/* Product Images View */}
              {productImages.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide">Imported Images</label>
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {productImages.map((img, idx) => (
                      <div key={idx} className="h-20 w-20 rounded-xl overflow-hidden border border-black/5 dark:border-line shrink-0">
                        <img src={img} alt={`Preview ${idx}`} className="h-full w-full object-cover"/>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Title Input */}
              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Title *</label>
                  <AiBadge fieldName="title" />
                </div>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('title') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                />
              </div>

              {/* Brand Input */}
              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Brand</label>
                  <AiBadge fieldName="brand" />
                </div>
                <input 
                  type="text" 
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('brand') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                />
              </div>

              {/* Category & Gender */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Category</label>
                    <AiBadge fieldName="category" />
                  </div>
                  <input 
                    type="text" 
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. tshirt"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('category') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Gender</label>
                    <AiBadge fieldName="gender" />
                  </div>
                  <input 
                    type="text" 
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    placeholder="e.g. men, women, unisex"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('gender') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
              </div>

              {/* Price & Pattern */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Price</label>
                    <AiBadge fieldName="price" />
                  </div>
                  <input 
                    type="text" 
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="e.g. Rs. 999"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('price') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Pattern</label>
                    <AiBadge fieldName="pattern" />
                  </div>
                  <input 
                    type="text" 
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="e.g. solid, striped"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-sm ${previewData.generated_fields.includes('pattern') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Description</label>
                  <AiBadge fieldName="description" />
                </div>
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`w-full h-24 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 py-3 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs resize-none ${previewData.generated_fields.includes('description') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                />
              </div>

            </div>

            {/* PREVIEW: FABRIC SPEC SHEET CARD */}
            <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-5">
              <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft">Garment Specs</h3>

              <div className="grid grid-cols-2 gap-4">
                {/* Fabric */}
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Fabric</label>
                    <AiBadge fieldName="fabric" />
                  </div>
                  <input 
                    type="text" 
                    value={fabric}
                    onChange={(e) => setFabric(e.target.value)}
                    placeholder="e.g. Cotton"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('fabric') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
                {/* Fit Type */}
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Fit Type</label>
                    <AiBadge fieldName="fit_type" />
                  </div>
                  <input 
                    type="text" 
                    value={fitType}
                    onChange={(e) => setFitType(e.target.value)}
                    placeholder="e.g. regular, oversized"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('fit_type') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Sleeve Type */}
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Sleeve Type</label>
                    <AiBadge fieldName="sleeve_type" />
                  </div>
                  <input 
                    type="text" 
                    value={sleeveType}
                    onChange={(e) => setSleeveType(e.target.value)}
                    placeholder="e.g. short sleeve"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('sleeve_type') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
                {/* Neck Type */}
                <div className="relative">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Neck Type</label>
                    <AiBadge fieldName="neck_type" />
                  </div>
                  <input 
                    type="text" 
                    value={neckType}
                    onChange={(e) => setNeckType(e.target.value)}
                    placeholder="e.g. crew neck"
                    className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('neck_type') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                  />
                </div>
              </div>

              {/* Colors (comma separated list) */}
              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Colors (comma separated)</label>
                  <AiBadge fieldName="colors" />
                </div>
                <input 
                  type="text" 
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                  placeholder="e.g. black, white"
                  className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('colors') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                />
              </div>

              {/* Tags */}
              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block">Tags (comma separated)</label>
                  <AiBadge fieldName="tags" />
                </div>
                <input 
                  type="text" 
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className={`w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none transition-colors text-xs ${previewData.generated_fields.includes('tags') ? 'border-amber-200 dark:border-amber-900/50 focus:border-[#6157FF]' : 'border-black/5 dark:border-line focus:border-[#6157FF]'}`}
                />
              </div>

              {/* Source URL (Hidden input/display) */}
              {sourceUrl && (
                <div>
                  <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide mb-2 block">Source URL</label>
                  <p className="text-[12px] text-[#555555] dark:text-ink-soft truncate max-w-[320px] font-bold">{sourceUrl}</p>
                </div>
              )}

            </div>

            {/* PREVIEW: SIZE CHART BUILDER CARD */}
            <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-4">
              <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft">Sizing Specifications</h3>
              
              {/* CURRENT SIZE TABLE */}
              {sizeChart.length === 0 ? (
                <p className="text-[11px] text-[#555555] dark:text-ink-soft font-bold text-center py-4 bg-[#FAF9F6] dark:bg-surface-0 rounded-2xl">
                  No sizes defined yet. Add standard sizes below.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[12px] font-bold text-[#555555] dark:text-ink-soft px-2 border-b border-black/5 dark:border-line pb-2">
                    <span>Size</span>
                    <span>Chest Value (cm)</span>
                    <span className="w-8"></span>
                  </div>
                  {sizeChart.map((row) => (
                    <div key={row.size} className="flex justify-between items-center text-xs font-bold text-[#111111] dark:text-ink px-2 py-2.5 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl">
                      <span>{row.size}</span>
                      <span>{row.value}</span>
                      <button 
                        onClick={() => handleRemoveSizeRow(row.size)}
                        className="text-red-500 hover:text-red-700 flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ADD SIZE ROW INLINE FORM */}
              <div className="h-[1px] bg-black/5 dark:bg-surface-2 my-2"></div>
              
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-1">Size Name</label>
                  <input 
                    type="text" 
                    value={newSizeName}
                    onChange={(e) => setNewSizeName(e.target.value)}
                    placeholder="e.g. M"
                    className="w-full h-10 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-3 font-bold text-[#111111] dark:text-ink text-xs focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-1">Chest Value</label>
                  <input 
                    type="number" 
                    value={newSizeValue === '' ? '' : newSizeValue}
                    onChange={(e) => setNewSizeValue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 100"
                    className="w-full h-10 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-xl px-3 font-bold text-[#111111] dark:text-ink text-xs focus:outline-none"
                  />
                </div>
                <button 
                  onClick={handleAddSizeRow}
                  className="h-10 bg-[#6157FF] dark:bg-[#6157FF] text-ink px-4 rounded-xl flex items-center justify-center font-bold text-xs active:scale-95 shrink-0"
                >
                  Add Size
                </button>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* STICKY BOTTOM ACTIONS FOR REVIEW */}
      {previewData && (
        <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6] to-transparent dark:from-[#121212] dark:via-[#121212] dark:to-transparent z-40 shrink-0">
          <div className="flex gap-4 max-w-md mx-auto bg-white/40 dark:bg-black/40 backdrop-blur-xl p-4 rounded-3xl border border-black/5 dark:border-line shadow-lg">
            <button 
              onClick={() => setPreviewData(null)}
              className="flex-1 h-14 rounded-2xl border border-black/10 dark:border-line text-[#555555] dark:text-ink-soft bg-white dark:bg-surface-1 font-bold text-sm transition-all active:scale-95"
            >
              Discard
            </button>
            <button 
              onClick={handleSaveProduct}
              className="flex-[2] h-14 rounded-2xl bg-green-500 text-ink font-bold text-sm transition-all active:scale-95 shadow-md flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">check_circle</span>
              Approve & Save
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default SellerAddProduct;
