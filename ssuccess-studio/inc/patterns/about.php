<?php
/**
 * Pattern: Über — Portrait + Bio
 * Bild links, Name + Bio rechts.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/about', array(
    'title'       => 'Über — Portrait & Bio',
    'description' => 'Portrait-Bild neben Biografie-Text.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('über', 'about', 'bio', 'portrait'),
    'content'     => '<!-- wp:html -->
<section id="ueber">
  <div class="about-grid">
    <div class="reveal">
      <img src="' . esc_url($img) . 'birgit.jpeg" alt="Birgit Müller" class="about-portrait">
    </div>
    <div class="about-text reveal reveal-delay-2">
      <h3>Birgit Müller</h3>
      <div class="rule"></div>
      <h2>Vom Volkswirt zur Architektin.</h2>
      <p>Erste Karriere: Zehn Jahre Prozessberatung, Betriebsleitung, Wirtschaftswissenschaft. Dann der Schnitt — Architekturstudium mit Anfang 30. Stuttgart. Ahmedabad. Fassaden bei Theo Hotz. Master in umweltgerechter Architektur.</p>
      <p>Was das bedeutet: Ich weiß, wie Prozesse funktionieren. Und ich weiß, dass gute Architektur persönliche Verantwortung braucht. Ein Büro, eine Inhaberin. Wenn ich „ja" sage, bekommen Sie meine volle Aufmerksamkeit.</p>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
