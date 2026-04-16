<?php
/**
 * Pattern: Story-Pair
 * Bild + Text nebeneinander — die Grundeinheit der Projektseiten.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/story-pair', array(
    'title'       => 'Story-Pair — Bild + Text',
    'description' => 'Bild links oder rechts neben Beschreibungstext. Grundbaustein für Projektseiten.',
    'categories'  => array('ssuccess-projekte', 'ssuccess-content'),
    'keywords'    => array('story', 'pair', 'bild', 'text', 'projekt'),
    'content'     => '<!-- wp:html -->
<div class="story-pair">
  <div class="story-image reveal">
    <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Projektbild">
  </div>
  <div class="story-text reveal reveal-delay-2">
    <h3>Abschnittstitel</h3>
    <p>Beschreibungstext zu diesem Aspekt des Projekts. Was macht diesen Teil besonders?</p>
  </div>
</div>
<!-- /wp:html -->',
));

register_block_pattern('ssuccess/story-pair-dark', array(
    'title'       => 'Story-Pair — Dunkel',
    'description' => 'Story-Pair mit dunklem Hintergrund (warm grey).',
    'categories'  => array('ssuccess-projekte', 'ssuccess-content'),
    'keywords'    => array('story', 'pair', 'dark', 'dunkel'),
    'content'     => '<!-- wp:html -->
<div class="story-pair story-pair-dark">
  <div class="story-image reveal">
    <img src="' . esc_url($img) . 'view-closeup-Eingang-nahe.jpg" alt="Projektbild">
  </div>
  <div class="story-text reveal reveal-delay-2">
    <h3>Abschnittstitel</h3>
    <p>Beschreibungstext auf dunklem Hintergrund.</p>
  </div>
</div>
<!-- /wp:html -->',
));
