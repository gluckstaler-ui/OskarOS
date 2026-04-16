<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header" id="siteHeader">
  <div class="header-inner">
    <button class="mobile-toggle" onclick="document.querySelector('.header-nav').classList.toggle('open')">
      <span></span><span></span><span></span>
    </button>
    <nav class="header-nav">
      <?php
      if (has_nav_menu('primary')) {
          wp_nav_menu(array(
              'theme_location' => 'primary',
              'container' => false,
              'items_wrap' => '%3$s',
              'walker' => new SSUCCESS_Nav_Walker(),
          ));
      } else {
          ssuccess_fallback_menu();
      }
      ?>
    </nav>
    <a href="<?php echo esc_url(home_url('/')); ?>" class="header-logo">
      <img src="<?php echo ssuccess_image('logo-weiss.svg'); ?>" alt="<?php bloginfo('name'); ?>">
    </a>
  </div>
</header>
