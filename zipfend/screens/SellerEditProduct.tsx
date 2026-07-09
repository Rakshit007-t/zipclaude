import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { getProduct, updateProduct, deleteProduct, duplicateProduct, uploadProductImage, SellerProduct } from '../services/ziprightApi';

interface SizeRow {
  size: string;
  value: number;
}

const SellerEditProduct: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Fetching product details...');
  const [originalProduct, setOriginalProduct] = useState<SellerProduct | null>(null);

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
  const [status, setStatus] = useState<'active' | 'draft' | 'archived'>('active');

  // Size Chart Row Form State
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeValue, setNewSizeValue] = useState<number | ''>('');

  // Image replacement index track
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);

  // Load product
  const loadDetails = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setLoadingText('Fetching product details...');
      const p = await getProduct(id);
      setOriginalProduct(p);
      
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
      setStatus(p.status || 'active');
      
      if (p.size_chart) {
        const rows = Object.entries(p.size_chart).map(([size, value]) => ({
          size,
          value,
        }));
        setSizeChart(rows);
      } else {
        setSizeChart([]);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to retrieve product details.', 'error');
      navigate('/seller/catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  }, [id]);

  // Handle Edit/Save details
  const handleSave = async () => {
    if (!id || !originalProduct) return;
    if (!title.trim()) {
      showToast('Product title is required.', 'error');
      return;
    }

    try {
      setLoading(true);
      setLoadingText('Saving changes...');

      const sizeChartDict: Record<string, number> = {};
      sizeChart.forEach((row) => {
        sizeChartDict[row.size] = row.value;
      });

      const colors = colorsInput.split(',').map(s => s.trim()).filter(Boolean);
      const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);

      const payload = {
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
        status,
        expected_updated_at: originalProduct.updated_at,
      };

      await updateProduct(id, payload);
      showToast('Product saved successfully!', 'success');
      navigate('/seller/catalog');
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('updated by another session')) {
        showToast('This product was updated by another session. Please reload and try again.', 'error');
      } else {
        showToast(err.message || 'Failed to save changes.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Duplicate product
  const handleDuplicateProduct = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setLoadingText('Duplicating product...');
      const duplicated = await duplicateProduct(id);
      showToast('Product duplicated successfully.', 'success');
      navigate(`/seller/edit-product/${duplicated.id}`);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Duplication failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Delete product
  const handleDeleteProduct = async () => {
    if (!id || !window.confirm('Are you sure you want to delete this product?')) return;
    try {
      setLoading(true);
      setLoadingText('Deleting product...');
      await deleteProduct(id);
      showToast('Product deleted.', 'success');
      navigate('/seller/catalog');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Delete operation failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Size chart row builders
  const handleAddSizeRow = () => {
    if (!newSizeName.trim()) {
      showToast('Enter size name (e.g. S, M)', 'error');
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

  // Image Management Handlers
  const handleAddProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    
    if (productImages.length >= 6) {
      showToast('Maximum 6 images allowed.', 'error');
      return;
    }

    try {
      setLoading(true);
      setLoadingText('Uploading attachment...');
      const res = await uploadProductImage(file);
      setProductImages(prev => [...prev, res.url]);
      showToast('Image uploaded successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Image upload failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReplaceProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || replacingIndex === null) return;
    const file = files[0];

    try {
      setLoading(true);
      setLoadingText('Replacing image...');
      const res = await uploadProductImage(file);
      setProductImages(prev => {
        const copy = [...prev];
        copy[replacingIndex] = res.url;
        return copy;
      });
      showToast('Image replaced successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Image replacement failed.', 'error');
    } finally {
      setReplacingIndex(null);
      setLoading(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    setProductImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleMoveImage = (index: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= productImages.length) return;
    
    setProductImages(prev => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-[1000] flex flex-col items-center justify-center p-6">
          <div className="bg-white dark:bg-surface-1 p-8 rounded-[2.5rem] border border-black/5 dark:border-line flex flex-col items-center max-w-sm text-center shadow-2xl">
            <div className="h-16 w-16 border-4 border-[#6157FF] dark:border-[#6157FF] border-t-transparent rounded-full animate-spin mb-6"></div>
            <h3 className="text-lg font-bold mb-2">Processing</h3>
            <p className="text-xs text-[#555555] dark:text-ink-soft font-medium leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Sticky Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button 
          onClick={() => navigate('/seller/catalog')} 
          aria-label="Go back" className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">Edit Product</h2>
        <div className="w-8"></div>
      </div>

      {/* Hidden File Inputs for Image Actions */}
      <input 
        type="file" 
        ref={addInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleAddProductImage}
      />
      <input 
        type="file" 
        ref={replaceInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleReplaceProductImage}
      />

      {/* Form Content area */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-36">
        <div className="max-w-md mx-auto flex flex-col gap-6">

          {/* SECTION 1: IMAGE MANAGER */}
          <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-4">
            <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft">Image Manager</h3>

            <div className="grid grid-cols-3 gap-3">
              {productImages.map((img, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-black/5 dark:border-line group">
                  <img src={img} alt={`Product ${idx}`} className="h-full w-full object-cover"/>
                  
                  {/* Operations overlay */}
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-2 transition-all duration-300">
                    <div className="flex gap-1.5">
                      <button 
                        onClick={() => { setReplacingIndex(idx); replaceInputRef.current?.click(); }}
                        className="p-1.5 bg-surface-3 rounded-full hover:bg-white/40 text-ink"
                        title="Replace Image"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <button 
                        onClick={() => handleRemoveImage(idx)}
                        className="p-1.5 bg-red-500/20 rounded-full hover:bg-red-500/40 text-red-600"
                        title="Delete Image"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>

                    <div className="flex gap-1.5">
                      {idx > 0 && (
                        <button 
                          onClick={() => handleMoveImage(idx, 'left')}
                          className="p-1.5 bg-surface-3 rounded-full hover:bg-white/40 text-ink"
                          title="Move Left"
                        >
                          <span className="material-symbols-outlined text-sm">chevron_left</span>
                        </button>
                      )}
                      {idx < productImages.length - 1 && (
                        <button 
                          onClick={() => handleMoveImage(idx, 'right')}
                          className="p-1.5 bg-surface-3 rounded-full hover:bg-white/40 text-ink"
                          title="Move Right"
                        >
                          <span className="material-symbols-outlined text-sm">chevron_right</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {productImages.length < 6 && (
                <div 
                  onClick={() => addInputRef.current?.click()}
                  className="aspect-square border-2 border-dashed border-black/10 dark:border-line hover:border-[#6157FF] rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-2xl text-[#6157FF]">add_photo_alternate</span>
                  <span className="text-[11px] font-bold mt-1">Add Image</span>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: EDIT FIELDS */}
          <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-5">
            
            {/* Title */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Title *</label>
              <input 
                type="text" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
              />
            </div>

            {/* Brand */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Brand</label>
              <input 
                type="text" 
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
              />
            </div>

            {/* Category & Gender */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Category</label>
                <input 
                  type="text" 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Gender</label>
                <input 
                  type="text" 
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
                />
              </div>
            </div>

            {/* Price & Pattern */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Price</label>
                <input 
                  type="text" 
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Pattern</label>
                <input 
                  type="text" 
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-sm"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Description</label>
              <textarea 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-24 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 py-3 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-colors text-xs resize-none"
              />
            </div>

            {/* Status Selector */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-sm"
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>

          </div>

          {/* SECTION 3: SPEC SHEET DETAILS */}
          <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-5">
            <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft">Garment Specs</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Fabric</label>
                <input 
                  type="text" 
                  value={fabric}
                  onChange={(e) => setFabric(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Fit Type</label>
                <input 
                  type="text" 
                  value={fitType}
                  onChange={(e) => setFitType(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Sleeve Type</label>
                <input 
                  type="text" 
                  value={sleeveType}
                  onChange={(e) => setSleeveType(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Neck Type</label>
                <input 
                  type="text" 
                  value={neckType}
                  onChange={(e) => setNeckType(e.target.value)}
                  className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
                />
              </div>
            </div>

            {/* Colors */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Colors (comma separated)</label>
              <input 
                type="text" 
                value={colorsInput}
                onChange={(e) => setColorsInput(e.target.value)}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs font-bold text-[#555555] dark:text-ink-soft tracking-wide block mb-2">Tags (comma separated)</label>
              <input 
                type="text" 
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full h-12 bg-[#FAF9F6] dark:bg-surface-0 border border-black/5 dark:border-line rounded-2xl px-4 font-bold text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] text-xs"
              />
            </div>
          </div>

          {/* SECTION 4: SIZE CHART BUILDER */}
          <div className="flex flex-col bg-white dark:bg-surface-1 p-6 rounded-[2rem] border border-black/5 dark:border-line shadow-sm gap-4">
            <h3 className="text-xs font-bold text-[#555555] dark:text-ink-soft">Sizing Specifications</h3>
            
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

          {/* DUPLICATE AND DELETE CONTROLS */}
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={handleDuplicateProduct}
              className="h-14 rounded-2xl border border-black/10 dark:border-line bg-white dark:bg-surface-1 text-gray-500 dark:text-gray-300 font-bold text-xs active:scale-95 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">content_copy</span>
              Duplicate
            </button>
            <button 
              onClick={handleDeleteProduct}
              className="h-14 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold text-xs active:scale-95 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Delete
            </button>
          </div>

        </div>
      </div>

      {/* STICKY BOTTOM ACTIONS FOR REVIEW */}
      <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6] to-transparent dark:from-[#121212] dark:via-[#121212] dark:to-transparent z-40 shrink-0">
        <div className="flex gap-4 max-w-md mx-auto bg-white/40 dark:bg-black/40 backdrop-blur-xl p-4 rounded-3xl border border-black/5 dark:border-line shadow-lg">
          <button 
            onClick={() => navigate('/seller/catalog')}
            className="flex-1 h-14 rounded-2xl border border-black/10 dark:border-line text-[#555555] dark:text-ink-soft bg-white dark:bg-surface-1 font-bold text-sm transition-all active:scale-95"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="flex-[2] h-14 rounded-2xl bg-green-500 text-ink font-bold text-sm transition-all active:scale-95 shadow-md flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            Save Changes
          </button>
        </div>
      </div>

    </div>
  );
};

export default SellerEditProduct;
