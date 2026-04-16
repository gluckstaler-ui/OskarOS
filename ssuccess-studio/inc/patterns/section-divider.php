<?php
/**
 * Pattern: Section Divider
 * Einfacher Abschnittswechsel mit Titel und Regel.
 */
register_block_pattern('ssuccess/section-header', array(
    'title'       => 'Abschnitts-Titel',
    'description' => 'Überschrift mit Linie darunter — zum Einleiten eines neuen Abschnitts.',
    'categories'  => array('ssuccess-layout'),
    'keywords'    => array('titel', 'header', 'section', 'divider'),
    'content'     => '<!-- wp:html -->
<div class="section-inner">
  <h3 class="reveal">Titel</h3>
  <div class="rule reveal"></div>
  <h2 class="reveal">Untertitel oder Aussage.</h2>
</div>
<!-- /wp:html -->',
));
