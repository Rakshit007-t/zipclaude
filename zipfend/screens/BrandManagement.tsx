import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import {
  getSellerMe,
  getSellerProfile,
  updateSellerProfile,
  uploadSellerLogo,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  validateProductCsv,
  commitCsvImport,
  SellerProfile,
  SellerProduct,
  ProductDraft,
  CsvValidationReport,
} from '../services/ziprightApi';
import { AppBar, Eyebrow, Skeleton } from '../components/ui';

type BrandTab = 'overview' | 'catalog' | 'csv' | 'profile' | 'integrations';

const CATEGORIES = [
  'All',
  'T-Shirts',
  'Shirts',
  'Hoodies',
  'Jackets',
  'Jeans',
  'Pants',
  'Shorts',
  'Dresses',
  'Kurtis',
  'Ethnic Wear',
  'Shoes',
] as const;

const GENDERS = ['All', 'Men', 'Women', 'Unisex'] as const;

export const BrandManagement: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<BrandTab>('overview');

  // Brand Profile State
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Catalog State
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedGender, setSelectedGender] = useState<string>('All');

  // Product Add/Edit Modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductDraft>({
    title: '',
    description: '',
    brand: '',
    category: 'T-Shirts',
    gender: 'Unisex',
    fabric: '',
    colors: [],
    images: [],
    fit_type: 'regular',
    sleeve_type: '',
    neck_type: '',
    pattern: '',
    tags: [],
    price: '',
  });

  // CSV Import State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [validatingCsv, setValidatingCsv] = useState(false);
  const [csvReport, setCsvReport] = useState<CsvValidationReport | null>(null);
  const [committingCsv, setCommittingCsv] = useState(false);

  const fetchBrandData = async () => {
    try {
      setLoadingProfile(true);
      const res = await getSellerMe();
      if (res.profile) {
        setProfile(res.profile);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingProfile(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      setLoadingProducts(true);
      const items = await listProducts();
      setProducts(items);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to load catalog.', 'error');
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    fetchBrandData();
    fetchCatalog();
  }, []);

  // Save Brand Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      setSavingProfile(true);
      const updated = await updateSellerProfile({
        store_name: profile.store_name,
        contact_name: profile.contact_name,
        email: profile.email,
        phone: profile.phone,
        website: profile.website || '',
        gst: profile.gst || '',
        brand_description: profile.brand_description || '',
      });
      setProfile(updated);
      showToast('Brand profile updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  // Upload Logo
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showToast('Uploading logo...', 'info');
      const updated = await uploadSellerLogo(file);
      setProfile(updated);
      showToast('Brand logo updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to upload logo.', 'error');
    }
  };

  // Product CRUD
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.title.trim()) return;

    try {
      if (editingProductId) {
        await updateProduct(editingProductId, productForm);
        showToast('Product updated.', 'success');
      } else {
        await createProduct({
          ...productForm,
          generated_fields: [],
          status: 'active',
        });
        showToast('Product added to catalog.', 'success');
      }
      setShowProductModal(false);
      fetchCatalog();
    } catch (err: any) {
      showToast(err.message || 'Failed to save product.', 'error');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    try {
      await deleteProduct(id);
      showToast('Product deleted.', 'success');
      fetchCatalog();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete product.', 'error');
    }
  };

  // CSV Import Handlers
  const handleCsvValidate = async () => {
    if (!csvFile) return;
    try {
      setValidatingCsv(true);
      setCsvReport(null);
      const report = await validateProductCsv(csvFile);
      setCsvReport(report);
      showToast(`Validation complete. ${report.valid_rows_count} valid rows.`, 'info');
    } catch (err: any) {
      showToast(err.message || 'CSV validation failed.', 'error');
    } finally {
      setValidatingCsv(false);
    }
  };

  const handleCsvCommit = async () => {
    if (!csvReport || csvReport.valid_products.length === 0) return;
    try {
      setCommittingCsv(true);
      const res = await commitCsvImport(csvReport.valid_products);
      showToast(`Successfully imported ${res.imported_count} products!`, 'success');
      setCsvReport(null);
      setCsvFile(null);
      fetchCatalog();
      setActiveTab('catalog');
    } catch (err: any) {
      showToast(err.message || 'Failed to commit CSV import.', 'error');
    } finally {
      setCommittingCsv(false);
    }
  };

  const downloadSampleCsv = () => {
    const csvContent =
      'title,sku,category,gender,price,description,fabric,fit_type,images\n' +
      'Classic Cotton T-Shirt,TSH-001,T-Shirts,Men,29.99,100% premium cotton tee,Cotton,regular,https://images.unsplash.com/photo-1521572267360-ee0c2909d518\n' +
      'Slim Fit Denim Jacket,JKT-002,Jackets,Unisex,89.99,Durable washed denim jacket,Denim,slim,https://images.unsplash.com/photo-1583743814966-8936f5b7be1a\n';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zipright_sample_catalog.csv';
    a.click();
  };

  // Filtering products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p as any).sku?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'All' || p.category.toLowerCase() === selectedCategory.toLowerCase();

    const matchesGender =
      selectedGender === 'All' || p.gender.toLowerCase() === selectedGender.toLowerCase();

    return matchesSearch && matchesCategory && matchesGender;
  });

  const renderTabs = () => (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-6 border-b border-line">
      {(
        [
          { id: 'overview', label: 'Overview' },
          { id: 'catalog', label: 'Catalog Manager' },
          { id: 'csv', label: 'Bulk CSV Import' },
          { id: 'profile', label: 'Brand Profile' },
          { id: 'integrations', label: 'Store Integrations' },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          onClick={() => setActiveTab(t.id)}
          className={`shrink-0 px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.05em] rounded-t-lg transition-colors ${
            activeTab === t.id
              ? 'text-brand border-b-2 border-brand bg-brand/5'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // Tab 1: Overview
  const renderOverview = () => (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-brand mb-2">storefront</span>
          <span className="eyebrow !text-[9px]">Brand Status</span>
          <h3 className="font-display text-[20px] font-bold text-ink capitalize mt-1">
            {profile?.status || 'Pending'}
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-success mb-2">inventory_2</span>
          <span className="eyebrow !text-[9px]">Total Products</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">
            {products.length}
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-info mb-2">view_in_ar</span>
          <span className="eyebrow !text-[9px]">AI Enabled</span>
          <h3 className="font-display text-[28px] font-light text-ink mt-1">
            {products.filter((p) => p.status === 'active').length}
          </h3>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-5">
          <span className="material-symbols-outlined text-[24px] text-brass mb-2">cloud_done</span>
          <span className="eyebrow !text-[9px]">API Integration</span>
          <h3 className="font-display text-[20px] font-bold text-success mt-1">Ready</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onClick={() => setActiveTab('csv')}
          className="flex flex-col p-6 rounded-card border border-line bg-surface-1 hover:border-brand transition-all cursor-pointer press-soft"
        >
          <span className="material-symbols-outlined text-[32px] text-brand mb-3">upload_file</span>
          <h4 className="text-[16px] font-bold text-ink">Bulk Upload Products</h4>
          <p className="text-[13px] text-ink-soft mt-1">
            Import hundreds of products via validated CSV files with instant error checking.
          </p>
        </div>

        <div
          onClick={() => setActiveTab('catalog')}
          className="flex flex-col p-6 rounded-card border border-line bg-surface-1 hover:border-brand transition-all cursor-pointer press-soft"
        >
          <span className="material-symbols-outlined text-[32px] text-info mb-3">category</span>
          <h4 className="text-[16px] font-bold text-ink">Manage Catalog</h4>
          <p className="text-[13px] text-ink-soft mt-1">
            Edit product categories, images, fit metadata, and activation status.
          </p>
        </div>
      </div>
    </div>
  );

  // Tab 2: Catalog
  const renderCatalog = () => (
    <div className="flex flex-col gap-6">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-card border border-line bg-surface-1 p-4">
        <div className="flex-1 w-full min-w-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by product title, brand, SKU..."
            className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={selectedGender}
            onChange={(e) => setSelectedGender(e.target.value)}
            className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          <button
            onClick={() => {
              setEditingProductId(null);
              setProductForm({
                title: '',
                description: '',
                brand: profile?.store_name || '',
                category: 'T-Shirts',
                gender: 'Unisex',
                fabric: '',
                colors: [],
                images: [],
                fit_type: 'regular',
                sleeve_type: '',
                neck_type: '',
                pattern: '',
                tags: [],
                price: '',
              });
              setShowProductModal(true);
            }}
            className="shrink-0 px-4 py-3 rounded-xl bg-brand text-on-brand font-semibold text-[13px] hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add Product
          </button>
        </div>
      </div>

      {/* Catalog Grid */}
      {loadingProducts ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-[200px] rounded-card" />
          <Skeleton className="h-[200px] rounded-card" />
          <Skeleton className="h-[200px] rounded-card" />
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-card border border-line bg-surface-1 text-ink-faint">
          <span className="material-symbols-outlined text-[40px] mb-2 opacity-50">inventory</span>
          <p className="text-[14px]">No products found matching filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProducts.map((p) => (
            <div key={p.id} className="flex flex-col rounded-card border border-line bg-surface-1 p-4 gap-3">
              <div className="flex gap-3">
                <div className="w-20 h-24 rounded-xl border border-line bg-surface-2 overflow-hidden shrink-0">
                  {p.images && p.images.length > 0 ? (
                    <img src={p.images[0]} alt={p.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-faint text-[10px]">No image</div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <h4 className="text-[14px] font-bold text-ink truncate">{p.title}</h4>
                    <p className="text-[11px] text-ink-faint mt-0.5">{p.brand} • {p.category}</p>
                    <p className="text-[12px] font-bold text-brand mt-1">{p.price ? `$${p.price}` : 'Unpriced'}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold uppercase ${
                      p.status === 'active' ? 'bg-success-soft text-success' : 'bg-surface-2 text-ink-faint'
                    }`}>
                      {p.status}
                    </span>
                    <span className="text-[10px] text-ink-faint">{p.gender}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-line">
                <button
                  onClick={() => {
                    setEditingProductId(p.id);
                    setProductForm({
                      title: p.title,
                      description: p.description,
                      brand: p.brand,
                      category: p.category,
                      gender: p.gender,
                      fabric: p.fabric,
                      colors: p.colors,
                      images: p.images,
                      fit_type: p.fit_type,
                      sleeve_type: p.sleeve_type,
                      neck_type: p.neck_type,
                      pattern: p.pattern,
                      tags: p.tags,
                      price: p.price || '',
                    });
                    setShowProductModal(true);
                  }}
                  className="flex-1 py-1.5 rounded-lg border border-line bg-surface-2 text-[12px] font-semibold text-ink hover:border-brand transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteProduct(p.id)}
                  className="p-1.5 rounded-lg border border-line bg-surface-2 text-danger hover:border-danger/30 transition-colors"
                  aria-label="Delete"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Tab 3: CSV Import
  const renderCsvImport = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <Eyebrow className="mb-1">Batch Automation</Eyebrow>
            <h2 className="text-[20px] font-bold text-ink">Bulk CSV Product Import</h2>
            <p className="text-[13px] text-ink-soft mt-1">
              Upload a spreadsheet to import your catalog. Pre-validation checks for missing fields and duplicates.
            </p>
          </div>

          <button
            onClick={downloadSampleCsv}
            className="px-3.5 py-2 rounded-xl border border-line bg-surface-2 text-[12px] font-semibold text-brand hover:border-brand transition-colors shrink-0 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Sample CSV
          </button>
        </div>

        {/* Upload Drop Zone */}
        <div className="flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed border-line bg-surface-2 gap-3 text-center">
          <span className="material-symbols-outlined text-[40px] text-brand">cloud_upload</span>
          <div>
            <label className="text-[14px] font-bold text-brand hover:underline cursor-pointer">
              Select CSV File
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setCsvFile(e.target.files[0]);
                    setCsvReport(null);
                  }
                }}
              />
            </label>
            <p className="text-[12px] text-ink-faint mt-1">
              {csvFile ? `Selected: ${csvFile.name}` : 'Supported format: .csv (Max 10 MB)'}
            </p>
          </div>

          {csvFile && (
            <button
              onClick={handleCsvValidate}
              disabled={validatingCsv}
              className="mt-2 px-6 py-2.5 rounded-full bg-brand text-on-brand text-[13px] font-semibold hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {validatingCsv ? 'Validating CSV Rows...' : 'Validate CSV Report'}
            </button>
          )}
        </div>
      </div>

      {/* Validation Report */}
      {csvReport && (
        <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <h3 className="text-[16px] font-bold text-ink">Validation Report</h3>
            <div className="flex gap-2">
              <span className="px-3 py-1 rounded-full text-[12px] font-bold bg-success-soft text-success">
                {csvReport.valid_rows_count} Valid
              </span>
              {csvReport.invalid_rows_count > 0 && (
                <span className="px-3 py-1 rounded-full text-[12px] font-bold bg-danger-soft text-danger">
                  {csvReport.invalid_rows_count} Errors
                </span>
              )}
            </div>
          </div>

          {/* Errors table */}
          {csvReport.errors.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-[13px] font-bold text-danger uppercase tracking-[0.05em]">Validation Errors</h4>
              <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto no-scrollbar">
                {csvReport.errors.map((err, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg border border-danger/30 bg-danger-soft text-[12px] text-danger">
                    <span>Row {err.row_number}: <strong>{err.field}</strong> — {err.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Valid Products Commit Button */}
          {csvReport.valid_products.length > 0 && (
            <button
              onClick={handleCsvCommit}
              disabled={committingCsv}
              className="w-full h-12 rounded-full bg-brand text-on-brand font-semibold text-[15px] hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {committingCsv ? 'Importing Products...' : `Commit ${csvReport.valid_products.length} Products to Catalog`}
            </button>
          )}
        </div>
      )}
    </div>
  );

  // Tab 4: Profile
  const renderProfile = () => (
    <div className="flex flex-col rounded-card border border-line bg-surface-1 p-6 gap-6">
      <Eyebrow>Brand Identity</Eyebrow>

      <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
        {/* Logo Upload */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl border border-line bg-surface-2 overflow-hidden flex items-center justify-center">
            {profile?.brand_logo_url ? (
              <img src={profile.brand_logo_url} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-[32px] text-ink-faint">storefront</span>
            )}
          </div>
          <label className="px-4 py-2 rounded-xl border border-line bg-surface-2 text-[12px] font-semibold text-ink hover:border-brand cursor-pointer">
            Upload Logo
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Store / Brand Name
            </label>
            <input
              type="text"
              value={profile?.store_name || ''}
              onChange={(e) => setProfile((p) => p ? { ...p, store_name: e.target.value } : null)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Contact Person
            </label>
            <input
              type="text"
              value={profile?.contact_name || ''}
              onChange={(e) => setProfile((p) => p ? { ...p, contact_name: e.target.value } : null)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Business Email
            </label>
            <input
              type="email"
              value={profile?.email || ''}
              onChange={(e) => setProfile((p) => p ? { ...p, email: e.target.value } : null)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-faint mb-1 block">
              Phone
            </label>
            <input
              type="text"
              value={profile?.phone || ''}
              onChange={(e) => setProfile((p) => p ? { ...p, phone: e.target.value } : null)}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink focus:border-brand focus:outline-none"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={savingProfile}
          className="w-full h-12 rounded-full bg-brand text-on-brand font-semibold text-[15px] hover:brightness-110 active:scale-[0.98] transition-all mt-2 disabled:opacity-50"
        >
          {savingProfile ? 'Saving Changes...' : 'Save Brand Profile'}
        </button>
      </form>
    </div>
  );

  // Tab 5: Integrations
  const renderIntegrations = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        { name: 'Shopify', icon: 'shopping_bag', status: 'Architecture Ready' },
        { name: 'WooCommerce', icon: 'store', status: 'Architecture Ready' },
        { name: 'Magento', icon: 'precision_manufacturing', status: 'Architecture Ready' },
      ].map((int) => (
        <div key={int.name} className="flex flex-col p-5 rounded-card border border-line bg-surface-1 gap-3">
          <span className="material-symbols-outlined text-[32px] text-brand">{int.icon}</span>
          <h4 className="text-[16px] font-bold text-ink">{int.name}</h4>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-brass/20 text-brass w-max">
            {int.status}
          </span>
          <p className="text-[12px] text-ink-soft mt-1">
            Clean provider extension interfaces implemented for automated store synchronization.
          </p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col overflow-x-hidden bg-surface-0 text-ink">
      <AppBar title="Brand Portal" onBack={() => navigate('/settings')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-4 pb-28">
        <div className="mb-6">
          <h1 className="display-1">
            Brand Management<em className="font-medium text-brand">.</em>
          </h1>
        </div>

        {renderTabs()}

        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'catalog' && renderCatalog()}
          {activeTab === 'csv' && renderCsvImport()}
          {activeTab === 'profile' && renderProfile()}
          {activeTab === 'integrations' && renderIntegrations()}
        </div>
      </div>

      {/* Add/Edit Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-line bg-surface-1 p-6 max-h-[90vh] overflow-y-auto no-scrollbar flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-[16px] font-bold text-ink">
                {editingProductId ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button
                onClick={() => setShowProductModal(false)}
                className="p-1 rounded-full text-ink-soft hover:text-ink"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-semibold text-ink-faint block mb-1">Title</label>
                <input
                  type="text"
                  value={productForm.title}
                  onChange={(e) => setProductForm({ ...productForm, title: e.target.value })}
                  className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-ink-faint block mb-1">Category</label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                    className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink"
                  >
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-ink-faint block mb-1">Gender</label>
                  <select
                    value={productForm.gender}
                    onChange={(e) => setProductForm({ ...productForm, gender: e.target.value })}
                    className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink"
                  >
                    {GENDERS.filter((g) => g !== 'All').map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink-faint block mb-1">Price</label>
                <input
                  type="text"
                  value={productForm.price || ''}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                  placeholder="e.g. 49.99"
                  className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink-faint block mb-1">Image URL</label>
                <input
                  type="text"
                  value={productForm.images[0] || ''}
                  onChange={(e) => setProductForm({ ...productForm, images: [e.target.value] })}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] font-medium text-ink"
                />
              </div>

              <button
                type="submit"
                className="w-full h-12 rounded-full bg-brand text-on-brand font-semibold text-[14px] hover:brightness-110 transition-all mt-2"
              >
                Save Product
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandManagement;
