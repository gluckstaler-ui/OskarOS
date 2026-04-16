<?php
/**
 * Pattern: Studien-Sektion
 * Dunkler Hintergrund mit Intro, Vollbild-Bild, und Study-Blöcken (Duo + Text).
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/studies', array(
    'title'       => 'Studien — Vollständig',
    'description' => 'Komplette Studien-Sektion mit Einleitung, Vollbild und mehreren Study-Blöcken.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('studien', 'studies', 'fotografie', 'architektur'),
    'content'     => '<!-- wp:html -->
<section class="studies" id="studies">
  <div class="container-wide">
    <div class="section-header">
      <h2 class="section-title reveal">Studien</h2>
      <span class="section-count reveal">Sehen lernen</span>
    </div>
    <div class="studies-intro reveal">
      <h3>Architektur verstehen heißt Architektur sehen</h3>
      <p>Nicht jedes Gebäude verdient eine Pilgerfahrt. Aber manche lehren mehr als jedes Buch. Ich fotografiere sie — nicht als Dokumentation, sondern als Analyse. Das Auge, das diese Bilder macht, ist dasselbe Auge, das meine Entwürfe formt.</p>
    </div>
    <figure class="study-fullwidth reveal">
      <img src="' . esc_url($img) . 'Hole-2.jpg" alt="Die Korridorarkaden von IIM Ahmedabad">
      <figcaption><h4>Korridorarkaden</h4><span>IIM Ahmedabad / Louis Kahn</span></figcaption>
    </figure>
  </div>
</section>
<!-- /wp:html -->',
));

register_block_pattern('ssuccess/study-block-duo', array(
    'title'       => 'Studien — Block (2 Bilder)',
    'description' => 'Study-Block mit zwei Bildern nebeneinander plus Text.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('studien', 'study', 'duo'),
    'content'     => '<!-- wp:html -->
<section class="studies">
  <div class="container-wide">
    <div class="study-block reveal">
      <div class="study-images duo">
        <img src="' . esc_url($img) . 'IMG-0144.jpg" alt="Bild 1">
        <img src="' . esc_url($img) . 'IMG-0114.jpg" alt="Bild 2">
      </div>
      <div class="study-text">
        <h4>Studientitel</h4>
        <div class="location">Ort, Land</div>
        <p>Beschreibung der architektonischen Beobachtung.</p>
      </div>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));

register_block_pattern('ssuccess/study-block-single', array(
    'title'       => 'Studien — Block (1 Bild)',
    'description' => 'Study-Block mit einem Bild plus Text.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('studien', 'study', 'single'),
    'content'     => '<!-- wp:html -->
<section class="studies">
  <div class="container-wide">
    <div class="study-block reveal">
      <div class="study-images">
        <img src="' . esc_url($img) . 'CowInTraffic.jpg" alt="Bild">
      </div>
      <div class="study-text">
        <h4>Studientitel</h4>
        <div class="location">Ort, Land</div>
        <p>Beschreibung der architektonischen Beobachtung.</p>
      </div>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
