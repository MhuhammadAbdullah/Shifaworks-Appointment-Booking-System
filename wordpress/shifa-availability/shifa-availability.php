<?php
/**
 * Plugin Name:       ShifaWorks Availability Calendar
 * Description:       Shows a team member's live availability from the ShifaWorks booking system on their profile page, via the [shifa_availability] shortcode.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ShifaWorks
 * License:           GPL-2.0-or-later
 * Text Domain:       shifa-availability
 *
 * The booking system stays the single source of truth: nothing about availability is stored in
 * WordPress. Each profile page only stores which provider it belongs to (the provider's address/slug).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SHIFA_AV_VERSION', '1.0.0' );
define( 'SHIFA_AV_FILE', __FILE__ );
define( 'SHIFA_AV_DIR', plugin_dir_path( __FILE__ ) );
define( 'SHIFA_AV_URL', plugin_dir_url( __FILE__ ) );

require_once SHIFA_AV_DIR . 'includes/class-settings.php';
require_once SHIFA_AV_DIR . 'includes/class-api.php';
require_once SHIFA_AV_DIR . 'includes/class-mapping.php';
require_once SHIFA_AV_DIR . 'includes/class-shortcode.php';

Shifa_Availability_Settings::init();
Shifa_Availability_Mapping::init();
Shifa_Availability_Shortcode::init();
