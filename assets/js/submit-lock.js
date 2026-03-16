/**
 * Double-submit protection for all Netlify forms.
 * Disables the submit button after first click and shows a "Submitting..." state.
 * Works with Bootstrap validation (.needs-validation) and native Netlify forms.
 */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var forms = document.querySelectorAll('form[data-netlify="true"]');
    forms.forEach(function (form) {
      var submitted = false;
      form.addEventListener('submit', function (e) {
        // Let Bootstrap validation run first
        if (!form.checkValidity()) {
          form.classList.add('was-validated');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Block double submit
        if (submitted) {
          e.preventDefault();
          return;
        }
        submitted = true;
        var btn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (btn) {
          btn.disabled = true;
          btn.dataset.originalText = btn.textContent;
          btn.textContent = 'Submitting...';
        }
        // Re-enable after 8s in case of network failure (allows retry)
        setTimeout(function () {
          submitted = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || 'Submit';
          }
        }, 8000);
      });
    });
  });
})();
