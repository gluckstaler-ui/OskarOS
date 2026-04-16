<?php
/**
 * Pattern: Projekte-Grid
 * Projekt-Karten mit Bild, Overlay, Hover-Effekt.
 */
$img = get_template_directory_uri() . '/assets/images/';

register_block_pattern('ssuccess/projekte-grid', array(
    'title'       => 'Projekte — Karten-Grid',
    'description' => 'Grid mit Projekt-Karten inkl. Bild, Name, Typ und Hover-Overlay mit Details.',
    'categories'  => array('ssuccess-projekte'),
    'keywords'    => array('projekte', 'portfolio', 'grid', 'karten'),
    'content'     => '<!-- wp:html -->
<section id="projekte" class="bg-grey">
  <div class="section-inner">
    <h3 class="reveal">Projekte</h3>
    <div class="rule reveal"></div>
    <h2 class="reveal">Gebaut, geplant, gewonnen.</h2>
    <div class="projects-grid">
      <a href="#" class="project-card reveal">
        <img src="' . esc_url($img) . 'baslerdach-pic.jpg" alt="Basel Loggia">
        <div class="project-card-overlay">
          <div class="project-card-overlay-text">
            <h3>Basel Loggia</h3>
            <span>Dachaufstockung</span>
            <span class="project-meta">Basel, Schweiz</span>
          </div>
          <div class="project-card-arrow"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
        </div>
        <div class="project-card-info"><h3>Basel Loggia</h3><span class="project-type">Dachaufstockung</span></div>
      </a>
      <a href="/projekt-kino-eldorado/" class="project-card reveal reveal-delay-1">
        <img src="' . esc_url($img) . 'FassadeSteinerAnkommendOst-echt.jpg" alt="Kino Eldorado">
        <div class="project-card-overlay">
          <div class="project-card-overlay-text">
            <h3>Kino Eldorado</h3>
            <span>Fassadensanierung</span>
            <span class="project-meta">120 m² Fassade · 1 Mio CHF · 2016</span>
          </div>
          <div class="project-card-arrow"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
        </div>
        <div class="project-card-info"><h3>Kino Eldorado</h3><span class="project-type">Fassadensanierung</span></div>
      </a>
      <a href="/projekt-sursee/" class="project-card reveal reveal-delay-2">
        <img src="' . esc_url($img) . 'view-closeup-Eingang-nach-Norden-4.jpg" alt="Sursee">
        <div class="project-card-overlay">
          <div class="project-card-overlay-text">
            <h3>Sursee · Münster Vorstadt Süd</h3>
            <span>Grossüberbauung / Fassadenentwurf</span>
            <span class="project-meta">45.000 m³ · ca. 28 Mio CHF · Baueingabe 2023</span>
          </div>
          <div class="project-card-arrow"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
        </div>
        <div class="project-card-info"><h3>Sursee · Münster Vorstadt Süd</h3><span class="project-type">Grossüberbauung / Fassadenentwurf</span></div>
      </a>
      <a href="/projekt-stuttgart-kita/" class="project-card reveal reveal-delay-1">
        <img src="' . esc_url($img) . 'ModellAnsichtSueden.jpg" alt="Stuttgart Kita">
        <div class="project-card-overlay">
          <div class="project-card-overlay-text">
            <h3>Stuttgart Kita</h3>
            <span>Wettbewerb</span>
            <span class="project-meta">2.200 m² · 4,5 Mio EUR · 2017-2018</span>
          </div>
          <div class="project-card-arrow"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
        </div>
        <div class="project-card-info"><h3>Stuttgart Kita</h3><span class="project-type">Wettbewerb</span></div>
      </a>
      <a href="/projekt-bottmingen/" class="project-card reveal reveal-delay-2">
        <img src="' . esc_url($img) . 'PraesentationSued-westen.jpg" alt="Bottmingen MFH">
        <div class="project-card-overlay">
          <div class="project-card-overlay-text">
            <h3>Bottmingen MFH</h3>
            <span>Mehrfamilienhaus</span>
            <span class="project-meta">3.350 m² · 13 Wohnungen · 2017–2018</span>
          </div>
          <div class="project-card-arrow"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
        </div>
        <div class="project-card-info"><h3>Bottmingen MFH</h3><span class="project-type">Mehrfamilienhaus</span></div>
      </a>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
