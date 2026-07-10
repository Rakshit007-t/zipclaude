import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { getProduct, updateProduct, deleteProduct, duplicateProduct, uploadProductImage, SellerProduct } from '../services/ziprightApi';
import { AppBar, Button, IconButton, Input, TextArea, Eyebrow, SegmentedControl, Spinner } from '../components/ui';

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
    <div className="relative flex h-full min-h-screen min-h-dvh w-full flex-col overflow-x-hidden bg-surface-0 text-ink">

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-scrim/70 backdrop-blur-md p-6">
          <div className="flex max-w-sm flex-col items-center rounded-card border border-line bg-surface-1 p-8 text-center shadow-float">
            <Spinner size={40} className="text-brand mb-5" />
            <Eyebrow className="mb-2">Processing</Eyebrow>
            <p className="text-[13px] text-ink-soft leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      <AppBar title="Edit Product" onBack={() => navigate('/seller/catalog')} />

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
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-6 pb-40">
        <div className="mx-auto flex max-w-md flex-col gap-10">

          {/* Editorial opener */}
          <div>
            <Eyebrow className="mb-3">Catalog</Eyebrow>
            <h1 className="font-display text-[32px] font-light leading-[1.05] text-ink">
              Refine the <em className="font-medium">piece.</em>
            </h1>
            <p className="mt-3 max-w-[85%] text-[14px] leading-relaxed text-ink-soft">
              Update imagery, specs and sizing — every change is versioned safely.
            </p>
          </div>

          {/* SECTION 1: IMAGE MANAGER */}
          <section className="flex flex-col gap-5">
            <div className="flex items-baseline justify-between">
              <Eyebrow>Imagery</Eyebrow>
              <span className="text-[11px] text-ink-faint">{productImages.length} / 6</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {productImages.map((img, idx) => (
                <div key={idx} className="group relative aspect-square overflow-hidden rounded-card border border-line">
                  <img src={img} alt={`Product ${idx}`} className="h-full w-full object-cover" />

                  {/* Operations overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-scrim/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div className="flex gap-1.5">
                      <IconButton
                        icon="edit"
                        aria-label="Replace image"
                        size="sm"
                        variant="ghost"
                        className="bg-surface-1/90 text-ink"
                        onClick={() => { setReplacingIndex(idx); replaceInputRef.current?.click(); }}
                      />
                      <IconButton
                        icon="delete"
                        aria-label="Delete image"
                        size="sm"
                        variant="ghost"
                        className="bg-danger-soft text-danger"
                        onClick={() => handleRemoveImage(idx)}
                      />
                    </div>

                    <div className="flex gap-1.5">
                      {idx > 0 && (
                        <IconButton
                          icon="chevron_left"
                          aria-label="Move image left"
                          size="sm"
                          variant="ghost"
                          className="bg-surface-1/90 text-ink"
                          onClick={() => handleMoveImage(idx, 'left')}
                        />
                      )}
                      {idx < productImages.length - 1 && (
                        <IconButton
                          icon="chevron_right"
                          aria-label="Move image right"
                          size="sm"
                          variant="ghost"
                          className="bg-surface-1/90 text-ink"
                          onClick={() => handleMoveImage(idx, 'right')}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {productImages.length < 6 && (
                <button
                  type="button"
                  onClick={() => addInputRef.current?.click()}
                  aria-label="Add image"
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line-strong text-ink-faint transition-colors hover:border-brand hover:text-brand"
                >
                  <span className="material-symbols-outlined text-2xl" aria-hidden="true">add_photo_alternate</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">Add</span>
                </button>
              )}
            </div>
          </section>

          {/* SECTION 2: EDIT FIELDS */}
          <section className="flex flex-col gap-5">
            <Eyebrow>Details</Eyebrow>

            <Input
              label="Title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <Input
              label="Brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Input
                label="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <Input
                label="Pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
            </div>

            <TextArea
              label="Description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Status</span>
              <SegmentedControl
                aria-label="Product status"
                value={status}
                onChange={(v) => setStatus(v as 'active' | 'draft' | 'archived')}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'archived', label: 'Archived' },
                ]}
              />
            </div>
          </section>

          {/* SECTION 3: SPEC SHEET DETAILS */}
          <section className="flex flex-col gap-5">
            <Eyebrow>Garment specs</Eyebrow>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Fabric"
                value={fabric}
                onChange={(e) => setFabric(e.target.value)}
              />
              <Input
                label="Fit Type"
                value={fitType}
                onChange={(e) => setFitType(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Sleeve Type"
                value={sleeveType}
                onChange={(e) => setSleeveType(e.target.value)}
              />
              <Input
                label="Neck Type"
                value={neckType}
                onChange={(e) => setNeckType(e.target.value)}
              />
            </div>

            <Input
              label="Colors"
              hint="Comma separated"
              value={colorsInput}
              onChange={(e) => setColorsInput(e.target.value)}
            />

            <Input
              label="Tags"
              hint="Comma separated"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </section>

          {/* SECTION 4: SIZE CHART BUILDER */}
          <section className="flex flex-col gap-4">
            <Eyebrow>Sizing specifications</Eyebrow>

            {sizeChart.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong bg-surface-1 py-6 text-center text-[12px] text-ink-faint">
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
                  <div key={row.size} className="flex items-center justify-between rounded-ctl border border-line bg-surface-1 px-3 py-2.5 text-[13px] text-ink">
                    <span className="font-display font-medium">{row.size}</span>
                    <span className="font-display">{row.value}</span>
                    <button
                      onClick={() => handleRemoveSizeRow(row.size)}
                      aria-label={`Remove size ${row.size}`}
                      className="flex items-center justify-center text-ink-faint transition-colors hover:text-danger"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3 border-t border-line pt-4">
              <Input
                label="Size name"
                className="flex-1"
                value={newSizeName}
                onChange={(e) => setNewSizeName(e.target.value)}
                placeholder="e.g. M"
              />
              <Input
                label="Chest value"
                className="flex-1"
                type="number"
                value={newSizeValue === '' ? '' : newSizeValue}
                onChange={(e) => setNewSizeValue(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 100"
              />
              <Button size="md" variant="secondary" className="shrink-0" onClick={handleAddSizeRow}>
                Add
              </Button>
            </div>
          </section>

          {/* DUPLICATE AND DELETE CONTROLS */}
          <div className="grid grid-cols-2 gap-4">
            <Button variant="outline" icon="content_copy" onClick={handleDuplicateProduct}>
              Duplicate
            </Button>
            <Button variant="danger" icon="delete" onClick={handleDeleteProduct}>
              Delete
            </Button>
          </div>

        </div>
      </div>

      {/* STICKY BOTTOM ACTIONS FOR REVIEW */}
      <div className="fixed bottom-0 inset-x-0 z-50 w-full bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent px-6 pb-8 pt-5 phone-fixed-bottom">
        <div className="mx-auto flex max-w-md gap-3">
          <Button variant="outline" className="flex-1" onClick={() => navigate('/seller/catalog')}>
            Cancel
          </Button>
          <Button variant="accent" icon="save" className="flex-[2]" onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </div>

    </div>
  );
};

export default SellerEditProduct;
