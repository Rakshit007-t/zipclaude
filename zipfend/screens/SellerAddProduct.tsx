import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { importProduct, createProduct, ProductPreview, ProductDraft } from '../services/ziprightApi';
import { AppBar, Button, Eyebrow, SegmentedControl, Spinner, cn } from '../components/ui';

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

  // Helper component for AI field badge — gold / brass editorial slip
  const AiBadge: React.FC<{ fieldName: string }> = ({ fieldName }) => {
    if (!previewData?.generated_fields.includes(fieldName)) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brass-soft px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-brass">
        <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">auto_awesome</span>
        AI
      </span>
    );
  };

  // Input chrome — brass hairline when the value was AI-estimated
  const fieldCls = (ai: boolean) =>
    cn(
      'w-full h-12 rounded-ctl bg-surface-2 px-4 text-[15px] text-ink placeholder:text-ink-faint',
      'border focus:outline-none focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]',
      ai ? 'border-brass/45 focus:border-brass' : 'border-line focus:border-ink',
    );

  // Field wrapper — eyebrow label + optional AI badge
  const FieldShell: React.FC<{ label: string; fieldName?: string; required?: boolean; children: React.ReactNode }> = ({ label, fieldName, required, children }) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
          {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        </label>
        {fieldName && <AiBadge fieldName={fieldName} />}
      </div>
      {children}
    </div>
  );

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col bg-surface-0 text-ink">

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-scrim p-6 backdrop-blur-md">
          <div className="flex max-w-sm flex-col items-center rounded-card border border-line bg-surface-1 p-8 text-center shadow-float">
            <Spinner size={40} className="mb-6 text-brand" />
            <p className="eyebrow mb-2">Working</p>
            <h3 className="mb-2 font-display text-[22px] font-light text-ink">Analyzing<em className="font-medium">.</em></h3>
            <p className="text-[13px] leading-relaxed text-ink-soft">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <AppBar
        title={previewData ? 'Approve Product' : 'Import Product'}
        onBack={() => {
          if (previewData) {
            setPreviewData(null);
          } else {
            navigate('/settings');
          }
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1">

        {!previewData ? (
          /* SECTION 1: INGESTION CONTROLS */
          <div className="mx-auto flex max-w-md flex-col gap-8 px-6 pt-8 pb-40">
            <div>
              <Eyebrow className="mb-3">New product ingestion</Eyebrow>
              <h1 className="font-display text-[34px] font-light leading-[1.05] text-ink">Add to <em className="font-medium">catalog.</em></h1>
              <p className="mt-4 max-w-[90%] text-[14px] leading-relaxed text-ink-soft">
                Analyze details automatically from a product listing URL or pictures.
              </p>
            </div>

            {/* TAB SELECTOR */}
            <SegmentedControl
              aria-label="Ingestion method"
              value={activeTab}
              onChange={(v) => setActiveTab(v)}
              options={[
                { value: 'url', label: 'URL import', icon: 'link' },
                { value: 'image', label: 'Image upload', icon: 'image' },
              ]}
            />

            {/* URL PANEL */}
            {activeTab === 'url' && (
              <div className="flex flex-col gap-6 rounded-card border border-line bg-surface-1 p-6">
                <FieldShell label="Product store URL">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/product/123"
                    className={fieldCls(false)}
                  />
                </FieldShell>
                <Button size="lg" fullWidth icon="auto_awesome" onClick={handleUrlImport}>
                  Analyze listing
                </Button>
              </div>
            )}

            {/* IMAGE PANEL */}
            {activeTab === 'image' && (
              <div className="flex flex-col gap-6 rounded-card border border-line bg-surface-1 p-6">
                <FieldShell label="Upload images (max 6)">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface-2 py-10 px-4 transition-colors hover:border-brand"
                  >
                    <span className="material-symbols-outlined mb-2 text-[32px] text-brand" aria-hidden="true">upload_file</span>
                    <span className="text-[13px] font-semibold text-ink">Select files</span>
                    <span className="mt-1 text-[11px] uppercase tracking-[0.12em] text-ink-faint">PNG, JPG or WebP</span>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageFileChange}
                  />
                </FieldShell>

                {/* THUMBNAILS GRID */}
                {imagesList.length > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    {imagesList.map((imgUrl, index) => (
                      <div key={index} className="group relative aspect-square overflow-hidden rounded-xl border border-line">
                        <img src={imgUrl} alt="Upload preview" className="h-full w-full object-cover"/>
                        <button
                          onClick={() => removeUploadImage(index)}
                          aria-label="Remove image"
                          className="absolute inset-0 flex items-center justify-center bg-scrim opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                        >
                          <span className="material-symbols-outlined text-[22px] text-ink-invert" aria-hidden="true">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  size="lg"
                  fullWidth
                  icon="auto_awesome"
                  disabled={imagesList.length === 0}
                  onClick={handleImageImport}
                >
                  Analyze pictures
                </Button>
              </div>
            )}

          </div>
        ) : (
          /* SECTION 2: EDITABLE PREVIEW FORM */
          <div className="mx-auto flex max-w-md flex-col gap-6 px-6 pt-8 pb-40">

            <div>
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">check_circle</span>
                Extraction loaded
              </span>
              <h1 className="font-display text-[30px] font-light leading-[1.05] text-ink">Verify <em className="font-medium">details.</em></h1>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
                Review, correct, and populate catalog details below. AI generated fields are badged in gold.
              </p>
            </div>

            {/* PREVIEW: BASIC CARD */}
            <div className="flex flex-col gap-5 rounded-card border border-line bg-surface-1 p-6">

              {/* Product Images View */}
              {productImages.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Imported images</label>
                  <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                    {productImages.map((img, idx) => (
                      <div key={idx} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-line">
                        <img src={img} alt={`Preview ${idx}`} className="h-full w-full object-cover"/>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Title Input */}
              <FieldShell label="Title" required fieldName="title">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={fieldCls(previewData.generated_fields.includes('title'))}
                />
              </FieldShell>

              {/* Brand Input */}
              <FieldShell label="Brand" fieldName="brand">
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className={fieldCls(previewData.generated_fields.includes('brand'))}
                />
              </FieldShell>

              {/* Category & Gender */}
              <div className="grid grid-cols-2 gap-4">
                <FieldShell label="Category" fieldName="category">
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. tshirt"
                    className={fieldCls(previewData.generated_fields.includes('category'))}
                  />
                </FieldShell>
                <FieldShell label="Gender" fieldName="gender">
                  <input
                    type="text"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    placeholder="e.g. men, women"
                    className={fieldCls(previewData.generated_fields.includes('gender'))}
                  />
                </FieldShell>
              </div>

              {/* Price & Pattern */}
              <div className="grid grid-cols-2 gap-4">
                <FieldShell label="Price" fieldName="price">
                  <input
                    type="text"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="e.g. Rs. 999"
                    className={fieldCls(previewData.generated_fields.includes('price'))}
                  />
                </FieldShell>
                <FieldShell label="Pattern" fieldName="pattern">
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="e.g. solid, striped"
                    className={fieldCls(previewData.generated_fields.includes('pattern'))}
                  />
                </FieldShell>
              </div>

              {/* Description */}
              <FieldShell label="Description" fieldName="description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className={cn(
                    'w-full rounded-ctl bg-surface-2 p-4 text-[14px] text-ink placeholder:text-ink-faint resize-none',
                    'border focus:outline-none focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]',
                    previewData.generated_fields.includes('description') ? 'border-brass/45 focus:border-brass' : 'border-line focus:border-ink',
                  )}
                />
              </FieldShell>

            </div>

            {/* PREVIEW: FABRIC SPEC SHEET CARD */}
            <div className="flex flex-col gap-5 rounded-card border border-line bg-surface-1 p-6">
              <Eyebrow>Garment specs</Eyebrow>

              <div className="grid grid-cols-2 gap-4">
                {/* Fabric */}
                <FieldShell label="Fabric" fieldName="fabric">
                  <input
                    type="text"
                    value={fabric}
                    onChange={(e) => setFabric(e.target.value)}
                    placeholder="e.g. Cotton"
                    className={fieldCls(previewData.generated_fields.includes('fabric'))}
                  />
                </FieldShell>
                {/* Fit Type */}
                <FieldShell label="Fit type" fieldName="fit_type">
                  <input
                    type="text"
                    value={fitType}
                    onChange={(e) => setFitType(e.target.value)}
                    placeholder="e.g. regular"
                    className={fieldCls(previewData.generated_fields.includes('fit_type'))}
                  />
                </FieldShell>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Sleeve Type */}
                <FieldShell label="Sleeve type" fieldName="sleeve_type">
                  <input
                    type="text"
                    value={sleeveType}
                    onChange={(e) => setSleeveType(e.target.value)}
                    placeholder="e.g. short sleeve"
                    className={fieldCls(previewData.generated_fields.includes('sleeve_type'))}
                  />
                </FieldShell>
                {/* Neck Type */}
                <FieldShell label="Neck type" fieldName="neck_type">
                  <input
                    type="text"
                    value={neckType}
                    onChange={(e) => setNeckType(e.target.value)}
                    placeholder="e.g. crew neck"
                    className={fieldCls(previewData.generated_fields.includes('neck_type'))}
                  />
                </FieldShell>
              </div>

              {/* Colors (comma separated list) */}
              <FieldShell label="Colors (comma separated)" fieldName="colors">
                <input
                  type="text"
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                  placeholder="e.g. black, white"
                  className={fieldCls(previewData.generated_fields.includes('colors'))}
                />
              </FieldShell>

              {/* Tags */}
              <FieldShell label="Tags (comma separated)" fieldName="tags">
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className={fieldCls(previewData.generated_fields.includes('tags'))}
                />
              </FieldShell>

              {/* Source URL (Hidden input/display) */}
              {sourceUrl && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Source URL</label>
                  <p className="max-w-[320px] truncate text-[12.5px] text-ink-soft">{sourceUrl}</p>
                </div>
              )}

            </div>

            {/* PREVIEW: SIZE CHART BUILDER CARD */}
            <div className="flex flex-col gap-4 rounded-card border border-line bg-surface-1 p-6">
              <Eyebrow>Sizing specifications</Eyebrow>

              {/* CURRENT SIZE TABLE */}
              {sizeChart.length === 0 ? (
                <p className="rounded-ctl bg-surface-2 py-4 text-center text-[12px] text-ink-faint">
                  No sizes defined yet. Add standard sizes below.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between border-b border-line px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    <span>Size</span>
                    <span>Chest value (cm)</span>
                    <span className="w-8"></span>
                  </div>
                  {sizeChart.map((row) => (
                    <div key={row.size} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] font-medium text-ink">
                      <span className="font-display">{row.size}</span>
                      <span>{row.value}</span>
                      <button
                        onClick={() => handleRemoveSizeRow(row.size)}
                        aria-label={`Remove size ${row.size}`}
                        className="flex items-center justify-center text-danger transition-opacity hover:opacity-70"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ADD SIZE ROW INLINE FORM */}
              <div className="h-px bg-line my-2"></div>

              <div className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Size name</label>
                  <input
                    type="text"
                    value={newSizeName}
                    onChange={(e) => setNewSizeName(e.target.value)}
                    placeholder="e.g. M"
                    className="h-11 w-full rounded-ctl border border-line bg-surface-2 px-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Chest value</label>
                  <input
                    type="number"
                    value={newSizeValue === '' ? '' : newSizeValue}
                    onChange={(e) => setNewSizeValue(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 100"
                    className="h-11 w-full rounded-ctl border border-line bg-surface-2 px-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
                  />
                </div>
                <Button size="sm" className="h-11 shrink-0" onClick={handleAddSizeRow}>
                  Add size
                </Button>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* STICKY BOTTOM ACTIONS FOR REVIEW */}
      {previewData && (
        <div className="fixed bottom-0 inset-x-0 z-50 w-full bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent px-6 pb-8 pt-6 phone-fixed-bottom">
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" size="lg" onClick={() => setPreviewData(null)}>
              Discard
            </Button>
            <Button className="flex-[2]" size="lg" icon="check_circle" onClick={handleSaveProduct}>
              Approve & Save
            </Button>
          </div>
        </div>
      )}

    </div>
  );
};

export default SellerAddProduct;
