/**
 * Lightweight client-side error monitoring.
 * Captures unhandled errors and promise rejections, then sends them
 * to the analytics tracking endpoint for visibility.
 *
 * No external dependencies — uses the existing /track endpoint.
 */
(function () {
  'use strict';

  var MAX_ERRORS_PER_SESSION = 10;
  var errorCount = 0;

  function reportError(data) {
    if (errorCount >= MAX_ERRORS_PER_SESSION) return;
    errorCount++;

    try {
      var payload = {
        type: 'client_error',
        page: location.pathname,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        message: data.message || 'Unknown error',
        source: data.source || '',
        line: data.line || 0,
        col: data.col || 0,
        stack: (data.stack || '').slice(0, 500),
      };

      // Use sendBeacon for reliable delivery (doesn't block page unload)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          '/.netlify/functions/track',
          JSON.stringify(payload)
        );
      }
    } catch {
      // Silently ignore errors in the error reporter itself
    }
  }

  window.addEventListener('error', function (event) {
    reportError({
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error ? event.error.stack : '',
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason || {};
    reportError({
      message: 'Unhandled Promise: ' + (reason.message || String(reason)),
      stack: reason.stack || '',
    });
  });
})();
