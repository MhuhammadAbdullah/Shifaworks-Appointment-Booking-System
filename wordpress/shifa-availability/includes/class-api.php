<?php
/**
 * Server-side lookup of a provider by slug. Used only for administrator diagnostics (the mapping
 * box and the warning shown to logged-in admins). Visitors never trigger it: their browser talks
 * to the booking API directly, so WordPress adds no load or delay to public page views.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Shifa_Availability_Api {

	const TRANSIENT_PREFIX = 'shifa_av_p_';

	private static function key( $slug ) {
		return self::TRANSIENT_PREFIX . md5( Shifa_Availability_Settings::get()['api_base'] . '|' . $slug );
	}

	public static function forget( $slug ) {
		delete_transient( self::key( $slug ) );
	}

	/**
	 * @return array{status:string, profile?:array, message?:string}
	 *   status: 'ok' | 'not_found' | 'error'
	 */
	public static function lookup( $slug ) {
		$slug = (string) $slug;
		if ( '' === $slug ) {
			return array( 'status' => 'not_found' );
		}
		$cached = get_transient( self::key( $slug ) );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$base     = Shifa_Availability_Settings::get()['api_base'];
		$response = wp_safe_remote_get(
			$base . '/public/team/' . rawurlencode( $slug ),
			array(
				'timeout' => 5,
				'headers' => array( 'Accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'status'  => 'error',
				'message' => $response->get_error_message(),
			);
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 === $code && is_array( $body ) && ! empty( $body['success'] ) && isset( $body['data'] ) ) {
			$result = array(
				'status'  => 'ok',
				'profile' => $body['data'],
			);
			set_transient( self::key( $slug ), $result, 5 * MINUTE_IN_SECONDS );
			return $result;
		}
		$message = ( is_array( $body ) && isset( $body['message'] ) && is_string( $body['message'] ) ) ? $body['message'] : '';
		// Only the API's own "Provider not found" means this address has no active provider. Any other 404
		// ("Route GET ... not found", an HTML page) means the address of the API itself is wrong, or the API
		// has not been updated with the calendar endpoint yet - say that instead of blaming the address.
		if ( 422 === $code || ( 404 === $code && 'Provider not found' === $message ) ) {
			$result = array( 'status' => 'not_found' );
			set_transient( self::key( $slug ), $result, MINUTE_IN_SECONDS );
			return $result;
		}
		if ( 404 === $code ) {
			return array(
				'status'  => 'error',
				'message' => 'The booking API answered 404 but not as a provider lookup. Check the Booking API address in Settings > ShifaWorks Availability, and that the API has been updated with the calendar feature.',
			);
		}
		// 429, 5xx or an unexpected body: report it, but don't cache a transient failure.
		return array(
			'status'  => 'error',
			'message' => 'The booking API answered with HTTP ' . (int) $code . '.',
		);
	}
}
