/* silke-contact.js — wires the contact form to the real /api/contact endpoint.
 *
 * The Silke proposal pages ship a DUMMY form (action="#", an onsubmit that just
 * swaps in a "Danke" message). This script replaces that with a real submission:
 * it posts the form to silke-lengler.ch/api/contact (same origin), which emails
 * Praxis@Silke-Lengler.ch. Design-agnostic — it finds the contact form by its
 * fields, so it works on whichever design ships.
 *
 * Deploy: add  <script src="/silke-contact.js" defer></script>  before </body>
 * of the live page (or paste this whole file inline in a <script> tag).
 */
(function () {
  var ENDPOINT = '/api/contact';

  function isContactForm(f) {
    var hasEmail = f.querySelector('input[type=email], [name=email]');
    var hasMsg = f.querySelector('textarea, [name=nachricht], [name=message]');
    return hasEmail && hasMsg;
  }

  function thanks(form) {
    // Reuse the page's own success markup if the dummy onsubmit defined one;
    // otherwise fall back to a clean, neutral confirmation that inherits styles.
    form.innerHTML =
      '<p style="margin:0;font:inherit;line-height:1.6;opacity:.9">' +
      'Vielen Dank — Ihre Nachricht ist unterwegs.<br>' +
      'Ich melde mich so bald wie möglich persönlich bei Ihnen.</p>';
  }

  function wire(form) {
    if (form.__silkeWired) return;
    form.__silkeWired = true;
    form.removeAttribute('onsubmit'); // kill the dummy client-side handler

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.checkValidity && !form.checkValidity()) { form.reportValidity(); return; }

      var data = new FormData(form);
      var fd = {};
      data.forEach(function (v, k) { fd[k] = typeof v === 'string' ? v.trim() : v; });
      var msg = fd.nachricht || fd.message || '';
      if (!fd.name || !fd.email || !msg) { if (form.reportValidity) form.reportValidity(); return; }

      var btn = form.querySelector('button[type=submit], input[type=submit], button:not([type])');
      var label = btn ? (btn.value || btn.textContent) : '';
      if (btn) { btn.disabled = true; if ('value' in btn) btn.value = 'Wird gesendet …'; else btn.textContent = 'Wird gesendet …'; }

      fetch(ENDPOINT, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (res) {
          if (res && res.ok) { thanks(form); return; }
          alert((res && res.error) || 'Die Nachricht konnte nicht gesendet werden. Bitte schreiben Sie direkt an Praxis@Silke-Lengler.ch.');
          if (btn) { btn.disabled = false; if ('value' in btn) btn.value = label; else btn.textContent = label; }
        })
        .catch(function () {
          alert('Verbindung zum Server fehlgeschlagen. Bitte schreiben Sie direkt an Praxis@Silke-Lengler.ch.');
          if (btn) { btn.disabled = false; if ('value' in btn) btn.value = label; else btn.textContent = label; }
        });
    }, true);
  }

  function init() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) if (isContactForm(forms[i])) wire(forms[i]);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
