<?php
/**
 * Pattern: Philosophie
 * Headline + Leittext links, grosses Bild rechts. Grauer Hintergrund.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/philosophy', array(
    'title'       => 'Philosophie — Text + Bild',
    'description' => 'Abschnitt mit Titel, Untertitel und Beschreibungstext neben einem grossen Bild.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('philosophie', 'ansatz', 'über'),
    'content'     => '<!-- wp:html -->
<section class="bg-grey">
  <div class="section-inner philosophy-section">
    <div class="reveal">
      <h3>Unser Ansatz</h3>
      <div class="rule"></div>
      <h2>Die Natur hat Recht.</h2>
      <p class="philosophy-lead">Architektur, die zuhört. Bevor sie gestaltet. Bevor sie entscheidet. Bevor sie den ersten Strich zieht.</p><br>
      <p class="philosophy-lead">Wir ergründen den Charakter. Erst dann entwerfen wir.</p>
    </div>
    <img src="' . esc_url($img) . 'all-shared-hero-concept-hero-v1-4.jpg" alt="Die Natur hat Recht" class="philosophy-image reveal reveal-delay-2">
  </div>
</section>
<!-- /wp:html -->',
));
