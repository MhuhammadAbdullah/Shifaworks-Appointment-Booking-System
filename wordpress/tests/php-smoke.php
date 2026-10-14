<?php
/**
 * Runs the plugin's PHP against minimal stand-ins for the WordPress functions it calls.
 *
 *   php wordpress/tests/php-smoke.php
 *
 * This checks the plugin's own logic (sanitising, the shortcode's output for every mapping state, the
 * administrator-only diagnostics, the duplicate check). It is NOT WordPress: hooks never fire, nonces are
 * faked, and Elementor is absent. Real behaviour is covered by the staging checklist.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );

// ---- test state -------------------------------------------------------------------------------
$GLOBALS['t'] = array(
	'options'    => array(),
	'transients' => array(),
	'meta'       => array(), // post_id => [key => value]
	'posts'      => array(), // post_id => ['title' => ..]
	'is_admin'   => false,
	'post_id'    => 10,
	'api'        => array(), // slug => ['code' => int, 'body' => array] | WP_Error
	'api_calls'  => array(),
	'enqueued'   => array(),
);

class WP_Error {
	private $m;
	public function __construct( $code = '', $m = '' ) { $this->m = $m; }
	public function get_error_message() { return $this->m; }
}

// ---- WordPress stand-ins ----------------------------------------------------------------------
function add_action() {}
function add_filter() {}
function add_shortcode() {}
function add_options_page() {}
function add_meta_box() {}
function register_setting() {}
function register_post_meta() {}
function apply_filters( $tag, $value ) { return $value; }
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function plugin_dir_url( $f ) { return 'https://wp.test/wp-content/plugins/shifa-availability/'; }
function wp_register_style() {}
function wp_register_script() {}
function wp_enqueue_style( $h ) { $GLOBALS['t']['enqueued'][] = 'style:' . $h; }
function wp_enqueue_script( $h ) { $GLOBALS['t']['enqueued'][] = 'script:' . $h; }
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['t']['options'] ) ? $GLOBALS['t']['options'][ $k ] : $d; }
function wp_parse_args( $a, $d ) { return array_merge( $d, $a ); }
function shortcode_atts( $pairs, $atts ) { return array_merge( $pairs, array_intersect_key( (array) $atts, $pairs ) ); }
function untrailingslashit( $s ) { return rtrim( $s, '/\\' ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_url( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_url_raw( $s, $protocols = null ) {
	$s = trim( (string) $s );
	$scheme = parse_url( $s, PHP_URL_SCHEME );
	$allowed = $protocols ? $protocols : array( 'https', 'http' );
	return ( $scheme && in_array( $scheme, $allowed, true ) ) ? $s : '';
}
function wp_parse_url( $u, $component = -1 ) { return parse_url( $u, $component ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function wp_unslash( $s ) { return $s; }
function current_user_can( $cap ) { return (bool) $GLOBALS['t']['is_admin']; }
function get_the_ID() { return $GLOBALS['t']['post_id']; }
function get_queried_object_id() { return $GLOBALS['t']['post_id']; }
function get_post_meta( $id, $k ) { return isset( $GLOBALS['t']['meta'][ $id ][ $k ] ) ? $GLOBALS['t']['meta'][ $id ][ $k ] : ''; }
function update_post_meta( $id, $k, $v ) { $GLOBALS['t']['meta'][ $id ][ $k ] = $v; }
function delete_post_meta( $id, $k ) { unset( $GLOBALS['t']['meta'][ $id ][ $k ] ); }
function get_posts( $args ) {
	$out = array();
	foreach ( $GLOBALS['t']['meta'] as $id => $m ) {
		if ( in_array( $id, (array) $args['post__not_in'], true ) ) { continue; }
		if ( isset( $m[ $args['meta_key'] ] ) && $m[ $args['meta_key'] ] === $args['meta_value'] ) { $out[] = $id; }
	}
	return $out;
}
function get_transient( $k ) { return isset( $GLOBALS['t']['transients'][ $k ] ) ? $GLOBALS['t']['transients'][ $k ] : false; }
function set_transient( $k, $v ) { $GLOBALS['t']['transients'][ $k ] = $v; return true; }
function delete_transient( $k ) { unset( $GLOBALS['t']['transients'][ $k ] ); return true; }
function get_current_user_id() { return 1; }
function wp_is_post_revision() { return false; }
function wp_verify_nonce() { return true; }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function wp_safe_remote_get( $url ) {
	$GLOBALS['t']['api_calls'][] = $url;
	$slug = rawurldecode( basename( parse_url( $url, PHP_URL_PATH ) ) );
	return isset( $GLOBALS['t']['api'][ $slug ] ) ? $GLOBALS['t']['api'][ $slug ] : array( 'code' => 404, 'body' => array( 'success' => false ) );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return json_encode( $r['body'] ); }

// ---- load the plugin --------------------------------------------------------------------------
$root = dirname( __DIR__ ) . '/shifa-availability/';
foreach ( array( 'includes/class-settings.php', 'includes/class-api.php', 'includes/class-mapping.php', 'includes/class-shortcode.php' ) as $f ) {
	require $root . $f;
}
define( 'SHIFA_AV_URL', 'https://wp.test/wp-content/plugins/shifa-availability/' );
define( 'SHIFA_AV_VERSION', 'test' );

// ---- tiny assertion helpers -------------------------------------------------------------------
$failures = 0;
function check( $name, $cond, $detail = '' ) {
	global $failures;
	echo ( $cond ? 'PASS' : 'FAIL' ) . "  $name" . ( $cond ? '' : "  $detail" ) . "\n";
	if ( ! $cond ) { $failures++; }
}
function reset_state() {
	$t = &$GLOBALS['t'];
	$t['transients'] = array(); $t['meta'] = array(); $t['api'] = array(); $t['api_calls'] = array();
	$t['enqueued'] = array(); $t['is_admin'] = false; $t['post_id'] = 10; $t['options'] = array();
}
function ok_profile( $services = null ) {
	if ( null === $services ) { $services = array( array( 'slug' => 'hijama-therapy', 'name' => 'Hijama', 'packages' => array( array( 'id' => 'p1' ) ) ) ); }
	return array( 'code' => 200, 'body' => array( 'success' => true, 'data' => array( 'id' => 'u', 'slug' => 'dr-one', 'displayName' => 'Dr <One>', 'services' => $services ) ) );
}
function is_fallback_only( $html ) {
	return false !== strpos( $html, 'shifa-av__button' ) && false === strpos( $html, 'data-shifa-av' ) && false === strpos( $html, 'shifa-av__admin' );
}

// ---- slug cleaning ----------------------------------------------------------------------------
check( 'clean_slug lowercases and trims', 'dr-one' === Shifa_Availability_Mapping::clean_slug( '  Dr-One ' ) );
check( 'clean_slug replaces unsafe characters', 'a-b-c' === Shifa_Availability_Mapping::clean_slug( 'a b_c' ) );
check( 'clean_slug collapses repeated hyphens and trims them', 'a-b' === Shifa_Availability_Mapping::clean_slug( '--a---b--' ) );
check( 'clean_slug strips markup characters', 'script-alert-1-script' === Shifa_Availability_Mapping::clean_slug( '<script>alert(1)</script>' ) );
check( 'clean_slug takes the provider from a pasted booking link', 'zahra-nayyer' === Shifa_Availability_Mapping::clean_slug( 'https://bookings-shifaworks.vercel.app/clinical-counseling?provider=zahra-nayyer' ) );
check( 'clean_slug takes the provider from a link with other parameters', 'dr-one' === Shifa_Availability_Mapping::clean_slug( 'https://x.test/hijama-therapy?package=p1&provider=Dr-One&start=2030-01-01T04:00:00Z' ) );
check( 'clean_slug of a link without a provider is empty', '' === Shifa_Availability_Mapping::clean_slug( 'https://x.test/clinical-counseling' ) );
check( 'clean_slug of nothing is empty', '' === Shifa_Availability_Mapping::clean_slug( '' ) );

// ---- settings ---------------------------------------------------------------------------------
reset_state();
$s = Shifa_Availability_Settings::sanitize( array( 'enabled' => '1', 'api_base' => 'https://api.example.com/api/v1/', 'booking_base' => 'http://evil.example.com', 'fallback_url' => 'javascript:alert(1)', 'fallback_label' => '<b>Book</b> now' ) );
check( 'settings keep https URLs and drop the trailing slash', 'https://api.example.com/api/v1' === $s['api_base'] );
check( 'settings refuse plain http on a public host (default instead)', 'https://booking.shifaworks.com' === $s['booking_base'] );
check( 'settings refuse non-http schemes', 'https://booking.shifaworks.com' === $s['fallback_url'] );
check( 'settings strip markup from the button text', 'Book now' === $s['fallback_label'] );
$s = Shifa_Availability_Settings::sanitize( array( 'api_base' => 'http://localhost:4000/api/v1' ) );
check( 'settings allow http for localhost development', 'http://localhost:4000/api/v1' === $s['api_base'] );
check( 'settings untick means disabled', 0 === $s['enabled'] );

// ---- shortcode: every mapping state -----------------------------------------------------------
reset_state();
$GLOBALS['t']['options'][ Shifa_Availability_Settings::OPTION ] = array( 'enabled' => 0 );
$html = Shifa_Availability_Shortcode::render( array() );
check( 'plugin disabled -> button only, style but no script, no API call', is_fallback_only( $html ) && array( 'style:shifa-availability' ) === $GLOBALS['t']['enqueued'] && ! $GLOBALS['t']['api_calls'] );

reset_state();
$html = Shifa_Availability_Shortcode::render( array() );
check( 'page not linked, visitor -> button only, styled, no script', is_fallback_only( $html ) && array( 'style:shifa-availability' ) === $GLOBALS['t']['enqueued'] );
$GLOBALS['t']['is_admin'] = true;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'page not linked, admin -> also sees a note', false !== strpos( $html, 'shifa-av__admin' ) && false !== strpos( $html, 'shifa-av__button' ) );

reset_state();
$GLOBALS['t']['meta'][10]['shifa_provider_slug'] = 'dr-one';
$GLOBALS['t']['api']['dr-one'] = ok_profile();
$html = Shifa_Availability_Shortcode::render( array() );
check( 'linked, visitor -> calendar container with the right data', false !== strpos( $html, 'data-shifa-av' ) && false !== strpos( $html, 'data-provider="dr-one"' ) && false !== strpos( $html, 'data-booking="https://booking.shifaworks.com"' ) );
check( 'linked, visitor -> button already inside the container (shown if JS fails)', false !== strpos( $html, 'shifa-av__fallback' ) );
check( 'linked, visitor -> no admin note and NO server-side API call', false === strpos( $html, 'shifa-av__admin' ) && ! $GLOBALS['t']['api_calls'] );
check( 'linked -> script and style are enqueued', array( 'style:shifa-availability', 'script:shifa-availability' ) === $GLOBALS['t']['enqueued'] );

$html = Shifa_Availability_Shortcode::render( array( 'provider' => 'Other-One' ) );
check( 'provider attribute overrides the page field and is cleaned', false !== strpos( $html, 'data-provider="other-one"' ) );

$GLOBALS['t']['is_admin'] = true;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'linked and valid, admin -> no warning', false === strpos( $html, 'shifa-av__admin' ) && 1 === count( $GLOBALS['t']['api_calls'] ) );

reset_state();
$GLOBALS['t']['meta'][10]['shifa_provider_slug'] = 'ghost';
$GLOBALS['t']['is_admin'] = true;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'unknown slug, admin -> note naming the slug', false !== strpos( $html, 'shifa-av__admin' ) && false !== strpos( $html, 'ghost' ) );
$GLOBALS['t']['is_admin'] = false;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'unknown slug, visitor -> no diagnostics anywhere in the markup', false === strpos( $html, 'shifa-av__admin' ) && false === strpos( $html, 'not found' ) );

reset_state();
$GLOBALS['t']['meta'][10]['shifa_provider_slug'] = 'down';
$GLOBALS['t']['api']['down'] = new WP_Error( 'http', 'cURL error 28: timeout' );
$GLOBALS['t']['is_admin'] = true;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'API error, admin -> sees the error', false !== strpos( $html, 'cURL error 28' ) );
$GLOBALS['t']['is_admin'] = false;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'API error, visitor -> never sees the error text', false === strpos( $html, 'cURL' ) && false !== strpos( $html, 'shifa-av__button' ) );

reset_state();
$GLOBALS['t']['meta'][10]['shifa_provider_slug'] = 'empty';
$GLOBALS['t']['api']['empty'] = ok_profile( array() );
$GLOBALS['t']['is_admin'] = true;
$html = Shifa_Availability_Shortcode::render( array() );
check( 'provider without bookable services, admin -> told why', false !== strpos( $html, 'no bookable services' ) );

// ---- API lookup caching and statuses ----------------------------------------------------------
reset_state();
$GLOBALS['t']['api']['dr-one'] = ok_profile();
Shifa_Availability_Api::lookup( 'dr-one' );
Shifa_Availability_Api::lookup( 'dr-one' );
check( 'a successful lookup is cached (one request for two calls)', 1 === count( $GLOBALS['t']['api_calls'] ) );
check( 'lookup URL targets the public team endpoint', false !== strpos( $GLOBALS['t']['api_calls'][0], '/public/team/dr-one' ) );
$GLOBALS['t']['api']['bad'] = array( 'code' => 500, 'body' => array() );
$r = Shifa_Availability_Api::lookup( 'bad' );
Shifa_Availability_Api::lookup( 'bad' );
check( 'a 5xx is reported as an error and not cached', 'error' === $r['status'] && 2 === count( array_filter( $GLOBALS['t']['api_calls'], function ( $u ) { return false !== strpos( $u, '/bad' ); } ) ) );
$GLOBALS['t']['api']['ghost'] = array( 'code' => 404, 'body' => array( 'success' => false, 'message' => 'Provider not found', 'code' => 'NOT_FOUND' ) );
check( 'API "Provider not found" 404 means no such provider', 'not_found' === Shifa_Availability_Api::lookup( 'ghost' )['status'] );
$GLOBALS['t']['api']['oldapi'] = array( 'code' => 404, 'body' => array( 'success' => false, 'message' => 'Route GET /api/v1/public/team/oldapi not found', 'code' => 'NOT_FOUND' ) );
$r = Shifa_Availability_Api::lookup( 'oldapi' );
check( 'a route-not-found 404 is reported as an API problem, not a bad address', 'error' === $r['status'] && false !== strpos( $r['message'], 'Booking API address' ) );
check( 'an empty slug is not_found without any request', 'not_found' === Shifa_Availability_Api::lookup( '' )['status'] );

// ---- duplicate mapping ------------------------------------------------------------------------
reset_state();
$GLOBALS['t']['meta'][10]['shifa_provider_slug'] = 'dr-one';
$GLOBALS['t']['meta'][11]['shifa_provider_slug'] = 'dr-one';
$GLOBALS['t']['meta'][12]['shifa_provider_slug'] = 'dr-two';
check( 'duplicate detection finds the other page using the slug', array( 11 ) === Shifa_Availability_Mapping::others_with_slug( 'dr-one', 10 ) );
check( 'no duplicate for a unique slug', array() === Shifa_Availability_Mapping::others_with_slug( 'dr-two', 12 ) );

echo $failures ? "\n$failures check(s) failed\n" : "\nall checks passed\n";
exit( $failures ? 1 : 0 );
