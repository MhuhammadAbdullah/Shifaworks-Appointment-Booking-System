/*
 * ShifaWorks availability calendar. Vanilla JS, no dependencies, no secrets.
 *
 * Reads the public booking API directly from the visitor's browser:
 *   GET {api}/public/team/{slug}                      provider card, open services, packages
 *   GET {api}/public/availability/dates               dates with at least one free slot
 *   GET {api}/public/availability/slots               free start times for one date
 * and sends the visitor to {booking}/{service}?provider=&package=&start= when they pick a time.
 *
 * Nothing is shown as available until a service and a package are chosen (the package sets the
 * session length, which decides which times exist). Anything that goes wrong leaves the plain
 * booking button that the server rendered. All text from the API is inserted with textContent.
 */
(function () {
	'use strict';

	var WINDOW_DAYS = 61; // the API allows < 62 days per dates request
	var REFRESH_MS = 60 * 1000;
	var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	function clear(node) {
		while (node.firstChild) node.removeChild(node.firstChild);
	}

	/** YYYY-MM-DD for an instant in an IANA zone. */
	function localDate(date, zone) {
		var parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
		return parts;
	}

	function addDays(iso, n) {
		var d = new Date(iso + 'T00:00:00Z');
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}

	function mondayFirst(iso) {
		return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
	}

	function monthLabel(iso) {
		return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'));
	}

	function dayLabel(iso) {
		return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T00:00:00Z'));
	}

	function time12(hhmm) {
		var p = hhmm.split(':');
		var h = Number(p[0]) || 0;
		var m = p[1] || '00';
		return (h % 12 || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
	}

	function zoneLabel(zone) {
		try {
			var abbr = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' })
				.formatToParts(new Date())
				.filter(function (p) { return p.type === 'timeZoneName'; })[0];
			return zone.replace(/_/g, ' ') + (abbr ? ' (' + abbr.value + ')' : '');
		} catch (e) {
			return zone;
		}
	}

	function Calendar(root) {
		this.root = root;
		this.slug = root.getAttribute('data-provider');
		this.api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
		this.booking = (root.getAttribute('data-booking') || '').replace(/\/+$/, '');
		this.profile = null;
		this.service = null; // selected service object
		this.pkg = null; // selected package object
		this.from = null;
		this.to = null;
		this.viewMonth = null;
		this.dates = null; // { dates:Set, closed:Set, timezone }
		this.date = null;
		this.slots = null;
		this.loadingDates = false;
		this.loadingSlots = false;
		this.error = '';
		this.datesAbort = null;
		this.slotsAbort = null;
		this.timer = null;
	}

	Calendar.prototype.request = function (path, query, signal) {
		var qs = Object.keys(query || {})
			.filter(function (k) { return query[k] !== undefined && query[k] !== null; })
			.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); })
			.join('&');
		return fetch(this.api + path + (qs ? '?' + qs : ''), { headers: { Accept: 'application/json' }, signal: signal, credentials: 'omit' }).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (body) {
				if (!res.ok || !body || body.success === false) {
					var err = new Error('request failed');
					err.status = res.status;
					throw err;
				}
				return body.data;
			});
		});
	};

	Calendar.prototype.start = function () {
		var self = this;
		if (!this.slug || !this.api || !this.booking || typeof fetch !== 'function') return;
		this.request('/public/team/' + encodeURIComponent(this.slug), {}).then(
			function (profile) {
				if (!profile || !profile.services || !profile.services.length) return; // keep the booking button
				self.profile = profile;
				self.zone = profile.timezone || 'UTC';
				self.from = localDate(new Date(), self.zone);
				self.to = addDays(self.from, WINDOW_DAYS);
				self.viewMonth = self.from.slice(0, 7) + '-01';
				if (profile.services.length === 1) self.service = profile.services[0];
				if (self.service && self.service.packages.length === 1) self.pkg = self.service.packages[0];
				self.mount();
				self.onSelectionChange();
				document.addEventListener('visibilitychange', function () {
					if (!document.hidden) self.refresh();
				});
				self.timer = window.setInterval(function () {
					if (!document.hidden) self.refresh();
				}, REFRESH_MS);
			},
			function () { /* unknown/inactive provider, network error or rate limit: the booking button stays */ }
		);
	};

	/** Replace the server-rendered button with the calendar shell (kept: any administrator notice). */
	Calendar.prototype.mount = function () {
		var fallback = this.root.querySelector('.shifa-av__fallback');
		if (fallback) fallback.parentNode.removeChild(fallback);
		this.body = el('div', 'shifa-av__body');
		this.root.appendChild(this.body);
		this.render();
	};

	Calendar.prototype.onSelectionChange = function () {
		this.dates = null;
		this.date = null;
		this.slots = null;
		this.error = '';
		if (this.slotsAbort) this.slotsAbort.abort();
		if (this.datesAbort) this.datesAbort.abort();
		if (this.service && this.pkg) this.loadDates();
		this.render();
	};

	Calendar.prototype.query = function () {
		return { service: this.service.slug, provider: this.profile.id, package: this.pkg.id };
	};

	Calendar.prototype.loadDates = function () {
		var self = this;
		var sel = this.pkg;
		if (this.datesAbort) this.datesAbort.abort();
		this.datesAbort = typeof AbortController === 'function' ? new AbortController() : null;
		this.loadingDates = true;
		var q = this.query();
		q.from = this.from;
		q.to = this.to;
		this.request('/public/availability/dates', q, this.datesAbort ? this.datesAbort.signal : undefined).then(
			function (data) {
				if (sel !== self.pkg) return;
				self.loadingDates = false;
				self.error = '';
				self.zone = data.timezone || self.zone;
				self.dates = { dates: new Set(data.dates || []), closed: new Set(data.closedDates || []) };
				// The day being looked at may have just filled up.
				if (self.date && !self.dates.dates.has(self.date)) {
					self.date = null;
					self.slots = null;
				} else if (self.date) {
					self.loadSlots();
				}
				self.render();
			},
			function (err) {
				if (err && err.name === 'AbortError') return;
				if (sel !== self.pkg) return;
				self.loadingDates = false;
				self.error = err && err.status === 429 ? 'Too many requests. Please try again in a minute.' : "Availability can't be shown right now. Please try again shortly.";
				self.render();
			}
		);
	};

	Calendar.prototype.loadSlots = function () {
		var self = this;
		var date = this.date;
		var sel = this.pkg;
		if (this.slotsAbort) this.slotsAbort.abort();
		this.slotsAbort = typeof AbortController === 'function' ? new AbortController() : null;
		this.loadingSlots = true;
		var q = this.query();
		q.date = date;
		this.request('/public/availability/slots', q, this.slotsAbort ? this.slotsAbort.signal : undefined).then(
			function (data) {
				if (date !== self.date || sel !== self.pkg) return;
				self.loadingSlots = false;
				self.slots = data.slots || [];
				self.render();
			},
			function (err) {
				if (err && err.name === 'AbortError') return;
				if (date !== self.date || sel !== self.pkg) return;
				self.loadingSlots = false;
				self.slots = null;
				self.error = err && err.status === 429 ? 'Too many requests. Please try again in a minute.' : "Times can't be shown right now. Please try again shortly.";
				self.render();
			}
		);
	};

	/** Re-read availability so a slot taken minutes ago disappears without a page reload. */
	Calendar.prototype.refresh = function () {
		if (this.service && this.pkg && !this.loadingDates) this.loadDates();
	};

	Calendar.prototype.go = function (startsAt) {
		var url =
			this.booking + '/' + encodeURIComponent(this.service.slug) +
			'?provider=' + encodeURIComponent(this.profile.slug) +
			'&package=' + encodeURIComponent(this.pkg.id) +
			'&start=' + encodeURIComponent(startsAt);
		window.location.href = url;
	};

	Calendar.prototype.render = function () {
		var self = this;
		var p = this.profile;
		clear(this.body);

		var genderNote = null;
		if (p.acceptsMale && !p.acceptsFemale) genderNote = 'Sessions with ' + p.displayName + ' are for male clients.';
		if (!p.acceptsMale && p.acceptsFemale) genderNote = 'Sessions with ' + p.displayName + ' are for female clients.';

		this.body.appendChild(el('h3', 'shifa-av__title', 'Book with ' + p.displayName));
		if (genderNote) this.body.appendChild(el('p', 'shifa-av__note', genderNote));

		// 1. service and package
		var pickers = el('div', 'shifa-av__pickers');
		if (p.services.length > 1) {
			pickers.appendChild(this.select('Service', p.services, this.service, function (item) {
				self.service = item;
				self.pkg = item.packages.length === 1 ? item.packages[0] : null;
				self.onSelectionChange();
			}, 'Choose a service'));
		}
		if (this.service && this.service.packages.length > 1) {
			pickers.appendChild(this.select('Session', this.service.packages, this.pkg, function (item) {
				self.pkg = item;
				self.onSelectionChange();
			}, 'Choose a session', function (item) {
				return item.name + ' - ' + item.durationMinutes + ' min';
			}));
		}
		if (pickers.childNodes.length) this.body.appendChild(pickers);

		if (this.service && this.pkg && this.service.packages.length === 1 && p.services.length === 1) {
			this.body.appendChild(el('p', 'shifa-av__note', this.pkg.name + ' - ' + this.pkg.durationMinutes + ' min'));
		}

		// 2. nothing is offered until both are chosen
		if (!this.service || !this.pkg) {
			this.body.appendChild(el('p', 'shifa-av__hint', !this.service ? 'Choose a service to see available dates.' : 'Choose a session to see available dates.'));
			return;
		}

		if (this.error) {
			var err = el('p', 'shifa-av__error', this.error);
			err.setAttribute('role', 'alert');
			this.body.appendChild(err);
		}
		if (this.loadingDates && !this.dates) {
			this.body.appendChild(el('p', 'shifa-av__hint', 'Loading availability...'));
			return;
		}
		if (!this.dates) {
			this.body.appendChild(this.bookingLink());
			return;
		}
		if (this.dates.dates.size === 0) {
			this.body.appendChild(el('p', 'shifa-av__hint', 'No free times in the next two months.'));
			this.body.appendChild(this.bookingLink());
			return;
		}

		var layout = el('div', 'shifa-av__layout');
		layout.appendChild(this.calendarGrid());
		layout.appendChild(this.timesPanel());
		this.body.appendChild(layout);
		this.body.appendChild(el('p', 'shifa-av__zone', 'Times are shown in ' + zoneLabel(this.zone) + '.'));
	};

	Calendar.prototype.bookingLink = function () {
		var a = el('a', 'shifa-av__button', this.root.getAttribute('data-fallback-label') || 'Book Appointment');
		a.href = this.booking + '/' + encodeURIComponent(this.service.slug) + '?provider=' + encodeURIComponent(this.profile.slug) + '&package=' + encodeURIComponent(this.pkg.id);
		return a;
	};

	Calendar.prototype.select = function (label, items, current, onChange, placeholder, text) {
		var wrap = el('label', 'shifa-av__field');
		wrap.appendChild(el('span', 'shifa-av__label', label));
		var select = el('select', 'shifa-av__select');
		var ph = el('option', '', placeholder);
		ph.value = '';
		select.appendChild(ph);
		items.forEach(function (item, i) {
			var o = el('option', '', text ? text(item) : item.name);
			o.value = String(i);
			if (current === item) o.selected = true;
			select.appendChild(o);
		});
		select.addEventListener('change', function () {
			if (select.value === '') return;
			onChange(items[Number(select.value)]);
		});
		wrap.appendChild(select);
		return wrap;
	};

	Calendar.prototype.calendarGrid = function () {
		var self = this;
		var box = el('div', 'shifa-av__calendar');
		var head = el('div', 'shifa-av__month');
		var prev = el('button', 'shifa-av__nav', '‹');
		prev.type = 'button';
		prev.setAttribute('aria-label', 'Previous month');
		prev.disabled = this.viewMonth.slice(0, 7) <= this.from.slice(0, 7);
		prev.addEventListener('click', function () { self.shiftMonth(-1); });
		var next = el('button', 'shifa-av__nav', '›');
		next.type = 'button';
		next.setAttribute('aria-label', 'Next month');
		next.disabled = this.viewMonth.slice(0, 7) >= this.to.slice(0, 7);
		next.addEventListener('click', function () { self.shiftMonth(1); });
		head.appendChild(prev);
		head.appendChild(el('span', 'shifa-av__month-label', monthLabel(this.viewMonth)));
		head.appendChild(next);
		box.appendChild(head);

		var grid = el('div', 'shifa-av__grid');
		grid.setAttribute('role', 'group');
		grid.setAttribute('aria-label', 'Choose a date');
		WEEKDAYS.forEach(function (w) { grid.appendChild(el('span', 'shifa-av__weekday', w)); });
		var lead = mondayFirst(this.viewMonth);
		for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'shifa-av__blank'));
		var d = new Date(this.viewMonth + 'T00:00:00Z');
		var daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
		for (var n = 0; n < daysInMonth; n++) {
			var iso = addDays(this.viewMonth, n);
			var inWindow = iso >= this.from && iso <= this.to;
			var open = inWindow && this.dates.dates.has(iso);
			var full = inWindow && !open && !this.dates.closed.has(iso);
			var btn = el('button', 'shifa-av__day' + (open ? ' is-open' : '') + (full ? ' is-full' : '') + (this.date === iso ? ' is-active' : ''), String(n + 1));
			btn.type = 'button';
			btn.disabled = !open;
			btn.setAttribute('aria-pressed', this.date === iso ? 'true' : 'false');
			btn.setAttribute('aria-label', dayLabel(iso) + (open ? ', available' : full ? ', fully booked' : ', unavailable'));
			if (open) {
				(function (day) {
					btn.addEventListener('click', function () {
						self.date = day;
						self.slots = null;
						self.loadSlots();
						self.render();
					});
				})(iso);
			}
			grid.appendChild(btn);
		}
		box.appendChild(grid);
		return box;
	};

	Calendar.prototype.shiftMonth = function (delta) {
		var d = new Date(this.viewMonth + 'T00:00:00Z');
		d.setUTCMonth(d.getUTCMonth() + delta);
		this.viewMonth = d.toISOString().slice(0, 8) + '01';
		this.render();
	};

	Calendar.prototype.timesPanel = function () {
		var self = this;
		var panel = el('div', 'shifa-av__times');
		panel.setAttribute('aria-live', 'polite');
		if (!this.date) {
			panel.appendChild(el('p', 'shifa-av__hint', 'Pick a date to see available times.'));
			return panel;
		}
		panel.appendChild(el('p', 'shifa-av__times-title', dayLabel(this.date)));
		if (this.loadingSlots || !this.slots) {
			panel.appendChild(el('p', 'shifa-av__hint', this.error ? '' : 'Loading times...'));
			return panel;
		}
		if (!this.slots.length) {
			panel.appendChild(el('p', 'shifa-av__hint', 'No free times on this date.'));
			return panel;
		}
		var list = el('div', 'shifa-av__slots');
		this.slots.forEach(function (s) {
			var b = el('button', 'shifa-av__slot', time12(s.time));
			b.type = 'button';
			b.addEventListener('click', function () { self.go(s.startsAt); });
			list.appendChild(b);
		});
		panel.appendChild(list);
		return panel;
	};

	function init() {
		var roots = document.querySelectorAll('[data-shifa-av]');
		for (var i = 0; i < roots.length; i++) {
			if (roots[i].getAttribute('data-shifa-av-ready')) continue;
			roots[i].setAttribute('data-shifa-av-ready', '1');
			new Calendar(roots[i]).start();
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
	// Elementor can inject widgets after load (editor preview, popups).
	window.addEventListener('elementor/frontend/init', init);
})();
