/*!
 * ZipRIGHT Widget SDK v1.0.0
 * https://zipright.ai
 *
 * Drop-in "Find My Size" + "Try On" button for any merchant storefront.
 *
 * Usage:
 *   <script src="zipright-widget.js"
 *           data-store-url="https://my-store.myshopify.com"
 *           data-api-base="https://api.zipright.ai"
 *           data-product-id="FIRESTORE_DOC_ID"
 *           data-button-target="#my-add-to-cart-container"
 *   ></script>
 *
 * Or initialise programmatically:
 *   ZipRightWidget.init({ storeUrl, apiBase, productId, buttonTarget });
 */

(function (global) {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  var SDK_VERSION = '1.0.0';
  var ZIPRIGHT_APP_URL = 'https://zipright.ai';
  var DEFAULT_PRIMARY = '#C9A06C';
  var Z_INDEX_BASE = 9000;

  // ─── Styles ──────────────────────────────────────────────────────────────────

  var CSS = [
    '.zr-btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;',
    'border:2px solid ' + DEFAULT_PRIMARY + ';border-radius:12px;',
    'background:transparent;color:' + DEFAULT_PRIMARY + ';',
    'font-family:inherit;font-size:13px;font-weight:700;',
    'letter-spacing:.04em;cursor:pointer;transition:background .15s,color .15s;}',
    '.zr-btn:hover{background:' + DEFAULT_PRIMARY + ';color:#fff;}',
    '.zr-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;}',

    '.zr-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);',
    'backdrop-filter:blur(4px);z-index:' + Z_INDEX_BASE + ';',
    'display:flex;align-items:flex-end;justify-content:center;',
    'opacity:0;transition:opacity .2s;}',
    '.zr-backdrop.zr-open{opacity:1;}',

    '.zr-modal{background:#fff;border-radius:24px 24px 0 0;',
    'width:100%;max-width:480px;max-height:90vh;overflow-y:auto;',
    'padding:28px 24px 40px;box-sizing:border-box;',
    'transform:translateY(100%);transition:transform .25s ease;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
    '@media(prefers-color-scheme:dark){.zr-modal{background:#1a1a1a;color:#f0f0f0;}}',
    '.zr-backdrop.zr-open .zr-modal{transform:translateY(0);}',

    '.zr-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}',
    '.zr-brand{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;',
    'text-transform:uppercase;letter-spacing:.08em;color:' + DEFAULT_PRIMARY + ';}',
    '.zr-brand-dot{width:22px;height:22px;border-radius:7px;background:' + DEFAULT_PRIMARY + ';',
    'color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;}',
    '.zr-close{width:32px;height:32px;border-radius:50%;border:none;background:#f0f0f0;',
    'cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;',
    'color:#555;transition:background .15s;}',
    '.zr-close:hover{background:#e0e0e0;}',
    '@media(prefers-color-scheme:dark){.zr-close{background:#333;color:#ccc;}}',

    '.zr-product-row{display:flex;gap:12px;align-items:center;',
    'padding:12px;background:#f9f9f9;border-radius:14px;margin-bottom:20px;}',
    '@media(prefers-color-scheme:dark){.zr-product-row{background:#2a2a2a;}}',
    '.zr-product-img{width:48px;height:48px;border-radius:10px;object-fit:cover;',
    'background:#ddd;flex-shrink:0;}',
    '.zr-product-title{font-size:13px;font-weight:700;line-height:1.3;}',
    '.zr-product-brand{font-size:11px;color:#888;margin-top:2px;}',

    '.zr-section-title{font-size:10px;font-weight:800;text-transform:uppercase;',
    'letter-spacing:.1em;color:#999;margin-bottom:10px;}',

    '.zr-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}',
    '.zr-field label{display:block;font-size:10px;font-weight:700;color:#999;',
    'text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;}',
    '.zr-field input,.zr-field select{width:100%;box-sizing:border-box;',
    'height:42px;padding:0 12px;border:1.5px solid #e0e0e0;border-radius:10px;',
    'font-size:13px;font-weight:600;background:#fff;color:#111;',
    'outline:none;transition:border-color .15s;-webkit-appearance:none;}',
    '.zr-field input:focus,.zr-field select:focus{border-color:' + DEFAULT_PRIMARY + ';}',
    '@media(prefers-color-scheme:dark){.zr-field input,.zr-field select{',
    'background:#2a2a2a;color:#f0f0f0;border-color:#444;}}',

    '.zr-primary-btn{width:100%;height:48px;border:none;border-radius:14px;',
    'background:' + DEFAULT_PRIMARY + ';color:#fff;font-size:13px;font-weight:800;',
    'letter-spacing:.04em;cursor:pointer;transition:opacity .15s;margin-top:8px;}',
    '.zr-primary-btn:hover{opacity:.88;}',
    '.zr-primary-btn:disabled{opacity:.45;cursor:default;}',

    '.zr-result-box{text-align:center;padding:24px 0;margin-bottom:16px;}',
    '.zr-result-label{font-size:10px;font-weight:800;text-transform:uppercase;',
    'letter-spacing:.1em;color:' + DEFAULT_PRIMARY + ';margin-bottom:6px;}',
    '.zr-result-size{font-size:64px;font-weight:900;line-height:1;color:' + DEFAULT_PRIMARY + ';}',
    '.zr-result-badge{display:inline-block;margin-top:10px;padding:4px 14px;',
    'border-radius:99px;font-size:10px;font-weight:800;',
    'background:#d1fae5;color:#065f46;}',

    '.zr-reason-box{background:#f9f9f9;border-radius:12px;padding:12px 14px;',
    'font-size:12px;line-height:1.5;color:#555;margin-bottom:16px;}',
    '@media(prefers-color-scheme:dark){.zr-reason-box{background:#2a2a2a;color:#aaa;}}',

    '.zr-secondary-btn{width:100%;height:44px;border:1.5px solid #e0e0e0;',
    'border-radius:14px;background:transparent;color:#555;',
    'font-size:12px;font-weight:700;cursor:pointer;transition:border-color .15s;}',
    '.zr-secondary-btn:hover{border-color:' + DEFAULT_PRIMARY + ';color:' + DEFAULT_PRIMARY + ';}',
    '@media(prefers-color-scheme:dark){.zr-secondary-btn{border-color:#444;color:#aaa;}}',

    '.zr-spinner{display:inline-block;width:20px;height:20px;border:2.5px solid #f0f0f0;',
    'border-top-color:' + DEFAULT_PRIMARY + ';border-radius:50%;animation:zr-spin .7s linear infinite;}',
    '@keyframes zr-spin{to{transform:rotate(360deg)}}',

    '.zr-error{color:#c00;font-size:12px;margin-top:8px;text-align:center;}',
  ].join('');

  // ─── Utility: inject stylesheet once ─────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('zr-styles')) return;
    var el = document.createElement('style');
    el.id = 'zr-styles';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ─── Utility: SVG icon ────────────────────────────────────────────────────────

  function _icon(path) {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="' + path + '"/>' +
      '</svg>'
    );
  }

  var ICON_RULER = 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10';
  var ICON_CAMERA = 'M15 10l4.553-2.069A1 1 0 0121 8.869V19a1 1 0 01-1 1H4a1 1 0 01-1-1V8.869a1 1 0 011.447-.917L9 10m6 0V6a3 3 0 00-6 0v4m6 0H9';

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────

  function _get(url) {
    return fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) { return r.json(); });
  }

  function _post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  // ─── Modal DOM builder ────────────────────────────────────────────────────────

  function _buildModal(product) {
    var backdrop = document.createElement('div');
    backdrop.className = 'zr-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'ZipRIGHT Size Finder');

    var imgSrc = (product && product.images && product.images[0]) || '';
    var productHTML = product
      ? [
          '<div class="zr-product-row">',
          imgSrc
            ? '<img class="zr-product-img" src="' + imgSrc + '" alt="' + _esc(product.title) + '">'
            : '<div class="zr-product-img"></div>',
          '<div>',
          '<div class="zr-product-title">' + _esc(product.title || '') + '</div>',
          '<div class="zr-product-brand">' + _esc(product.brand || '') + '</div>',
          '</div></div>',
        ].join('')
      : '';

    backdrop.innerHTML = [
      '<div class="zr-modal" id="zr-modal-inner">',
      '  <div class="zr-header">',
      '    <div class="zr-brand"><div class="zr-brand-dot">Z</div> ZipRIGHT</div>',
      '    <button class="zr-close" id="zr-close-btn" aria-label="Close">&times;</button>',
      '  </div>',
      productHTML,
      '  <div id="zr-modal-content"></div>',
      '</div>',
    ].join('');

    return backdrop;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Step renderers ───────────────────────────────────────────────────────────

  function _renderInputStep(container, onSubmit) {
    container.innerHTML = [
      '<div class="zr-section-title">Your Measurements</div>',
      '<div class="zr-grid">',
      '  <div class="zr-field"><label for="zr-height">Height (cm)</label>',
      '    <input id="zr-height" type="number" min="100" max="250" placeholder="e.g. 175"></div>',
      '  <div class="zr-field"><label for="zr-weight">Weight (kg)</label>',
      '    <input id="zr-weight" type="number" min="30" max="300" placeholder="e.g. 70"></div>',
      '  <div class="zr-field"><label for="zr-chest">Chest (cm)</label>',
      '    <input id="zr-chest" type="number" min="50" max="200" placeholder="e.g. 98"></div>',
      '  <div class="zr-field"><label for="zr-waist">Waist (cm)</label>',
      '    <input id="zr-waist" type="number" min="50" max="200" placeholder="e.g. 82"></div>',
      '</div>',
      '<div class="zr-grid">',
      '  <div class="zr-field"><label for="zr-base-size">Usual Size</label>',
      '    <select id="zr-base-size">',
      '      <option value="XS">XS</option><option value="S">S</option>',
      '      <option value="M" selected>M</option><option value="L">L</option>',
      '      <option value="XL">XL</option><option value="XXL">XXL</option>',
      '    </select></div>',
      '  <div class="zr-field"><label for="zr-fit">Fit Preference</label>',
      '    <select id="zr-fit">',
      '      <option value="slim">Slim</option>',
      '      <option value="regular" selected>Regular</option>',
      '      <option value="relaxed">Relaxed</option>',
      '      <option value="loose">Loose</option>',
      '    </select></div>',
      '</div>',
      '<button class="zr-primary-btn" id="zr-find-btn">' + _icon(ICON_RULER) + ' Find My Size</button>',
      '<div class="zr-error" id="zr-error" style="display:none"></div>',
    ].join('');

    document.getElementById('zr-find-btn').addEventListener('click', function () {
      var h = parseFloat(document.getElementById('zr-height').value);
      var w = parseFloat(document.getElementById('zr-weight').value);
      if (!h || h < 100 || !w || w < 30) {
        var errEl = document.getElementById('zr-error');
        errEl.textContent = 'Please enter a valid height and weight.';
        errEl.style.display = 'block';
        return;
      }
      document.getElementById('zr-error').style.display = 'none';
      onSubmit({
        height: h,
        weight: w,
        chest: parseFloat(document.getElementById('zr-chest').value) || undefined,
        waist: parseFloat(document.getElementById('zr-waist').value) || undefined,
        base_size: document.getElementById('zr-base-size').value,
        fit_preference: document.getElementById('zr-fit').value,
      });
    });
  }

  function _renderLoadingStep(container) {
    container.innerHTML =
      '<div style="text-align:center;padding:40px 0">' +
      '<div class="zr-spinner"></div>' +
      '<p style="margin-top:14px;font-size:12px;color:#888">Calculating your fit…</p>' +
      '</div>';
  }

  function _renderResultStep(container, result, onTryOn, onRedo) {
    var confidencePct = Math.round((result.confidence || 0));
    container.innerHTML = [
      '<div class="zr-result-box">',
      '  <div class="zr-result-label">Recommended Size</div>',
      '  <div class="zr-result-size">' + _esc(result.size) + '</div>',
      '  <div class="zr-result-badge">✓ ' + confidencePct + '% match confidence</div>',
      '</div>',
      '<div class="zr-reason-box">' + _esc(result.reason || '') + '</div>',
      '<button class="zr-primary-btn" id="zr-tryon-btn">' + _icon(ICON_CAMERA) + ' Try On in ZipRIGHT</button>',
      '<button class="zr-secondary-btn" id="zr-redo-btn" style="margin-top:10px">Try Different Measurements</button>',
    ].join('');

    document.getElementById('zr-tryon-btn').addEventListener('click', onTryOn);
    document.getElementById('zr-redo-btn').addEventListener('click', onRedo);
  }

  function _renderErrorStep(container, message, onRetry) {
    container.innerHTML = [
      '<div style="text-align:center;padding:30px 0">',
      '  <p style="font-size:13px;color:#c00;margin-bottom:16px">' + _esc(message) + '</p>',
      '  <button class="zr-secondary-btn" id="zr-retry-btn">Try Again</button>',
      '</div>',
    ].join('');
    document.getElementById('zr-retry-btn').addEventListener('click', onRetry);
  }

  // ─── Core widget class ────────────────────────────────────────────────────────

  function ZipRightWidgetInstance(config) {
    this._config = config;  // { apiBase, storeUrl, productId, productTitle }
    this._product = null;
    this._backdrop = null;
  }

  ZipRightWidgetInstance.prototype._apiBase = function () {
    return (this._config.apiBase || '').replace(/\/$/, '');
  };

  ZipRightWidgetInstance.prototype._open = function () {
    var self = this;
    _injectStyles();
    var backdrop = _buildModal(self._product);
    document.body.appendChild(backdrop);
    self._backdrop = backdrop;

    // Dismiss on backdrop click
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) self._close();
    });
    backdrop.querySelector('#zr-close-btn').addEventListener('click', function () {
      self._close();
    });

    // Keyboard: Escape
    self._keyHandler = function (e) {
      if (e.key === 'Escape') self._close();
    };
    document.addEventListener('keydown', self._keyHandler);

    // Trigger open animation after paint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        backdrop.classList.add('zr-open');
        self._showInputStep();
      });
    });
  };

  ZipRightWidgetInstance.prototype._close = function () {
    var backdrop = this._backdrop;
    if (!backdrop) return;
    backdrop.classList.remove('zr-open');
    document.removeEventListener('keydown', this._keyHandler);
    backdrop.addEventListener('transitionend', function handler() {
      backdrop.removeEventListener('transitionend', handler);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    });
    this._backdrop = null;
  };

  ZipRightWidgetInstance.prototype._contentEl = function () {
    return this._backdrop && this._backdrop.querySelector('#zr-modal-content');
  };

  ZipRightWidgetInstance.prototype._showInputStep = function () {
    var self = this;
    var el = self._contentEl();
    if (!el) return;
    _renderInputStep(el, function (measurements) {
      self._fetchRecommendation(measurements);
    });
  };

  ZipRightWidgetInstance.prototype._fetchRecommendation = function (measurements) {
    var self = this;
    var el = self._contentEl();
    if (!el) return;
    _renderLoadingStep(el);

    var body = Object.assign(
      {
        store_url: self._config.storeUrl,
        product_id: self._config.productId || undefined,
        product_title: self._config.productTitle || undefined,
      },
      measurements
    );

    _post(self._apiBase() + '/public/integration/recommendation', body)
      .then(function (resp) {
        if (!resp || !resp.data || !resp.isValid) {
          throw new Error(resp && resp.message ? resp.message : 'Could not calculate recommendation.');
        }
        self._showResultStep(resp.data);
      })
      .catch(function (err) {
        var el2 = self._contentEl();
        if (!el2) return;
        _renderErrorStep(el2, err.message || 'Something went wrong. Please try again.', function () {
          self._showInputStep();
        });
      });
  };

  ZipRightWidgetInstance.prototype._showResultStep = function (result) {
    var self = this;
    var el = self._contentEl();
    if (!el) return;
    _renderResultStep(
      el,
      result,
      function () { self._launchTryOn(result); },
      function () { self._showInputStep(); }
    );
  };

  ZipRightWidgetInstance.prototype._launchTryOn = function (result) {
    var cfg = this._config;
    // Open ZipRIGHT app in a new tab; pass context as query params
    var params = new URLSearchParams({
      source: 'widget',
      store_url: cfg.storeUrl || '',
      product_id: cfg.productId || '',
      recommended_size: result.size || '',
    });
    if (cfg.productTitle) params.set('product_title', cfg.productTitle);
    var appUrl = (cfg.ziprightAppUrl || ZIPRIGHT_APP_URL) + '/recommendation?' + params.toString();
    window.open(appUrl, '_blank', 'noopener,noreferrer');
  };

  ZipRightWidgetInstance.prototype.renderButton = function (container) {
    var self = this;
    var btn = document.createElement('button');
    btn.className = 'zr-btn';
    btn.setAttribute('id', 'zr-widget-btn');
    btn.setAttribute('aria-label', 'Find My Size with ZipRIGHT');
    btn.innerHTML = _icon(ICON_RULER) + ' ✨ Find My Size';
    btn.addEventListener('click', function () { self._open(); });
    container.appendChild(btn);
    return btn;
  };

  // Pre-load product data in background for faster modal open
  ZipRightWidgetInstance.prototype.preload = function () {
    var self = this;
    if (self._product || (!self._config.productId && !self._config.productTitle)) return;
    var base = self._apiBase();
    var params = new URLSearchParams({ store_url: self._config.storeUrl });
    if (self._config.productId) params.set('product_id', self._config.productId);
    else if (self._config.productTitle) params.set('product_title', self._config.productTitle);

    _get(base + '/public/integration/product?' + params.toString())
      .then(function (resp) {
        if (resp && resp.isValid && resp.data) self._product = resp.data;
      })
      .catch(function () { /* non-critical; modal opens without product details */ });
  };

  // ─── Public API ───────────────────────────────────────────────────────────────

  var ZipRightWidget = {
    version: SDK_VERSION,

    /**
     * Initialise the widget.
     *
     * @param {Object} config
     * @param {string} config.storeUrl      - Registered store URL (required)
     * @param {string} config.apiBase       - ZipRIGHT API base URL (required)
     * @param {string} [config.productId]   - Stable Firestore product ID (preferred)
     * @param {string} [config.productTitle]- Product title fallback
     * @param {string} [config.buttonTarget]- CSS selector / HTMLElement to append the button to
     * @param {string} [config.ziprightAppUrl] - Override ZipRIGHT app URL
     * @returns {ZipRightWidgetInstance}
     */
    init: function (config) {
      if (!config || !config.storeUrl) throw new Error('[ZipRightWidget] storeUrl is required.');
      if (!config.apiBase) throw new Error('[ZipRightWidget] apiBase is required.');

      _injectStyles();
      var instance = new ZipRightWidgetInstance(config);

      // Mount button
      var target = config.buttonTarget;
      if (target) {
        var container =
          typeof target === 'string' ? document.querySelector(target) : target;
        if (container) {
          instance.renderButton(container);
          instance.preload();
        }
      }

      return instance;
    },
  };

  // ─── Auto-init via data attributes ───────────────────────────────────────────

  function _autoInit() {
    var scriptEl =
      document.currentScript ||
      (function () {
        var scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
      })();

    var storeUrl = scriptEl && scriptEl.getAttribute('data-store-url');
    var apiBase  = scriptEl && scriptEl.getAttribute('data-api-base');
    if (!storeUrl || !apiBase) return;   // manual init required

    var productId    = scriptEl.getAttribute('data-product-id') || undefined;
    var productTitle = scriptEl.getAttribute('data-product-title') || undefined;
    var buttonTarget = scriptEl.getAttribute('data-button-target') || undefined;
    var appUrl       = scriptEl.getAttribute('data-app-url') || undefined;

    function _run() {
      ZipRightWidget.init({
        storeUrl: storeUrl,
        apiBase: apiBase,
        productId: productId,
        productTitle: productTitle,
        buttonTarget: buttonTarget || document.body,
        ziprightAppUrl: appUrl,
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _run);
    } else {
      _run();
    }
  }

  _autoInit();

  // Expose globally
  global.ZipRightWidget = ZipRightWidget;

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
