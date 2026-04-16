<?php
/**
 * Pattern: Philosophie-Karten
 * 4 Karten in einer Reihe mit Icon, Titel, Beschreibung + Schlusssatz.
 */
register_block_pattern('ssuccess/philosophy-cards', array(
    'title'       => 'Philosophie — 4 Karten',
    'description' => 'Vier Info-Karten mit Icons in einer Reihe, plus Abschlusssatz.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('karten', 'cards', 'philosophie', 'features'),
    'content'     => '<!-- wp:html -->
<section class="philosophy-detail">
  <div class="section-inner">
    <div class="philosophy-cards">
      <div class="philosophy-card reveal">
        <div class="card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <h4>Phase Null</h4>
        <p>Bevor wir entwerfen, untersuchen wir. Die Geschichte des Hauses lesen. Verstehen, warum es so ist.</p>
      </div>
      <div class="philosophy-card reveal reveal-delay-1">
        <div class="card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h4>Was könnte es sein?</h4>
        <p>Die Frage nach der Möglichkeit — nicht nach der Gewohnheit. Jedes Gebäude trägt sein Potenzial in sich.</p>
      </div>
      <div class="philosophy-card reveal reveal-delay-2">
        <div class="card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <h4>Ehrliche Materialien</h4>
        <p>Holz, Stein, Stahl, Glas. Was da ist, wird nicht versteckt. Was neu kommt, ergänzt — nie dominiert.</p>
      </div>
      <div class="philosophy-card reveal reveal-delay-3">
        <div class="card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17l-5.384-3.19A1.5 1.5 0 015 10.68V6.757a1.5 1.5 0 01.788-1.32l5.384-2.94a1.5 1.5 0 011.456-.001l5.384 2.94A1.5 1.5 0 0118.8 6.757v3.924a1.5 1.5 0 01-.788 1.32l-5.384 3.19a1.5 1.5 0 01-1.208-.001z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 12v6.5" />
          </svg>
        </div>
        <h4>Begleitung</h4>
        <p>Wir verschwinden nicht nach dem Entwurf. Bauleitung heisst: auf der Baustelle stehen. Eine Ansprechperson.</p>
      </div>
    </div>
    <div class="philosophy-closing reveal">
      <p>Schöner, bezahlbarer Wohnraum in einer ansprechenden Umgebung. Das klingt einfach. Es erfordert, dass man <span class="closing-accent">zuerst zuhört</span>.</p>
    </div>
  </div>
</section>
<!-- /wp:html -->',
));
