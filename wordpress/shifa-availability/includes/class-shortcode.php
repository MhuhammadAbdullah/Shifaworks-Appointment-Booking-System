<?php
/**
 * [shifa_availability] - the one reusable calendar block.
 *
 *   [shifa_availability]                       uses the current page's linked provider (custom field)
 *   [shifa_availability provider="the-slug"]   names the provider explicitly
 *
 * Put it once in the shared Elementor profile template (Shortcode widget); every team page that uses
 * the template gets its own calendar from its own custom field. No per-person code.
 *
 * What visitors get is always something usable: the calendar when the provider resolves, otherwise a
 * plain booking button. Mapping problems and technical detail are shown to administrators only.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Shifa_Availability_Shortcode {

	public static function init() {
		add_shortcode( 'shifa_availability', array( __CLASS__, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
	}

	public static function register_assets() {
		wp_register_style( 'shifa-availability', SHIFA_AV_URL . 'assets/css/shifa-availability.css', array(), SHIFA_AV_VERSION );
		wp_register_script( 'shifa-availability', SHIFA_AV_URL . 'assets/js/shifa-availability.js', array(), SHIFA_AV_VERSION, true );
	}

	private static function current_post_id() {
		$id = get_the_ID();
		return $id ? (int) $id : (int) get_queried_object_id();
	}

	private static function is_admin_viewer() {
		return current_user_can( 'edit_pages' );
	}

	private static function fallback_button( array $settings, $extra_class = '' ) {
		return sprintf(
			'<a class="shifa-av__button %s" href="%s">%s</a>',
			esc_attr( $extra_class ),
			esc_url( $settings['fallback_url'] ),
			esc_html( $settings['fallback_label'] )
		);
	}

	private static function admin_notice( $html ) {
		return '<div class="shifa-av__admin" role="note"><strong>Availability calendar (only administrators see this):</strong> ' . $html . '</div>';
	}

	public static function render( $atts ) {
		$settings = Shifa_Availability_Settings::get();
		$atts     = shortcode_atts( array( 'provider' => '' ), $atts, 'shifa_availability' );

		// Styles for the button and the administrator note, in every state (only the script is conditional).
		wp_enqueue_style( 'shifa-availability' );

		$slug = Shifa_Availability_Mapping::clean_slug( $atts['provider'] );
		if ( '' === $slug ) {
			$slug = Shifa_Availability_Mapping::get_slug( self::current_post_id() );
		}

		$button = '<div class="shifa-av__fallback">' . self::fallback_button( $settings ) . '</div>';

		if ( empty( $settings['enabled'] ) ) {
			return '<div class="shifa-av">' . $button . '</div>';
		}

		if ( '' === $slug ) {
			$note = self::is_admin_viewer()
				? self::admin_notice( 'this page is not linked to a provider. Add the provider address in the "Booking system provider" box on the page editor.' )
				: '';
			return '<div class="shifa-av">' . $note . $button . '</div>';
		}

		// Administrators get the diagnosis in the page; visitors never trigger a server-side API call.
		$note = '';
		if ( self::is_admin_viewer() ) {
			$result = Shifa_Availability_Api::lookup( $slug );
			if ( 'not_found' === $result['status'] ) {
				$note = self::admin_notice( 'no active provider has the address <code>' . esc_html( $slug ) . '</code>, so visitors see only the booking button. Fix the address in the page editor.' );
			} elseif ( 'error' === $result['status'] ) {
				$note = self::admin_notice( 'the booking API could not be reached (' . esc_html( isset( $result['message'] ) ? $result['message'] : 'unknown error' ) . '). Visitors see the booking button if their browser cannot reach it either.' );
			} elseif ( empty( $result['profile']['services'] ) ) {
				$note = self::admin_notice( 'this provider has no bookable services or packages yet, so visitors see only the booking button.' );
			}
		}

		wp_enqueue_script( 'shifa-availability' );

		// The button is part of the markup: it is what shows if JavaScript is off or the calendar can't load.
		return sprintf(
			'<div class="shifa-av" data-shifa-av data-provider="%s" data-api="%s" data-booking="%s" data-fallback-label="%s">%s%s</div>',
			esc_attr( $slug ),
			esc_url( $settings['api_base'] ),
			esc_url( $settings['booking_base'] ),
			esc_attr( $settings['fallback_label'] ),
			$note,
			$button
		);
	}
}
