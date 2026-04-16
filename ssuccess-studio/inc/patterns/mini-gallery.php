<?php
/**
 * Pattern: Mini-Gallery
 * Flexible Bildergalerie mit Titel.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/mini-gallery', array(
    'title'       => 'Mini-Gallery',
    'description' => 'Bildergalerie mit Titel — flexibel von 2 bis 6 Bilder.',
    'categories'  => array('ssuccess-projekte', 'ssuccess-content'),
    'keywords'    => array('galerie', 'gallery', 'bilder', 'images'),
    'content'     => '<!-- wp:html -->
<div class="mini-gallery-section">
  <h3 class="gallery-title reveal">Galerietitel</h3>
  <div class="mini-gallery reveal">
    <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Galeriebild 1">
    <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Galeriebild 2">
    <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Galeriebild 3">
  </div>
</div>
<!-- /wp:html -->',
));
