<?php
/**
 * Pattern: Schwerpunkte & Leistungen
 * 4×3 Grid mit Icons, Titeln und kurzen Beschreibungen.
 */
register_block_pattern('ssuccess/schwerpunkte', array(
    'title'       => 'Schwerpunkte — Leistungs-Grid',
    'description' => '12 Leistungen als Icon-Karten in 3 Reihen à 4.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('schwerpunkte', 'leistungen', 'services', 'grid'),
    'content'     => '<!-- wp:html -->
<section id="schwerpunkte">
  <div class="section-inner">
    <h3 class="reveal">Schwerpunkte</h3>
    <div class="rule reveal"></div>
    <h2 class="reveal">Was wir besonders gut können.</h2>
    <div class="staerken-grid">
      <div class="staerke-item reveal reveal-delay-1">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg></div>
        <h3>Aufstockungen aus Holz</h3>
        <p>Zusammenarbeit mit ERNE AG Holzbau und EKON Modulbau für komplette Holzfertigmodule.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-2">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg></div>
        <h3>Bestandsoptimierung</h3>
        <p>Genaue Analyse, optimaler Umbau, kostengünstig.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-3">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg></div>
        <h3>Solarintegration</h3>
        <p>Photovoltaik in die Fassade integriert (Megasol).</p>
      </div>
      <div class="staerke-item reveal reveal-delay-4">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <h3>Denkmalschutz</h3>
        <p>Bauhistorische Untersuchung und Behördenkoordination.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-1">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg></div>
        <h3>Entwurf</h3>
        <p>Die Idee wird Raum.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-2">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
        <h3>Machbarkeitsstudien</h3>
        <p>Was geht — und was nicht.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-3">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
        <h3>Bauhistorische Untersuchung</h3>
        <p>Die Geschichte lesen.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-4">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <h3>Denkmalschutzberatung</h3>
        <p>Schützen, was zählt.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-1">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><polyline points="16 21 12 17 8 21"/><line x1="12" y1="3" x2="12" y2="7"/></svg></div>
        <h3>Baueingabeplanung</h3>
        <p>Vom Plan zum Bewilligten.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-2">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>
        <h3>Werkplanung</h3>
        <p>Jedes Detail. Jeder Anschluss.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-3">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
        <h3>Bauleitung</h3>
        <p>Auf der Baustelle. Nicht im Büro.</p>
      </div>
      <div class="staerke-item reveal reveal-delay-4">
        <div class="staerke-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg></div>
        <h3>Energetische Beratung</h3>
        <p>Weniger Energie. Mehr Gebäude.</p>
      </div>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
