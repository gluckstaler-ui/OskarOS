<?php
/**
 * SSUCCESS Studio — Block-based Theme
 *
 * Registers block patterns, enqueues assets, sets up theme support.
 * Birgit builds pages from reusable section blocks.
 */

// ─── Assets ───────────────────────────────────────────────
function ssuccess_enqueue_assets() {
    wp_enqueue_style('google-fonts', 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap', array(), null);
    wp_enqueue_style('ssuccess-main', get_template_directory_uri() . '/assets/css/main.css', array('google-fonts'), '2.0.0');
    wp_enqueue_style('ssuccess-style', get_stylesheet_uri(), array('ssuccess-main'), '2.0.0');
    wp_enqueue_script('ssuccess-scripts', get_template_directory_uri() . '/assets/js/scripts.js', array(), '2.0.0', true);
}
add_action('wp_enqueue_scripts', 'ssuccess_enqueue_assets');

// Load main.css in the Gutenberg editor too so blocks look right
function ssuccess_enqueue_editor_assets() {
    wp_enqueue_style('google-fonts-editor', 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap', array(), null);
    wp_enqueue_style('ssuccess-editor', get_template_directory_uri() . '/assets/css/main.css', array('google-fonts-editor'), '2.0.0');
    wp_enqueue_style('ssuccess-editor-overrides', get_template_directory_uri() . '/assets/css/editor.css', array('ssuccess-editor'), '2.0.0');
}
add_action('enqueue_block_editor_assets', 'ssuccess_enqueue_editor_assets');

// ─── Navigation ───────────────────────────────────────────
function ssuccess_register_menus() {
    register_nav_menus(array(
        'primary' => __('Primary Navigation', 'ssuccess-studio'),
    ));
}
add_action('init', 'ssuccess_register_menus');

class SSUCCESS_Nav_Walker extends Walker_Nav_Menu {
    function start_el(&$output, $item, $depth = 0, $args = null, $id = 0) {
        $output .= '<a href="' . esc_url($item->url) . '">' . esc_html($item->title) . '</a>' . "\n";
    }
    function end_el(&$output, $item, $depth = 0, $args = null) {}
    function start_lvl(&$output, $depth = 0, $args = null) {}
    function end_lvl(&$output, $depth = 0, $args = null) {}
}

function ssuccess_fallback_menu() {
    echo '<a href="' . esc_url(home_url('/#schwerpunkte')) . '">Schwerpunkte</a>';
    echo '<a href="' . esc_url(home_url('/#projekte')) . '">Projekte</a>';
    echo '<a href="' . esc_url(home_url('/#studies')) . '">Studien</a>';
    echo '<a href="' . esc_url(home_url('/#kontakt')) . '">Kontakt</a>';
}

// ─── Theme Support ────────────────────────────────────────
function ssuccess_theme_support() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', array('search-form', 'comment-form', 'comment-list', 'gallery', 'caption'));
    add_theme_support('custom-logo');
    add_theme_support('menus');
    add_theme_support('editor-styles');
    add_theme_support('wp-block-styles');
    add_theme_support('responsive-embeds');
    add_theme_support('align-wide');
}
add_action('after_setup_theme', 'ssuccess_theme_support');

// ─── Helper ───────────────────────────────────────────────
function ssuccess_image($filename) {
    return get_template_directory_uri() . '/assets/images/' . $filename;
}

// ─── Block Pattern Category ──────────────────────────────
function ssuccess_register_pattern_categories() {
    register_block_pattern_category('ssuccess-hero', array(
        'label' => __('SSUCCESS — Hero', 'ssuccess-studio'),
    ));
    register_block_pattern_category('ssuccess-content', array(
        'label' => __('SSUCCESS — Inhalt', 'ssuccess-studio'),
    ));
    register_block_pattern_category('ssuccess-projekte', array(
        'label' => __('SSUCCESS — Projekte', 'ssuccess-studio'),
    ));
    register_block_pattern_category('ssuccess-layout', array(
        'label' => __('SSUCCESS — Layout', 'ssuccess-studio'),
    ));
}
add_action('init', 'ssuccess_register_pattern_categories');

// ─── Block Patterns ──────────────────────────────────────
function ssuccess_register_block_patterns() {
    $pattern_dir = get_template_directory() . '/inc/patterns/';
    $patterns = glob($pattern_dir . '*.php');
    foreach ($patterns as $pattern_file) {
        require $pattern_file;
    }
}
add_action('init', 'ssuccess_register_block_patterns');

// ─── Theme Auto-Setup (runs on activation) ───────────
require_once get_template_directory() . '/inc/theme-setup.php';

// ─── Allow SVG in Custom HTML blocks ─────────────────────
function ssuccess_allow_svg_upload($mimes) {
    $mimes['svg'] = 'image/svg+xml';
    return $mimes;
}
add_filter('upload_mimes', 'ssuccess_allow_svg_upload');

// ─── Wider editor for our full-width layouts ─────────────
function ssuccess_editor_width() {
    add_theme_support('editor-styles');
}
add_action('after_setup_theme', 'ssuccess_editor_width');
