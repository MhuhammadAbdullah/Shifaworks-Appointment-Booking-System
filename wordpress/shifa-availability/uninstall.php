<?php
/**
 * Runs when the plugin is deleted from WordPress. Removes only the plugin's own settings.
 * The per-page provider links (custom field shifa_provider_slug) are deliberately left in place,
 * so reinstalling the plugin restores every team page.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'shifa_availability_settings' );
