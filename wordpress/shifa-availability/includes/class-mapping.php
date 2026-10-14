<?php
/**
 * Links a WordPress page to a provider in the booking system.
 *
 * The link is one custom field, `shifa_provider_slug`, holding the provider's address (slug) from the
 * booking dashboard. It is edited in the "Booking system provider" box on the page editor and
 * checked against the booking API there, so a typo is caught before the page goes live.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Shifa_Availability_Mapping {

	const META_KEY = 'shifa_provider_slug';
	const NONCE    = 'shifa_av_mapping';

	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_meta' ) );
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_box' ) );
		add_action( 'save_post', array( __CLASS__, 'save' ), 10, 2 );
		add_action( 'admin_notices', array( __CLASS__, 'show_notice' ) );
		add_filter( 'manage_pages_columns', array( __CLASS__, 'add_column' ) );
		add_action( 'manage_pages_custom_column', array( __CLASS__, 'render_column' ), 10, 2 );
	}

	/** Post types that can be linked to a provider. Pages by default; filterable. */
	public static function post_types() {
		return apply_filters( 'shifa_availability_post_types', array( 'page' ) );
	}

	/** Providers' addresses are lowercase letters, digits and single hyphens - the same shape the API accepts. */
	public static function clean_slug( $value ) {
		$value = trim( (string) $value );
		// A pasted booking link (".../clinical-counseling?provider=zahra-nayyer") is accepted: take its provider value.
		if ( preg_match( '#^https?://#i', $value ) ) {
			$query = (string) wp_parse_url( $value, PHP_URL_QUERY );
			parse_str( $query, $params );
			$value = ( isset( $params['provider'] ) && is_string( $params['provider'] ) ) ? $params['provider'] : '';
		}
		$value = strtolower( $value );
		$value = preg_replace( '/[^a-z0-9-]+/', '-', $value );
		$value = preg_replace( '/-{2,}/', '-', $value );
		return trim( $value, '-' );
	}

	public static function register_meta() {
		foreach ( self::post_types() as $type ) {
			register_post_meta(
				$type,
				self::META_KEY,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => array( __CLASS__, 'clean_slug' ),
					'auth_callback'     => function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', $post_id );
					},
				)
			);
		}
	}

	public static function get_slug( $post_id ) {
		return self::clean_slug( get_post_meta( $post_id, self::META_KEY, true ) );
	}

	/** Other posts that use the same slug (a duplicate mapping is almost always a copy-paste mistake). */
	public static function others_with_slug( $slug, $exclude_id ) {
		if ( '' === $slug ) {
			return array();
		}
		return get_posts(
			array(
				'post_type'      => self::post_types(),
				'post_status'    => array( 'publish', 'draft', 'pending', 'private', 'future' ),
				'meta_key'       => self::META_KEY,
				'meta_value'     => $slug,
				'post__not_in'   => array( (int) $exclude_id ),
				'posts_per_page' => 20,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);
	}

	public static function add_box() {
		foreach ( self::post_types() as $type ) {
			add_meta_box( 'shifa-av-mapping', 'Booking system provider', array( __CLASS__, 'render_box' ), $type, 'side', 'default' );
		}
	}

	public static function render_box( $post ) {
		wp_nonce_field( self::NONCE, self::NONCE . '_nonce' );
		$slug = self::get_slug( $post->ID );
		?>
		<p>
			<label for="shifa-av-slug"><strong>Provider address</strong></label><br>
			<input type="text" id="shifa-av-slug" name="shifa_provider_slug" class="widefat" value="<?php echo esc_attr( $slug ); ?>" placeholder="e.g. hk-hayyan-marfani" autocomplete="off">
		</p>
		<p class="description">Only the address, for example <code>zahra-nayyer</code>, not a whole link. Copy it from the provider's page in the booking dashboard (Website calendar card). Leave empty if this page is not a team member.</p>
		<?php
		if ( '' === $slug ) {
			echo '<p><em>Not linked. This page will show only the booking button.</em></p>';
			return;
		}
		$result = Shifa_Availability_Api::lookup( $slug );
		if ( 'ok' === $result['status'] ) {
			$profile  = $result['profile'];
			$services = array();
			foreach ( (array) ( isset( $profile['services'] ) ? $profile['services'] : array() ) as $service ) {
				$services[] = isset( $service['name'] ) ? $service['name'] : '';
			}
			printf(
				'<p style="color:#1a7f37"><strong>&#10003; Linked to %s</strong>%s</p>',
				esc_html( isset( $profile['displayName'] ) ? $profile['displayName'] : $slug ),
				$services ? '<br><span class="description">Bookable: ' . esc_html( implode( ', ', $services ) ) . '</span>' : '<br><span class="description" style="color:#b32d2e">No bookable services or packages yet, so visitors will see only the booking button.</span>'
			);
		} elseif ( 'not_found' === $result['status'] ) {
			echo '<p style="color:#b32d2e"><strong>&#10007; No active provider has this address.</strong><br><span class="description">Check the spelling, and that the provider is active in the booking dashboard. Visitors will see only the booking button.</span></p>';
		} else {
			printf( '<p style="color:#996800"><strong>Could not check right now.</strong><br><span class="description">%s</span></p>', esc_html( isset( $result['message'] ) ? $result['message'] : '' ) );
		}
		$dupes = self::others_with_slug( $slug, $post->ID );
		if ( $dupes ) {
			echo '<p style="color:#b32d2e"><strong>Also used by:</strong></p><ul style="margin-top:0">';
			foreach ( $dupes as $id ) {
				printf( '<li><a href="%s">%s</a></li>', esc_url( get_edit_post_link( $id ) ), esc_html( get_the_title( $id ) ? get_the_title( $id ) : '#' . $id ) );
			}
			echo '</ul>';
		}
	}

	public static function save( $post_id, $post ) {
		if ( ! in_array( $post->post_type, self::post_types(), true ) ) {
			return;
		}
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( wp_is_post_revision( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		$nonce = isset( $_POST[ self::NONCE . '_nonce' ] ) ? sanitize_text_field( wp_unslash( $_POST[ self::NONCE . '_nonce' ] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, self::NONCE ) ) {
			return;
		}
		$previous = self::get_slug( $post_id );
		$slug     = isset( $_POST['shifa_provider_slug'] ) ? self::clean_slug( wp_unslash( $_POST['shifa_provider_slug'] ) ) : '';

		if ( '' === $slug ) {
			delete_post_meta( $post_id, self::META_KEY );
		} else {
			update_post_meta( $post_id, self::META_KEY, $slug );
		}
		// Re-check against the API on the next view of the box, not against a cached answer for the old slug.
		Shifa_Availability_Api::forget( $slug );
		Shifa_Availability_Api::forget( $previous );

		if ( '' !== $slug && self::others_with_slug( $slug, $post_id ) ) {
			set_transient( 'shifa_av_dupe_' . get_current_user_id(), $slug, 60 );
		}
	}

	public static function show_notice() {
		$slug = get_transient( 'shifa_av_dupe_' . get_current_user_id() );
		if ( ! $slug ) {
			return;
		}
		delete_transient( 'shifa_av_dupe_' . get_current_user_id() );
		printf(
			'<div class="notice notice-warning is-dismissible"><p>The provider address <code>%s</code> is also used by another page. Each team member should have one profile page. Saved anyway.</p></div>',
			esc_html( $slug )
		);
	}

	public static function add_column( $columns ) {
		$columns['shifa_provider'] = 'Booking provider';
		return $columns;
	}

	public static function render_column( $column, $post_id ) {
		if ( 'shifa_provider' !== $column ) {
			return;
		}
		$slug = self::get_slug( $post_id );
		if ( '' === $slug ) {
			echo '&mdash;';
			return;
		}
		echo '<code>' . esc_html( $slug ) . '</code>';
		if ( self::others_with_slug( $slug, $post_id ) ) {
			echo ' <span style="color:#b32d2e" title="Another page uses the same address">&#9888; duplicate</span>';
		}
	}
}
