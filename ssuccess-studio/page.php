<?php
/**
 * Generic page template
 */
get_header();
?>

<main id="content">
	<?php
	while (have_posts()) : the_post();
		the_content();
	endwhile;
	?>
</main>

<?php get_footer(); ?>
