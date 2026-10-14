<?php
/**
 * Plugin settings (Settings > ShifaWorks Availability). Only public URLs live here - no keys or tokens.
 *
 * Each value can also be pinned in wp-config.php so staging and production can't be mixed up:
 *   define( 'SHIFA_AV_API_BASE',     'https://api.shifaworks.com/api/v1' );
 *   define( 'SHIFA_AV_BOOKING_BASE', 'https://booking.shifaworks.com' );
 *   define( 'SHIFA_AV_FALLBACK_URL', 'https://booking.shifaworks.com' );
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Shifa_Availability_Settings {

	const OPTION = 'shifa_availability_settings';
	const GROUP  = 'shifa_availability';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	public static function defaults() {
		return array(
			'enabled'        => 1,
			'api_base'       => 'https://api.shifaworks.com/api/v1',
			'booking_base'   => 'https://booking.shifaworks.com',
			'fallback_url'   => 'https://booking.shifaworks.com',
			'fallback_label' => 'Book Appointment',
		);
	}

	/** Saved settings merged over the defaults, with wp-config constants taking precedence. */
	public static function get() {
		$saved = get_option( self::OPTION, array() );
		$s     = wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );

		$constants = array(
			'api_base'     => 'SHIFA_AV_API_BASE',
			'booking_base' => 'SHIFA_AV_BOOKING_BASE',
			'fallback_url' => 'SHIFA_AV_FALLBACK_URL',
		);
		foreach ( $constants as $key => $constant ) {
			if ( defined( $constant ) && constant( $constant ) ) {
				$s[ $key ] = constant( $constant );
			}
		}
		$s['api_base']     = untrailingslashit( (string) $s['api_base'] );
		$s['booking_base'] = untrailingslashit( (string) $s['booking_base'] );
		return $s;
	}

	public static function add_page() {
		add_options_page(
			'ShifaWorks Availability',
			'ShifaWorks Availability',
			'manage_options',
			self::GROUP,
			array( __CLASS__, 'render_page' )
		);
	}

	public static function register() {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
			)
		);
	}

	/** Only https URLs (http is tolerated for localhost / .test / .local development hosts). */
	private static function clean_url( $value, $fallback ) {
		$url = esc_url_raw( trim( (string) $value ), array( 'https', 'http' ) );
		if ( '' === $url ) {
			return $fallback;
		}
		$parts = wp_parse_url( $url );
		$host  = isset( $parts['host'] ) ? $parts['host'] : '';
		$local = 'localhost' === $host || preg_match( '/\.(test|local|localhost)$/', $host );
		if ( isset( $parts['scheme'] ) && 'http' === $parts['scheme'] && ! $local ) {
			return $fallback;
		}
		return untrailingslashit( $url );
	}

	public static function sanitize( $input ) {
		$d     = self::defaults();
		$input = is_array( $input ) ? $input : array();
		$label = isset( $input['fallback_label'] ) ? sanitize_text_field( $input['fallback_label'] ) : '';
		return array(
			'enabled'        => empty( $input['enabled'] ) ? 0 : 1,
			'api_base'       => self::clean_url( isset( $input['api_base'] ) ? $input['api_base'] : '', $d['api_base'] ),
			'booking_base'   => self::clean_url( isset( $input['booking_base'] ) ? $input['booking_base'] : '', $d['booking_base'] ),
			'fallback_url'   => self::clean_url( isset( $input['fallback_url'] ) ? $input['fallback_url'] : '', $d['fallback_url'] ),
			'fallback_label' => '' !== $label ? $label : $d['fallback_label'],
		);
	}

	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$s = self::get();
		$o = self::OPTION;
		?>
		<div class="wrap">
			<h1>ShifaWorks Availability</h1>
			<p>Shows each team member's live availability from the booking system. Availability is never stored in WordPress. Only the public addresses below are needed.</p>
			<form method="post" action="options.php">
				<?php settings_fields( self::GROUP ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">Calendar</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( $o ); ?>[enabled]" value="1" <?php checked( $s['enabled'], 1 ); ?>> Show the availability calendar</label>
						<p class="description">Untick to switch the calendar off everywhere. Profile pages then show only the booking button.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="shifa-api">Booking API address</label></th>
						<td><input id="shifa-api" class="regular-text" type="url" name="<?php echo esc_attr( $o ); ?>[api_base]" value="<?php echo esc_attr( $s['api_base'] ); ?>">
						<p class="description">Example: https://api.shifaworks.com/api/v1. Its server must list this website in PUBLIC_CORS_ORIGINS.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="shifa-booking">Booking website</label></th>
						<td><input id="shifa-booking" class="regular-text" type="url" name="<?php echo esc_attr( $o ); ?>[booking_base]" value="<?php echo esc_attr( $s['booking_base'] ); ?>">
						<p class="description">Where the chosen time is sent, e.g. https://booking.shifaworks.com</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="shifa-fb">Fallback button link</label></th>
						<td><input id="shifa-fb" class="regular-text" type="url" name="<?php echo esc_attr( $o ); ?>[fallback_url]" value="<?php echo esc_attr( $s['fallback_url'] ); ?>">
						<p class="description">Shown instead of the calendar when a page isn't linked to a provider, or the calendar can't load.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="shifa-fbl">Fallback button text</label></th>
						<td><input id="shifa-fbl" class="regular-text" type="text" name="<?php echo esc_attr( $o ); ?>[fallback_label]" value="<?php echo esc_attr( $s['fallback_label'] ); ?>"></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
