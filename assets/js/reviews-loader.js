(function () {
  'use strict';

  var REVIEWS_API = '/.netlify/functions/fetch-reviews';
  var container = document.getElementById('reviewsGrid');
  var statsEl = document.getElementById('reviewStats');
  if (!container) return;

  function renderStars(count) {
    var html = '';
    for (var i = 0; i < 5; i++) {
      html += i < count ? '<span class="star filled">&#9733;</span>' : '<span class="star empty">&#9734;</span>';
    }
    return html;
  }

  function sourceIcon(source) {
    if (source === 'google') return '<span class="review-source" title="Google Review"><svg width="16" height="16" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.09 24.09 0 000 21.56l7.98-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>';
    if (source === 'facebook') return '<span class="review-source" title="Facebook Review"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></span>';
    return '';
  }

  function renderReviewCard(review) {
    return '<div class="col-md-6 col-lg-4 mb-4">' +
      '<div class="card review-card p-4 h-100 border-0 shadow-sm">' +
        '<div class="d-flex align-items-center mb-2">' +
          '<div class="review-stars">' + renderStars(review.rating) + '</div>' +
          sourceIcon(review.source) +
        '</div>' +
        '<p class="fst-italic text-muted flex-grow-1">&ldquo;' + escapeHtml(review.text) + '&rdquo;</p>' +
        '<div class="mt-auto d-flex justify-content-between align-items-center">' +
          '<strong>' + escapeHtml(review.author) + '</strong>' +
          (review.relativeTime ? '<small class="text-muted">' + escapeHtml(review.relativeTime) + '</small>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderStats(data) {
    if (!statsEl) return;
    if (data.overallRating && data.totalRatings) {
      statsEl.innerHTML =
        '<div class="text-center mb-4">' +
          '<div class="display-4 fw-bold text-warning">' + renderStars(Math.round(data.overallRating)) + '</div>' +
          '<p class="lead text-muted">' + data.overallRating.toFixed(1) + ' out of 5 &mdash; based on ' + data.totalRatings + ' reviews</p>' +
        '</div>';
    }
  }

  function renderFallback() {
    // Show the existing static reviews if API fails
    container.innerHTML =
      '<div class="col-md-4 mb-4"><div class="card p-4 h-100 border-0 shadow-sm">' +
        '<div class="text-warning mb-2">&#9733;&#9733;&#9733;&#9733;&#9733;</div>' +
        '<p class="fst-italic text-muted">&ldquo;Found a great F-150 at Bells Fork. The price was fair and they were upfront about everything. No pressure, no games. Highly recommend.&rdquo;</p>' +
        '<strong class="mt-auto">Michael R.</strong></div></div>' +
      '<div class="col-md-4 mb-4"><div class="card p-4 h-100 border-0 shadow-sm">' +
        '<div class="text-warning mb-2">&#9733;&#9733;&#9733;&#9733;&#9733;</div>' +
        '<p class="fst-italic text-muted">&ldquo;Bought a used RAV4 here and it was exactly as described. They showed me the inspection report and walked me through everything. Honest dealers are hard to find.&rdquo;</p>' +
        '<strong class="mt-auto">Sarah J.</strong></div></div>' +
      '<div class="col-md-4 mb-4"><div class="card p-4 h-100 border-0 shadow-sm">' +
        '<div class="text-warning mb-2">&#9733;&#9733;&#9733;&#9733;&#9733;</div>' +
        '<p class="fst-italic text-muted">&ldquo;Picked up a diesel RAM for my business. They had it ready and the whole process was smooth. Best vehicle buying experience I&apos;ve had.&rdquo;</p>' +
        '<strong class="mt-auto">David P.</strong></div></div>';
  }

  async function loadReviews() {
    container.innerHTML = '<div class="col-12 text-center py-4"><div class="spinner-border text-muted" role="status"></div><p class="text-muted mt-2">Loading reviews...</p></div>';

    try {
      var res = await fetch(REVIEWS_API);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();

      if (!data.ok || !data.reviews || data.reviews.length === 0) {
        renderFallback();
        return;
      }

      renderStats(data);
      container.innerHTML = data.reviews.map(renderReviewCard).join('');
    } catch (err) {
      console.warn('Reviews load error:', err.message);
      renderFallback();
    }
  }

  loadReviews();
})();
