<?php
/**
 * Pattern: Hero — Homepage
 * Text links, Bild rechts. Tagline, Headline, Subtitle, CTA.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/hero-homepage', array(
    'title'       => 'Hero — Homepage',
    'description' => 'Hero-Bereich mit Tagline, Headline, Beschreibung und CTA-Button links, Bild rechts.',
    'categories'  => array('ssuccess-hero'),
    'keywords'    => array('hero', 'startseite', 'homepage'),
    'content'     => '<!-- wp:html -->
<div class="hero-v3" id="hero-section">
  <div class="hero-v3-container">
    <div class="hero-v3-text reveal">
      <h3 class="hero-v3-tagline">SSUCCESS Architektur</h3>
      <div class="rule"></div>
      <h1>Wir bauen nicht neu. Wir bauen weiter.</h1>
      <p class="hero-v3-subtitle">Architekturstudio in Zürich. Spezialisiert auf Bestandsentwicklung, Holz-Aufstockungen und nachhaltige Planung — immer mit der Natur, nie dagegen.</p>
      <a href="#projekte" class="hero-v3-cta">Projekte ansehen &rarr;</a>
    </div>
    <div class="hero-v3-image-wrap reveal reveal-delay-2">
      <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Gebäudeeingang — Holzlamellen, Betonpfeiler, reifer Baum" class="hero-v3-image">
    </div>
  </div>
</div>
<!-- /wp:html -->',
));
