/**
 * Posel — Photo Selector
 * Client-side web app to browse Google Drive photos and let clients pick selections.
 */

(function () {
  'use strict';

  // ===== CONFIG =====
  const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_THUMB_BASE = 'https://drive.google.com/thumbnail';
  const DRIVE_VIEW_BASE = 'https://lh3.googleusercontent.com/d/';
  const IMAGE_MIMES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'image/bmp', 'image/tiff', 'image/heic', 'image/heif'
  ];

  // ===== STATE =====
  let photos = [];           // { id, name, thumbUrl, fullUrl }
  let selected = new Set();  // Set of photo IDs
  let config = {};           // { folderId, apiKey, wa, max, title }
  let lightboxIndex = -1;

  // ===== DOM ELEMENTS =====
  const $ = (id) => document.getElementById(id);

  const dom = {
    adminView: $('admin-view'),
    galleryView: $('gallery-view'),
    setupForm: $('setup-form'),
    inputTitle: $('input-title'),
    inputDriveLink: $('input-drive-link'),
    inputApiKey: $('input-api-key'),
    inputWa: $('input-wa'),
    inputMax: $('input-max'),
    linkOutput: $('link-output'),
    generatedLink: $('generated-link'),
    btnCopyLink: $('btn-copy-link'),
    linkCopiedMsg: $('link-copied-msg'),
    galleryTitle: $('gallery-title'),
    countSelected: $('count-selected'),
    countMax: $('count-max'),
    galleryLoading: $('gallery-loading'),
    galleryError: $('gallery-error'),
    errorMessage: $('error-message'),
    photoGrid: $('photo-grid'),
    actionBar: $('action-bar'),
    btnCopyList: $('btn-copy-list'),
    btnSendWa: $('btn-send-wa'),
    lightbox: $('lightbox'),
    lightboxImg: $('lightbox-img'),
    lightboxCaption: $('lightbox-caption'),
    lightboxClose: $('lightbox-close'),
    lightboxPrev: $('lightbox-prev'),
    lightboxNext: $('lightbox-next'),
    toast: $('toast'),
  };

  // ===== INIT =====
  function init() {
    const params = new URLSearchParams(window.location.search);
    const folderId = params.get('f');
    const apiKey = params.get('k');
    const wa = params.get('w');
    const max = parseInt(params.get('m') || '0', 10);
    const title = params.get('t') || 'Gallery';

    if (folderId && apiKey) {
      config = { folderId, apiKey, wa, max, title };
      showGallery();
    } else {
      showAdmin();
    }
  }

  // ===== ADMIN SETUP =====
  function showAdmin() {
    dom.adminView.style.display = '';
    dom.galleryView.style.display = 'none';

    dom.setupForm.addEventListener('submit', handleGenerateLink);
    dom.btnCopyLink.addEventListener('click', handleCopyLink);
  }

  function extractFolderId(url) {
    // Handles: https://drive.google.com/drive/folders/FOLDER_ID?...
    // Also: https://drive.google.com/drive/u/0/folders/FOLDER_ID
    const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function handleGenerateLink(e) {
    e.preventDefault();

    const title = dom.inputTitle.value.trim();
    const driveLink = dom.inputDriveLink.value.trim();
    const apiKey = dom.inputApiKey.value.trim();
    const wa = dom.inputWa.value.trim().replace(/\D/g, '');
    const max = parseInt(dom.inputMax.value || '0', 10);

    const folderId = extractFolderId(driveLink);
    if (!folderId) {
      alert('Link Google Drive tidak valid. Pastikan format: https://drive.google.com/drive/folders/...');
      return;
    }

    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set('f', folderId);
    params.set('k', apiKey);
    if (wa) params.set('w', wa);
    if (max > 0) params.set('m', max.toString());
    if (title) params.set('t', title);

    const link = base + '?' + params.toString();
    dom.generatedLink.value = link;
    dom.linkOutput.style.display = '';
  }

  function handleCopyLink() {
    const link = dom.generatedLink.value;
    navigator.clipboard.writeText(link).then(() => {
      dom.linkCopiedMsg.classList.add('show');
      setTimeout(() => dom.linkCopiedMsg.classList.remove('show'), 2000);
    });
  }

  // ===== GALLERY =====
  function showGallery() {
    dom.adminView.style.display = 'none';
    dom.galleryView.style.display = '';

    dom.galleryTitle.textContent = config.title;
    document.title = config.title + ' — Posel';
    dom.countMax.textContent = config.max > 0 ? config.max : '∞';

    // Bind actions
    dom.btnCopyList.addEventListener('click', handleCopySelection);
    dom.btnSendWa.addEventListener('click', handleSendWA);
    dom.lightboxClose.addEventListener('click', closeLightbox);
    dom.lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
    dom.lightboxNext.addEventListener('click', () => navigateLightbox(1));

    // Keyboard for lightbox
    document.addEventListener('keydown', (e) => {
      if (dom.lightbox.style.display === 'none') return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    });

    loadPhotos();
  }

  async function loadPhotos() {
    dom.galleryLoading.style.display = '';
    dom.galleryError.style.display = 'none';
    dom.photoGrid.innerHTML = '';

    try {
      const allFiles = await fetchAllFiles(config.folderId, config.apiKey);

      if (allFiles.length === 0) {
        showError('Tidak ada foto ditemukan di folder ini.');
        return;
      }

      photos = allFiles.map((f) => ({
        id: f.id,
        name: stripExtension(f.name),
        thumbUrl: `${DRIVE_THUMB_BASE}?id=${f.id}&sz=w400`,
        fullUrl: `${DRIVE_VIEW_BASE}${f.id}=s1600`,
      }));

      dom.galleryLoading.style.display = 'none';
      renderGrid();
    } catch (err) {
      console.error('Drive API error:', err);
      showError('Gagal memuat foto. Pastikan folder sudah di-share public dan API Key valid. Error: ' + err.message);
    }
  }

  async function fetchAllFiles(folderId, apiKey) {
    let allFiles = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (${IMAGE_MIMES.map(m => `mimeType='${m}'`).join(' or ')})`,
        key: apiKey,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: '1000',
        orderBy: 'name',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`${DRIVE_API_BASE}?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }

  function stripExtension(name) {
    return name.replace(/\.[^.]+$/, '');
  }

  function showError(msg) {
    dom.galleryLoading.style.display = 'none';
    dom.galleryError.style.display = '';
    dom.errorMessage.textContent = msg;
  }

  // ===== RENDER GRID =====
  function renderGrid() {
    dom.photoGrid.innerHTML = '';

    photos.forEach((photo, index) => {
      const item = document.createElement('div');
      item.className = 'photo-item';
      item.dataset.id = photo.id;

      item.innerHTML = `
        <img src="${photo.thumbUrl}" alt="${photo.name}" loading="lazy">
        <div class="select-overlay"></div>
        <div class="check-badge">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="photo-name">${photo.name}</div>
        <button class="zoom-btn" title="Preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      `;

      // Click on photo to toggle selection
      item.addEventListener('click', (e) => {
        // If clicked zoom button, open lightbox instead
        if (e.target.closest('.zoom-btn')) {
          e.stopPropagation();
          openLightbox(index);
          return;
        }
        toggleSelection(photo.id);
      });

      dom.photoGrid.appendChild(item);
    });
  }

  // ===== SELECTION =====
  function toggleSelection(id) {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      // Check limit
      if (config.max > 0 && selected.size >= config.max) {
        showToast(`Maksimal ${config.max} foto!`);
        return;
      }
      selected.add(id);
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    // Update counter
    dom.countSelected.textContent = selected.size;

    // Update grid items
    document.querySelectorAll('.photo-item').forEach((item) => {
      if (selected.has(item.dataset.id)) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    // Show/hide action bar
    dom.actionBar.style.display = selected.size > 0 ? '' : 'none';

    // Hide WA button if no WA number
    if (!config.wa) {
      dom.btnSendWa.style.display = 'none';
    }
  }

  // ===== EXPORT =====
  function getSelectionText() {
    const lines = [];
    const selectedPhotos = photos.filter((p) => selected.has(p.id));
    lines.push(`📸 *${config.title}*`);
    lines.push(`Jumlah foto dipilih: ${selectedPhotos.length}`);
    lines.push('');
    selectedPhotos.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name}`);
    });
    return lines.join('\n');
  }

  function handleCopySelection() {
    const text = getSelectionText();
    navigator.clipboard.writeText(text).then(() => {
      showToast('List berhasil dicopy!');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('List berhasil dicopy!');
    });
  }

  function handleSendWA() {
    const text = getSelectionText();
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/${config.wa}?text=${encoded}`;
    window.open(url, '_blank');
  }

  // ===== LIGHTBOX =====
  function openLightbox(index) {
    lightboxIndex = index;
    const photo = photos[index];
    dom.lightboxImg.src = photo.fullUrl;
    dom.lightboxCaption.textContent = photo.name;
    dom.lightbox.style.display = '';
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    dom.lightbox.style.display = 'none';
    dom.lightboxImg.src = '';
    document.body.style.overflow = '';
  }

  function navigateLightbox(dir) {
    lightboxIndex = (lightboxIndex + dir + photos.length) % photos.length;
    const photo = photos[lightboxIndex];
    dom.lightboxImg.src = photo.fullUrl;
    dom.lightboxCaption.textContent = photo.name;
  }

  // ===== TOAST =====
  let toastTimeout;
  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      dom.toast.classList.remove('show');
    }, 2200);
  }

  // ===== LIGHTBOX CLICK OUTSIDE =====
  dom.lightbox.addEventListener('click', (e) => {
    if (e.target === dom.lightbox) closeLightbox();
  });

  // ===== START =====
  document.addEventListener('DOMContentLoaded', init);
})();
