(function () {
  'use strict';
  var MAX_SMS = 5;
  var KEY = 'bf_sms_count';

  function getCount() {
    try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch (e) { return 0; }
  }

  function setCount(n) {
    try { localStorage.setItem(KEY, n); } catch (e) { /* private browsing */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var links = document.querySelectorAll('.sms-limited');
    if (!links.length) return;

    var count = getCount();

    if (count >= MAX_SMS) {
      links.forEach(function (link) {
        link.removeAttribute('href');
        link.style.opacity = '0.45';
        link.style.pointerEvents = 'none';
        link.setAttribute('title', 'Text limit reached');
      });
      return;
    }

    links.forEach(function (link) {
      link.addEventListener('click', function (e) {
        var current = getCount();
        if (current >= MAX_SMS) {
          e.preventDefault();
          link.removeAttribute('href');
          link.style.opacity = '0.45';
          link.style.pointerEvents = 'none';
          link.setAttribute('title', 'Text limit reached');
          return;
        }
        setCount(current + 1);
      });
    });
  });
})();
