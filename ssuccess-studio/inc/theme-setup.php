<?php
/**
 * SSUCCESS Studio — Theme Auto-Setup
 *
 * Runs on theme activation. Creates pages with block content,
 * sets front page, builds navigation menu.
 *
 * Safe to re-activate: only creates pages that don't already exist.
 */

function ssuccess_studio_setup() {
    $img_url = get_template_directory_uri() . '/assets/images/';

    // Pages to create: slug => [title, content_file, template]
    $pages = array(
        'home' => array(
            'title'    => 'Home',
            'file'     => 'page_70_blocks.html',
            'template' => '',
        ),
        'projekt-sursee' => array(
            'title'    => 'Sursee — Münster Vorstadt Süd',
            'file'     => 'page_71_blocks.html',
            'template' => '',
        ),
        'projekt-kino-eldorado' => array(
            'title'    => 'Kino Eldorado',
            'file'     => 'page_72_blocks.html',
            'template' => '',
        ),
        'projekt-stuttgart-kita' => array(
            'title'    => 'Stuttgart Kita',
            'file'     => 'page_73_blocks.html',
            'template' => '',
        ),
        'projekt-bottmingen' => array(
            'title'    => 'Bottmingen MFH',
            'file'     => 'page_74_blocks.html',
            'template' => '',
        ),
    );

    $home_page_id = null;
    $created = array();

    foreach ($pages as $slug => $config) {
        // Check if page already exists
        $existing = get_page_by_path($slug);
        if ($existing) {
            if ($slug === 'home') {
                $home_page_id = $existing->ID;
            }
            continue; // Don't overwrite existing pages
        }

        // Read block content from theme file
        $content_path = get_template_directory() . '/inc/starter-content/' . $config['file'];
        if (!file_exists($content_path)) {
            continue;
        }

        $content = file_get_contents($content_path);

        // Replace image placeholder with actual theme URL
        $content = str_replace('{{THEME_IMAGES}}', $img_url, $content);

        // Create the page
        $page_id = wp_insert_post(array(
            'post_title'   => $config['title'],
            'post_name'    => $slug,
            'post_content' => $content,
            'post_status'  => 'publish',
            'post_type'    => 'page',
            'post_author'  => get_current_user_id(),
        ));

        if (!is_wp_error($page_id)) {
            $created[] = $config['title'];

            if ($slug === 'home') {
                $home_page_id = $page_id;
            }

            // Set page template if specified
            if (!empty($config['template'])) {
                update_post_meta($page_id, '_wp_page_template', $config['template']);
            }
        }
    }

    // Set front page to the Home page
    if ($home_page_id) {
        update_option('show_on_front', 'page');
        update_option('page_on_front', $home_page_id);
    }

    // Create navigation menu
    ssuccess_studio_create_menu();

    // Show admin notice about what was created
    if (!empty($created)) {
        set_transient('ssuccess_setup_notice', $created, 60);
    }
}
add_action('after_switch_theme', 'ssuccess_studio_setup');

/**
 * Create the primary navigation menu.
 */
function ssuccess_studio_create_menu() {
    // Check if menu already exists
    $menu_name = 'SSUCCESS Navigation';
    $menu_exists = wp_get_nav_menu_object($menu_name);
    if ($menu_exists) {
        return;
    }

    $menu_id = wp_create_nav_menu($menu_name);
    if (is_wp_error($menu_id)) {
        return;
    }

    // Add menu items — anchor links to homepage sections
    $items = array(
        array('title' => 'Schwerpunkte', 'url' => home_url('/#schwerpunkte')),
        array('title' => 'Projekte',     'url' => home_url('/#projekte')),
        array('title' => 'Studien',      'url' => home_url('/#studies')),
        array('title' => 'Kontakt',      'url' => home_url('/#kontakt')),
    );

    foreach ($items as $i => $item) {
        wp_update_nav_menu_item($menu_id, 0, array(
            'menu-item-title'   => $item['title'],
            'menu-item-url'     => $item['url'],
            'menu-item-status'  => 'publish',
            'menu-item-type'    => 'custom',
            'menu-item-position' => $i + 1,
        ));
    }

    // Assign to primary location
    $locations = get_theme_mod('nav_menu_locations');
    $locations['primary'] = $menu_id;
    set_theme_mod('nav_menu_locations', $locations);
}

/**
 * Show admin notice after setup.
 */
function ssuccess_studio_admin_notice() {
    $created = get_transient('ssuccess_setup_notice');
    if (!$created) {
        return;
    }
    delete_transient('ssuccess_setup_notice');

    $count = count($created);
    $list = implode(', ', $created);
    echo '<div class="notice notice-success is-dismissible">';
    echo '<p><strong>SSUCCESS Studio:</strong> ';
    echo sprintf('%d Seiten erstellt: %s', $count, esc_html($list));
    echo ' — Navigation eingerichtet. <a href="' . esc_url(home_url('/')) . '">Seite ansehen →</a></p>';
    echo '</div>';
}
add_action('admin_notices', 'ssuccess_studio_admin_notice');
