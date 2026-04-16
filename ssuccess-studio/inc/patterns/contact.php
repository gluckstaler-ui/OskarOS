<?php
/**
 * Pattern: Kontakt
 * Text + Kontaktdaten links, Formular rechts.
 */
register_block_pattern('ssuccess/contact', array(
    'title'       => 'Kontakt — Formular',
    'description' => 'Kontaktbereich mit Text, Adresse und Kontaktformular.',
    'categories'  => array('ssuccess-content'),
    'keywords'    => array('kontakt', 'contact', 'formular', 'form'),
    'content'     => '<!-- wp:html -->
<section id="kontakt">
  <div class="contact-grid">
    <div class="contact-text reveal">
      <h3>Kontakt</h3>
      <div class="rule"></div>
      <h2>Projekte, die zu mir passen.</h2>
      <p>Dachaufstockungen. Umbauten. Schwierige Bausubstanz. Wenn Ihr Projekt in diese Kategorie fällt, sollten wir reden.</p>
      <div class="contact-details">
        <p>BIRGIT MÜLLER<br>
        info@ssuccess.ch<br>
        +41 76 605 9968</p>
      </div>
    </div>
    <form class="contact-form reveal reveal-delay-2" onsubmit="event.preventDefault(); alert(\'Gesendet — danke.\');">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required>
      <label for="telefon">Telefon</label>
      <input type="tel" id="telefon" name="telefon">
      <label for="betreff">Betreff</label>
      <input type="text" id="betreff" name="betreff">
      <label for="nachricht">Nachricht</label>
      <textarea id="nachricht" name="nachricht" required></textarea>
      <button type="submit">Absenden</button>
    </form>
  </div>
</section>
<!-- /wp:html -->',
));
