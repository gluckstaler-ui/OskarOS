/**
 * OskarOS Theme Scripts
 * Consolidated JavaScript from vibe prototype files
 *
 * Features:
 * - Header scroll transition
 * - Scroll reveal animations
 * - Lightbox functionality
 */

document.addEventListener('DOMContentLoaded', function() {

  // ============================================
  // 1. HEADER SCROLL TRANSITION
  // ============================================
  var header = document.getElementById('siteHeader');
  if (header) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 80) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  // ============================================
  // 2. SCROLL REVEAL ANIMATION
  // ============================================
  var revealElements = document.querySelectorAll('.reveal');

  function checkReveal() {
    var windowHeight = window.innerHeight;
    revealElements.forEach(function(element) {
      var elementTop = element.getBoundingClientRect().top;
      if (elementTop < windowHeight - 80) {
        element.classList.add('active');
      }
    });
  }

  // Run reveal check on scroll and load
  if (revealElements.length > 0) {
    window.addEventListener('scroll', checkReveal);
    window.addEventListener('load', checkReveal);
    // Initial check in case elements are visible on page load
    checkReveal();
  }

  // ============================================
  // 3. LIGHTBOX FUNCTIONALITY
  // ============================================
  window.openLightbox = function(src, caption) {
    var overlay = document.getElementById('lightbox');
    var img = document.getElementById('lightboxImg');
    var cap = document.getElementById('lightboxCaption');

    if (overlay && img && cap) {
      img.src = src;
      img.alt = caption;
      cap.textContent = caption;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  };

  window.closeLightbox = function(event) {
    // Don't close if clicking on the image itself
    if (event && event.target === document.getElementById('lightboxImg')) return;

    var overlay = document.getElementById('lightbox');
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  // Close lightbox on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      window.closeLightbox(e);
    }
  });

});
