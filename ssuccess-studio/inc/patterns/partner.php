<?php
/**
 * Pattern: Partner-Reihe
 * Netzwerk-Partner als Inline-Links.
 */
register_block_pattern('ssuccess/partner', array(
    'title'       => 'Partner — Netzwerk',
    'description' => 'Partner-Links in einer Reihe.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('partner', 'netzwerk', 'links'),
    'content'     => '<!-- wp:html -->
<section class="bg-grey">
  <div class="section-inner">
    <h3 class="reveal">Netzwerk</h3>
    <div class="rule reveal"></div>
    <h2 class="reveal">Partner</h2>
    <div class="partner-row reveal">
      <span class="partner-link">ERNE AG Holzbau</span>
      <a href="https://ekon-modulbau.swiss/" target="_blank" class="partner-link">EKON Modulbau</a>
      <a href="https://maurer-architekten.de" target="_blank" class="partner-link">Stohrer / Maurer Architekten</a>
      <a href="https://megasol.ch" target="_blank" class="partner-link">Megasol</a>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
