<?php
/**
 * Pattern: Hero — Projektseite
 * Fullscreen-Bild mit Gradient, Projektname, Typ, Subtitle + Projektdaten-Karte.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/hero-project', array(
    'title'       => 'Hero — Projektseite',
    'description' => 'Vollbild-Hero mit Projekttitel, Kategorie, Beschreibung und Projektdaten-Karte.',
    'categories'  => array('ssuccess-hero', 'ssuccess-projekte'),
    'keywords'    => array('hero', 'projekt', 'project'),
    'content'     => '<!-- wp:html -->
<section class="project-hero" style="background-image: url(' . esc_url($img) . 'PraesentationSued-westen.jpg);">
  <div class="project-hero-overlay">
    <div class="project-hero-text">
      <span class="project-category">PROJEKTTYP</span>
      <h1 class="project-title">Projektname</h1>
      <p class="project-subtitle">Kurze Beschreibung des Projekts.</p>
    </div>
    <div class="project-facts-card">
      <h4>PROJEKTDATEN</h4>
      <div class="facts-row"><span class="facts-label">BGF</span><span class="facts-value">0.000 m²</span></div>
      <div class="facts-row"><span class="facts-label">Bauzeit</span><span class="facts-value">2024–2025</span></div>
      <div class="facts-row"><span class="facts-label">Ort</span><span class="facts-value">Ort, Schweiz</span></div>
      <div class="facts-row"><span class="facts-label">Einheiten</span><span class="facts-value">0 Wohnungen</span></div>
      <div class="facts-row"><span class="facts-label">Bauherr</span><span class="facts-value">Privat</span></div>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
