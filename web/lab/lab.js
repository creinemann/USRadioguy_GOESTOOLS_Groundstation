/*
 * USRadioguy Lab layout (Nov 2026)
 * A new front end for Vitality GOES. Reads the same data as the main site:
 *   ../dataHandler.php      product list, image lists, weather
 *   img.php                 resized copies of any image (fast loading)
 *   ../station_stats.php    live receiver stats (config/station.ini)
 *   lab-config.js           satellites/products on the Overview page
 *   ../videos/*.mp4         the 24-hour loops
 */
(function () {
'use strict';

// ------------------------------------------------------------------ setup
// Satellites and products shown on the Overview page come from lab-config.js;
// receivers come from config/station.ini (window.STATION, set by index.php).
var SATS = window.LAB_SATS || {};
var RECEIVERS = ((window.STATION && window.STATION.receivers) || []).map(function (r) { return { id: r.id, sat: r.sat, where: r.where }; });
var CREDIT = (window.STATION && window.STATION.credit) || '';

var API = {
	preload: '../dataHandler.php?type=preload',
	meta: function (id, sub) { return '../dataHandler.php?type=metadata&id=' + enc(id) + '&subid=' + enc(sub); },
	img: function (id, sub, w, t) { return 'img.php?id=' + enc(id) + '&subid=' + enc(sub) + '&w=' + w + (t ? '&t=' + t : ''); },
	orig: function (id, sub, t) { return '../dataHandler.php?type=data&id=' + enc(id) + '&subid=' + enc(sub) + (t ? '&timestamp=' + t : ''); },
	// ?b= changes after a space weather download, so the browser fetches new loops
	video: function (v) { var b = ''; try { b = localStorage.getItem('labVideoBust') || ''; } catch (e) {} return '../videos/' + encodeURIComponent(v) + (b ? '?b=' + b : ''); },
	weather: '../dataHandler.php?type=weatherJSON',
	stats: function (part, st) { return '../station_stats.php?part=' + part + (st ? '&st=' + st : ''); }
};

var main = document.getElementById('main');
var config = null;          // Vitality's product list (preload)
var timers = [];            // cleared on every page change
var state = { sat: Object.keys(SATS)[0] || '', product: 0 };

function enc(s) { return encodeURIComponent(s); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function getJSON(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
function every(ms, fn) { fn(); timers.push(setInterval(fn, ms)); }
function fmt(v, d) { return v == null || isNaN(v) ? '–' : Number(v).toFixed(d || 0); }
function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function item(id, sub) { return config && config.categories[id] && config.categories[id].data[sub]; }

var timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
var dayTimeFmt = new Intl.DateTimeFormat([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function ago(ts)
{
	var m = Math.round((Date.now() / 1000 - ts) / 60);
	if (m < 1) return 'just now';
	if (m < 60) return m + ' min ago';
	var h = Math.floor(m / 60);
	return h + (h == 1 ? ' hour' : ' hours') + ' ago';
}
function when(ts) { var d = new Date(ts * 1000); return (new Date().toDateString() == d.toDateString() ? timeFmt : dayTimeFmt).format(d); }

// ------------------------------------------------------------------ clocks
function tickClocks()
{
	var now = new Date();
	document.getElementById('clockUtc').textContent = now.toISOString().substr(11, 8);
	document.getElementById('clockLocal').textContent = timeFmt.format(now);
}
tickClocks(); setInterval(tickClocks, 1000);

// ------------------------------------------------------------------ the plate (Earth in a measurement ring)
function plateRing()
{
	var s = '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true">';
	s += '<circle class="r draw" cx="50" cy="50" r="46.5"/><circle class="r" cx="50" cy="50" r="49"/>';
	for (var a = 0; a < 360; a += 5)
	{
		var major = a % 30 == 0, r1 = 46.5, r2 = major ? 49 : 47.8;
		var rad = (a - 90) * Math.PI / 180;
		s += '<line class="tick' + (major ? ' major' : '') + '" x1="' + (50 + r1 * Math.cos(rad)).toFixed(2) + '" y1="' + (50 + r1 * Math.sin(rad)).toFixed(2) +
			'" x2="' + (50 + r2 * Math.cos(rad)).toFixed(2) + '" y2="' + (50 + r2 * Math.sin(rad)).toFixed(2) + '"/>';
		if (major && a % 90 != 0)
		{
			var tr = 51.6;
			s += '<text x="' + (50 + tr * Math.cos(rad)).toFixed(2) + '" y="' + (50 + tr * Math.sin(rad) + .8).toFixed(2) + '" text-anchor="middle">' + a + '°</text>';
		}
	}
	return s + '</svg>';
}

// a still image or a loop inside a frame; returns a small controller
function imageStage(frame, opts)
{
	var current = null, token = 0;
	function swap(node)
	{
		frame.appendChild(node);
		requestAnimationFrame(function () { node.classList.add('show'); });
		if (current && current !== node) { var old = current; setTimeout(function () { old.remove(); }, 550); }
		current = node;
		var l = frame.querySelector('.loading'); if (l) l.remove();
	}
	return {
		show: function (src, alt)
		{
			var my = ++token, img = new Image();
			img.alt = alt || ''; img.decoding = 'async';
			img.onload = function () { if (my == token) swap(img); };
			img.onerror = function () { if (my == token && !current) frame.insertAdjacentHTML('beforeend', '<span class="loading">No image available</span>'); };
			img.src = src;
		},
		play: function (src, onFail, controls)
		{
			var my = ++token, v = document.createElement('video');
			v.controls = !!controls;
			v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute('aria-label', '24-hour loop');
			v.oncanplay = function () { if (my == token) swap(v); };
			v.onerror = function () { if (my == token && onFail) onFail(); };
			v.src = src;
			v.play().catch(function () {});
		},
		isVideo: function () { return current && current.tagName == 'VIDEO'; }
	};
}

// a row of ticks you can scrub through; one tick per image
function timeline(container, frames, onPick)
{
	var idx = frames.length - 1;
	var first = frames[0], last = frames[frames.length - 1];
	container.innerHTML =
		'<div class="timeline-head"><span class="when"></span><span class="muted ago"></span></div>' +
		'<div class="track" tabindex="0" role="slider" aria-label="Image time" aria-valuemin="0" aria-valuemax="' + (frames.length - 1) + '">' +
			'<div class="ticks">' + frames.map(function () { return '<i></i>'; }).join('') + '</div>' +
		'</div>' +
		'<div class="track-hours muted" style="display:flex;justify-content:space-between;font-size:12px">' +
			'<span>' + esc(when(first.timestamp)) + '</span><span>' + frames.length + ' images</span><span>' + esc(when(last.timestamp)) + '</span></div>';
	var track = container.querySelector('.track'), ticks = track.querySelectorAll('i');
	function set(i, final)
	{
		idx = Math.max(0, Math.min(frames.length - 1, i));
		ticks.forEach(function (t, n) { t.classList.toggle('on', n == idx); });
		container.querySelector('.when').textContent = (idx == frames.length - 1 ? 'Latest, ' : '') + when(frames[idx].timestamp);
		container.querySelector('.ago').textContent = ago(frames[idx].timestamp);
		track.setAttribute('aria-valuenow', idx);
		track.setAttribute('aria-valuetext', when(frames[idx].timestamp));
		onPick(frames[idx], final);
	}
	function fromX(x) { var r = track.getBoundingClientRect(); return Math.round((x - r.left) / r.width * (frames.length - 1)); }
	var dragging = false;
	track.addEventListener('pointerdown', function (e) { dragging = true; track.setPointerCapture(e.pointerId); set(fromX(e.clientX), false); });
	track.addEventListener('pointermove', function (e) { if (dragging) { var i = fromX(e.clientX); if (i != idx) set(i, false); } });
	track.addEventListener('pointerup', function () { if (dragging) { dragging = false; set(idx, true); } });
	track.addEventListener('keydown', function (e)
	{
		var d = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[e.key];
		if (d != null) { e.preventDefault(); set(idx + d, true); }
	});
	set(idx, true);
	return { markLoaded: function (i) { if (ticks[i]) ticks[i].classList.add('loaded'); } };
}

// ------------------------------------------------------------------ OVERVIEW
function renderOverview()
{
	main.innerHTML =
	'<section class="hero">' +
		'<div class="hero-copy">' +
			'<h1 class="display" id="heroTitle"></h1>' +
			'<p class="lede" id="heroLede"></p>' +
			'<div class="seg" role="group" aria-label="Satellite">' +
				Object.keys(SATS).map(function (k) { return '<button type="button" data-sat="' + esc(k) + '">' + esc(SATS[k].tab || SATS[k].name) + '</button>'; }).join('') + '</div>' +
			'<div class="chips" role="group" aria-label="Product" id="heroChips"></div>' +
			'<div class="timeline" id="heroTimeline"></div>' +
			'<div class="hero-actions" id="heroActions"></div>' +
			'<p class="status-line" id="heroStatus"><span class="dot"></span><span>Checking the receiver…</span></p>' +
		'</div>' +
		'<figure class="plate intro" style="margin:0">' +
			'<div class="disk" id="heroDisk"><span class="loading">Loading the latest image…</span></div>' + plateRing() +
			'<figcaption class="annot tl" id="annotTl"></figcaption><div class="annot br" id="annotBr"></div>' +
		'</figure>' +
	'</section>' +
	'<div class="now">' +
		'<section aria-labelledby="nWx"><h2 class="h3" id="nWx">Weather now</h2><div id="nowWx"><p class="caption">Reading the latest observation…</p></div></section>' +
		'<section aria-labelledby="nRadar"><h2 class="h3" id="nRadar">Radar, last 24 hours</h2><div class="media" id="nowRadar"></div><p class="caption">Great Lakes composite, received over EMWIN.</p></section>' +
		'<section aria-labelledby="nRx"><h2 class="h3" id="nRx">Receivers</h2><div id="nowRx"></div><p class="caption"><a href="#/receivers">Signal details</a></p></section>' +
		'<section aria-labelledby="nSun"><h2 class="h3" id="nSun">The Sun</h2><div class="sun" id="nowSun"></div><p class="caption" id="nowSunCap"></p></section>' +
	'</div>';

	main.querySelectorAll('[data-sat]').forEach(function (b) {
		b.addEventListener('click', function () { state.sat = b.dataset.sat; state.product = 0; drawHero(); });
	});
	drawHero();
	nowWeather(); nowRadar(); nowSun();
	every(10000, nowReceivers);
}

var heroStage = null;
function drawHero()
{
	var sat = SATS[state.sat];
	if (!sat || !sat.products || !sat.products.length) { document.getElementById('heroTitle').textContent = 'No satellites set up yet'; document.getElementById('heroLede').textContent = 'Edit lab/lab-config.js to choose the satellites and products shown here.'; return; }
	var prod = sat.products[state.product], sub = prod[0], it = item('abi', sub) || {};
	main.querySelectorAll('[data-sat]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.sat == state.sat); });
	document.getElementById('heroTitle').textContent = 'Earth from ' + sat.lon;
	document.getElementById('heroLede').textContent = sat.name + ' watches ' + sat.region + ' from 35,786 km up. ' + (sat.via || CREDIT);
	var chips = document.getElementById('heroChips');
	chips.innerHTML = sat.products.map(function (p, i) { return '<button type="button" aria-pressed="' + (i == state.product) + '" data-i="' + i + '">' + esc(p[1]) + (/GeoFusion|himfus|himire/.test(p[0]) ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;background:#2e7d32;color:#fff;font-size:10px;font-weight:700;letter-spacing:.5px;vertical-align:middle">NEW</span>' : '') + '</button>'; }).join('');
	chips.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { state.product = +b.dataset.i; drawHero(); }); });

	var disk = document.getElementById('heroDisk');
	disk.innerHTML = '<span class="loading">Loading the latest image…</span>';
	heroStage = imageStage(disk);
	document.getElementById('annotTl').innerHTML = '<strong>' + esc(sat.name) + ', ' + esc(prod[1].toLowerCase()) + '</strong>Full disk, ' + esc(sat.inst || 'ABI instrument');
	document.getElementById('annotBr').innerHTML = '<strong>Sub-satellite point</strong>0.0° N, ' + esc(sat.lon);

	var actions = document.getElementById('heroActions');
	actions.innerHTML = '';
	if (it.videoPath)
	{
		var playing = false;
		var btn = el('<button type="button" class="btn"><svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg><span>Play the loop</span></button>');
		btn.addEventListener('click', function ()
		{
			if (!playing) { heroStage.play(API.video(it.videoPath), function () { btn.querySelector('span').textContent = 'Loop not ready yet'; }); btn.querySelector('span').textContent = 'Show still image'; }
			else { heroStage.show(API.img('abi', sub, 1600), prod[1]); btn.querySelector('span').textContent = 'Play the loop'; }
			playing = !playing;
		});
		actions.appendChild(btn);
	}
	actions.appendChild(el('<a class="btn ghost" href="#/imagery/abi/' + enc(sub) + '">Browse Recent Imagery</a>'));

	var tl = document.getElementById('heroTimeline');
	tl.innerHTML = '';
	getJSON(API.meta('abi', sub)).then(function (m)
	{
		var frames = (m.images || []).slice(-48);
		if (!frames.length) { disk.innerHTML = '<span class="loading">No images received yet today</span>'; return; }
		var pend = null;
		timeline(tl, frames, function (f, final)
		{
			clearTimeout(pend);
			pend = setTimeout(function () { heroStage.show(API.img('abi', sub, final ? 1600 : 960, f.timestamp), prod[1] + ', ' + when(f.timestamp)); }, final ? 0 : 60);
		});
	}).catch(function () { disk.innerHTML = '<span class="loading">This product is not available right now</span>'; });
	nowReceivers();
}

// weather words from the NWS observation codes
var WX = { SUNNY: 'Sunny', MOSUNNY: 'Mostly sunny', PTSUNNY: 'Partly sunny', CLEAR: 'Clear', MOCLEAR: 'Mostly clear', FAIR: 'Fair', PTCLDY: 'Partly cloudy', MOCLDY: 'Mostly cloudy', CLOUDY: 'Cloudy', FOG: 'Fog', HAZE: 'Haze', 'LGT RAIN': 'Light rain', RAIN: 'Rain', 'LGT SNOW': 'Light snow', SNOW: 'Snow', DRIZZLE: 'Drizzle', TSTORM: 'Thunderstorms', WINDY: 'Windy', FLURRIES: 'Flurries', 'FRZ RAIN': 'Freezing rain', 'N/A': 'Not reported' };
function wxWords(code) { code = String(code || '').trim(); return WX[code] || (code ? code.charAt(0) + code.slice(1).toLowerCase() : 'Not reported'); }
function pressure(p)
{
	var m = String(p || '').match(/^([\d.]+)([RFS])?/); if (!m) return '–';
	return m[1] + ' in' + ({ R: ', rising', F: ', falling', S: ', steady' }[m[2]] || '');
}
function dayName(d) { return String(d || '').split(',')[0] || '–'; }

function nowWeather()
{
	getJSON(API.weather).then(function (w)
	{
		var days = (w.sevenDayForcast || []).slice(0, 4);
		document.getElementById('nowWx').innerHTML =
			'<div class="reading">' + esc(w.temp || '–') + '<small>°F</small></div>' +
			'<p class="caption" style="margin:6px 0 0">' + esc(wxWords(w.weatherDesc)) + ', observed at ' + esc(titleCase(w.city)) + '</p>' +
			'<dl class="facts">' +
				'<dt>Wind</dt><dd>' + (w.wind ? esc(w.windDirection + ' ' + w.wind + ' mph') : 'Calm') + '</dd>' +
				'<dt>Humidity</dt><dd>' + esc(w.humidity || '–') + '%</dd>' +
				'<dt>Pressure</dt><dd>' + esc(pressure(w.pressure)) + '</dd>' +
			'</dl>' +
			'<div class="forecast-mini">' + days.map(function (d) {
				return '<div><b>' + esc(dayName(d.date).slice(0, 3)) + '</b>' + esc(d.maxTemp != null ? d.maxTemp + '°' : '') + ' <span>' + esc(d.minTemp != null ? d.minTemp + '°' : '') + '</span></div>';
			}).join('') + '</div>';
	}).catch(function () { document.getElementById('nowWx').innerHTML = '<p class="caption">The local observation is not available right now.</p>'; });
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

function nowRadar()
{
	var box = document.getElementById('nowRadar');
	var v = config && config.localRadarVideo;
	if (!v) { box.innerHTML = '<p class="empty">No radar loop configured</p>'; return; }
	box.innerHTML = '<video muted loop autoplay playsinline aria-label="Radar loop, last 24 hours"></video>';
	var vid = box.querySelector('video'); vid.src = API.video(v); vid.play().catch(function () {});
}

function sunItem()
{
	var s = config && config.categories.solar; if (!s) return null;
	var keys = Object.keys(s.data);
	var k = keys.indexOf('latestSDO193') > -1 ? 'latestSDO193' : keys[0];
	return k ? { sub: k, title: s.data[k].title } : null;
}
function nowSun()
{
	var s = sunItem(), box = document.getElementById('nowSun');
	if (!s) { box.remove(); return; }
	box.innerHTML = '<img alt="The Sun in extreme ultraviolet" src="' + API.img('solar', s.sub, 480) + '">';
	document.getElementById('nowSunCap').innerHTML = 'Extreme ultraviolet, 19.3 nm, from NASA’s Solar Dynamics Observatory. <a href="#/space">Space weather</a>';
}

function rxState(g)
{
	if (!g || !g.online) return { cls: 'bad', word: 'No signal' };
	if (g.locked) return { cls: 'ok', word: 'Locked' };
	return { cls: 'warn', word: 'Searching' };
}
function nowReceivers()
{
	var box = document.getElementById('nowRx');
	if (!box) return;
	Promise.all(RECEIVERS.map(function (r) { return getJSON(API.stats('goes', r.id)).catch(function () { return null; }); })).then(function (all)
	{
		if (!document.getElementById('nowRx')) return;
		box.innerHTML = '<table class="rx"><thead><tr><th>Satellite</th><th>Viterbi</th><th>Packets/s</th></tr></thead><tbody>' +
			RECEIVERS.map(function (r, i) {
				var g = all[i], st = rxState(g), d = (g && g.decoder) || {};
				return '<tr><td><div class="sat"><span class="dot ' + st.cls + '"></span><div>' + esc(r.sat) + '<small>' + st.word + '</small></div></div></td>' +
					'<td>' + fmt(d.viterbiAvg) + '</td><td>' + fmt(d.packetsPerSec) + '</td></tr>';
			}).join('') + '</tbody></table>';
		// hero status line follows the satellite on show
		var line = document.getElementById('heroStatus');
		if (line)
		{
			var g = all[RECEIVERS.findIndex(function (r) { return r.id == (SATS[state.sat].rx || state.sat); })], st = rxState(g);
			line.innerHTML = '<span class="dot ' + st.cls + '"></span><span>' + esc(SATS[state.sat].name) + ' receiver: ' + st.word.toLowerCase() +
				(g && g.decoder && g.decoder.packetsPerSec ? ', ' + fmt(g.decoder.packetsPerSec) + ' packets a second' : '') + '</span>';
		}
	});
}

// ------------------------------------------------------------------ IMAGERY
function renderImagery(cat, sub)
{
	var cats = config.categories;
	if (!cat || !cats[cat]) cat = 'abi';
	if (!sub || !cats[cat].data[sub]) return renderTiles(cat);
	var it = cats[cat].data[sub];

	main.innerHTML =
	'<header class="page-head viewer-head"><p style="margin:0 0 10px"><a href="' + (cat == 'emwin' ? '#/emwin' : cat == 'nws' ? '#/emwin/nws' : '#/imagery/' + enc(cat)) + '">All ' + esc(cats[cat].title.toLowerCase()) + '</a></p>' +
		'<div class="viewer-meta"><div><h1 class="h2">' + esc(it.title) + '</h1><p class="caption" style="margin:0">' + esc(cats[cat].title) + '</p></div><div class="viewer-actions" id="vActions"></div></div></header>' +
	'<div class="viewer-frame" id="vFrame"><span class="loading">Loading…</span></div>' +
	'<div class="timeline" id="vTimeline"></div>';

	var frame = document.getElementById('vFrame'), stage = imageStage(frame), currentTs = 0;
	var actions = document.getElementById('vActions');
	if (it.videoPath)
	{
		var playing = false;
		var b = el('<button type="button" class="btn"><svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg><span>Play the loop</span></button>');
		b.addEventListener('click', function ()
		{
			if (!playing) { stage.play(API.video(it.videoPath), function () {
				b.querySelector('span').textContent = 'Loop not ready yet';
				if (cat == 'solar' && window.LAB_SPACENET === true && !document.getElementById('loopWhy'))
					b.insertAdjacentHTML('afterend', '<p class="caption" id="loopWhy">A loop is made once there are at least 6 images. With internet space weather, each press of Download on the Space page adds one (10 minutes apart); loops are rebuilt every 30 minutes.</p>');
			}); b.querySelector('span').textContent = 'Show still image'; }
			else { stage.show(API.img(cat, sub, 1600, currentTs), it.title); b.querySelector('span').textContent = 'Play the loop'; }
			playing = !playing;
		});
		actions.appendChild(b);
	}
	var full = el('<a class="btn ghost" target="_blank" rel="noopener">Open full resolution</a>');
	actions.appendChild(full);

	getJSON(API.meta(cat, sub)).then(function (m)
	{
		var frames = (m.images || []).slice(-96);
		if (!frames.length) { videoOnly(); return; }
		var pend = null;
		timeline(document.getElementById('vTimeline'), frames, function (f, final)
		{
			currentTs = f.timestamp;
			full.href = API.orig(cat, sub, f.timestamp);
			clearTimeout(pend);
			pend = setTimeout(function () { stage.show(API.img(cat, sub, final ? 1600 : 960, f.timestamp), it.title + ', ' + when(f.timestamp)); }, final ? 0 : 60);
		});
	}).catch(videoOnly);

	// some products (the tiled timelapses) are only a video, with no still images
	function videoOnly()
	{
		full.remove();
		if (!it.videoPath) { frame.innerHTML = '<p class="empty">Nothing received for this product yet.</p>'; return; }
		actions.innerHTML = '<a class="btn ghost" href="' + API.video(it.videoPath) + '" download>Download the video</a>';
		stage.play(API.video(it.videoPath), function () { frame.innerHTML = '<p class="empty">The video for this product could not be loaded.</p>'; }, true);
	}
}

// every product in a group as a grid of thumbnails
function renderTiles(cat)
{
	var cats = config.categories, data = cats[cat].data;
	main.innerHTML =
	'<header class="page-head"><h1 class="display">Imagery</h1><p class="lede">The latest image of every product the station receives. Choose one to step through its history or play its loop.</p>' +
		'<div class="chips" style="margin-top:22px" role="group" aria-label="Group">' + Object.keys(cats).map(function (c) {
			return '<button type="button" data-cat="' + esc(c) + '" aria-pressed="' + (c == cat) + '">' + esc(cats[c].title) + ' <span class="muted">' + Object.keys(cats[c].data).length + '</span></button>';
		}).join('') + '</div></header>' +
	tileGrid(cat);
	main.querySelectorAll('[data-cat]').forEach(function (b) { b.addEventListener('click', function () { location.hash = '#/imagery/' + enc(b.dataset.cat); }); });
}

function tileGrid(cat)
{
	var data = config.categories[cat].data;
	return '<div class="tiles">' + Object.keys(data).map(function (s) {
		var d = data[s];
		return '<a class="tile" href="#/imagery/' + enc(cat) + '/' + enc(s) + '"><div class="thumb"><img loading="lazy" decoding="async" alt="" src="' + API.img(cat, s, 320) + '" onerror="labNoThumb(this)"' + (d.videoPath ? ' data-video="' + esc(API.video(d.videoPath)) + '"' : '') + '></div>' +
			'<span class="tile-title">' + esc(d.title) + '</span>' + (d.videoPath ? '<span class="tile-note">Loop available</span>' : '') + '</a>';
	}).join('') + '</div>';
}

// no still image: show the first moments of the product's video instead, if it has one
window.labNoThumb = function (img)
{
	var box = img.parentNode, src = img.getAttribute('data-video');
	if (!src) { box.classList.add('none'); return; }
	var v = document.createElement('video');
	v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = src + '#t=2';
	v.onerror = function () { box.classList.add('none'); };
	img.replaceWith(v);
};

// Vitality sends the forecast discussion as HTML; keep only its text
function plainParas(html)
{
	var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
	var ps = Array.prototype.map.call(doc.querySelectorAll('p'), function (p) { return p.textContent; });
	if (!ps.length) ps = [doc.body.textContent];
	return ps.map(function (t) { return t.replace(/^\s*\.+\s*/, '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
}

// ------------------------------------------------------------------ EMWIN
function renderEmwin(view)
{
	var cats = config.categories, bulletins = view == 'bulletins', nws = view == 'nws' && !!cats.nws, gfx = !bulletins && !nws;
	function segBtn(v, label, on, n) { return '<button type="button" data-v="' + v + '" aria-pressed="' + on + '">' + label + (n ? ' <span class="muted">' + n + '</span>' : '') + '</button>'; }
	main.innerHTML =
	'<header class="page-head"><h1 class="display">EMWIN</h1><p class="lede">The Emergency Managers Weather Information Network: weather graphics, National Weather Service charts and bulletins that GOES-19 rebroadcasts alongside its imagery.</p>' +
		'<div class="seg" style="margin-top:22px" role="group" aria-label="View">' +
			segBtn('', 'EMWIN graphics', gfx, cats.emwin && Object.keys(cats.emwin.data).length) +
			(cats.nws ? segBtn('nws', 'NWS charts', nws, Object.keys(cats.nws.data).length) : '') +
			segBtn('bulletins', 'Bulletins', bulletins) + '</div></header>' +
	'<div id="emwinBody"></div>';
	main.querySelectorAll('[data-v]').forEach(function (b) { b.addEventListener('click', function () { location.hash = '#/emwin' + (b.dataset.v ? '/' + b.dataset.v : ''); }); });
	var body = document.getElementById('emwinBody');
	if (gfx || nws)
	{
		var cat = nws ? 'nws' : 'emwin';
		body.innerHTML = cats[cat] ? groupedCharts(cat) : '<p class="empty">No EMWIN graphics are configured.</p>';
		chartTimes(cat, body);
		return;
	}
	var list = (config.otherEmwin && config.otherEmwin.system) || [];
	var mine = myBulletins(), hidden = hiddenBulletins();
	body.innerHTML = '<p class="caption">Reading the latest bulletins…</p>';
	getJSON('../dataHandler.php?type=metadata&id=otherEmwin').then(function (m)
	{
		var sys = m.system || [], usr = m.user || [];
		// one list: the viewer's own choices first, then the station's (minus any the viewer switched off)
		var cards = mine.map(function (b, i) { return { title: b.title, msgs: usr[i] || [], own: true }; })
			.concat(list.map(function (b, i) { return { title: b.title, msgs: sys[i] || [], key: b.title }; })
			.filter(function (c) { return !hidden[c.key]; }));
		body.innerHTML =
			'<div class="reader-nav" style="margin-bottom:18px"><span class="muted">' + (mine.length ? mine.length + ' of your own bulletins plus the station\'s list' : 'Showing the station\'s bulletins. Add your local NWS office\'s warnings and forecasts.') + '</span>' +
				'<button type="button" class="btn" id="bulPick">Choose your bulletins</button></div>' +
			'<div id="bulPanel" hidden></div>' +
			(cards.length ? '<div class="accordion">' + cards.map(function (c, i) {
				var n = c.msgs.length;
				return '<section class="acc' + (n ? '' : ' none') + '">' +
					'<h2><button type="button" class="acc-btn" aria-expanded="false" aria-controls="acc' + i + '" data-i="' + i + '"' + (n ? '' : ' disabled') + '>' +
						'<span class="acc-title">' + esc(titleCaseKeep(c.title)) + (c.own ? ' <span class="muted">yours</span>' : '') + '</span>' +
						'<span class="acc-count">' + (n ? n + (n == 1 ? ' message' : ' messages') : 'No messages') + '</span>' +
						'<svg class="acc-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button></h2>' +
					'<div class="acc-panel" id="acc' + i + '" hidden></div></section>';
			}).join('') + '</div>' : '<p class="empty">No bulletins chosen yet.</p>') +
			(m.satelliteTleDate ? '<p class="caption" style="margin-top:28px">Orbit data for ' + (m.satelliteTle || []).length + ' satellites last received ' + esc(m.satelliteTleDate) + '.</p>' : '');

		document.getElementById('bulPick').addEventListener('click', function () {
			var p = document.getElementById('bulPanel');
			if (p.hidden) bulletinPicker(p, m.allUnique || [], list, mine, hidden);
			p.hidden = !p.hidden;
		});
		function showMsg(panel, i, at)
		{
			var all = cards[i].msgs;
			var paras = bulletinParas(all[at]);
			panel.innerHTML =
				(all.length > 1 ? '<div class="reader-nav"><button type="button" class="btn ghost" data-step="-1"' + (at == 0 ? ' disabled' : '') + '>Previous</button>' +
					'<span class="muted">Message ' + (at + 1) + ' of ' + all.length + '</span>' +
					'<button type="button" class="btn ghost" data-step="1"' + (at == all.length - 1 ? ' disabled' : '') + '>Next</button></div>' : '') +
				'<div class="bulletin">' + paras.map(function (t, k) { return '<p' + (k == 0 ? ' class="b-head"' : '') + '>' + esc(t) + '</p>'; }).join('') + '</div>';
			panel.querySelectorAll('[data-step]').forEach(function (btn) { btn.addEventListener('click', function () { showMsg(panel, i, at + +btn.dataset.step); }); });
		}
		body.querySelectorAll('.acc-btn').forEach(function (btn)
		{
			btn.addEventListener('click', function ()
			{
				var i = +btn.dataset.i, panel = document.getElementById('acc' + i), open = btn.getAttribute('aria-expanded') == 'true';
				btn.setAttribute('aria-expanded', !open);
				panel.hidden = open;
				btn.closest('.acc').classList.toggle('open', !open);
				if (!open && !panel.firstChild) showMsg(panel, i, 0);
			});
		});
	}).catch(function () { body.innerHTML = '<p class="empty">The bulletins could not be read. Check that the EMWIN folder is reachable, then reload.</p>'; });
}

// ---- Each viewer's own EMWIN bulletins (Nov 2026) ----
// Saved in this browser only, in the same "otheremwin" cookie the classic site's
// "Load Additional Data" uses, so choices show up on both sites.
var PIL_NAMES = {
	AFD: 'Area forecast discussion', ZFP: 'Zone forecast', HWO: 'Hazardous weather outlook', SPS: 'Special weather statement',
	FFA: 'Flood watch', FFW: 'Flash flood warning', FFS: 'Flash flood statement', FLW: 'Flood warning', FLS: 'Flood statement and advisory',
	SVR: 'Severe thunderstorm warning', SVS: 'Severe weather statement', TOR: 'Tornado warning', WSW: 'Winter weather warnings, watches and advisories',
	NPW: 'Wind, heat, fog and frost advisories', WCN: 'Watch county notice', RWR: 'Regional weather roundup', NOW: 'Short-term forecast',
	PNS: 'Public information statement', LSR: 'Local storm reports', CLI: 'Daily climate report', CLM: 'Monthly climate report',
	RVS: 'River statement', RVA: 'River summary', RVD: 'Daily river forecast', HYD: 'Hydrology summary', ESF: 'Hydrologic outlook',
	MWW: 'Marine weather message', SMW: 'Special marine warning', MWS: 'Marine weather statement', CWF: 'Coastal waters forecast',
	NSH: 'Nearshore marine forecast', GLF: 'Great Lakes forecast', OFF: 'Offshore forecast', FWF: 'Fire weather forecast', RFW: 'Red flag warning',
	AQA: 'Air quality alert', CEM: 'Civil emergency message', EQR: 'Earthquake report', RER: 'Record event report', SFT: 'Tabular state forecast',
	SFP: 'State forecast', PFM: 'Point forecast matrix', AFM: 'Area forecast matrix', TCV: 'Tropical cyclone watches and warnings',
	TCP: 'Tropical cyclone public advisory', TCD: 'Tropical cyclone discussion', TWO: 'Tropical weather outlook', SWO: 'Storm Prediction Center outlook',
	SEL: 'Severe weather watch', PTS: 'Probabilistic outlook points', ADM: 'Administrative message', FTM: 'Radar outage notice', ALT: 'Space weather alert',
	WAT: 'Space weather watch', WAR: 'Space weather warning', SUM: 'Space weather summary', VAA: 'Volcanic ash advisory', FVX: 'Volcano message'
};
var PIL_SUGGESTED = { FLW: 1, FFW: 1, FFA: 1, FLS: 1, SVR: 1, TOR: 1, SVS: 1, WSW: 1, SPS: 1, HWO: 1, NPW: 1, MWW: 1, AFD: 1 };
function pilName(p) { return PIL_NAMES[p] || p; }
function myBulletins()
{
	var c = (document.cookie.match(/(?:^|;\s*)otheremwin=([^;]*)/) || [])[1];
	if (!c) return [];
	try { c = decodeURIComponent(c); } catch (e) { return []; }
	return c.split('~').map(function (card) {
		var p = card.split('!'); if (p.length != 4) return null;
		var id; try { id = atob(p[0].replace(/-/g, '=')); } catch (e) { return null; }
		return { identifier: id, title: p[1], format: +p[2] ? 'paragraph' : 'formatted', truncate: p[3] };
	}).filter(Boolean);
}
function saveMyBulletins(cards)
{
	var v = cards.map(function (b) {
		return [btoa(b.identifier).replace(/=/g, '-'), String(b.title).replace(/[!~]/g, ''), b.format == 'formatted' ? 0 : 1, b.truncate || 0].join('!');
	}).join('~');
	var host = location.hostname, dom = /^[\d.]+$/.test(host) || host.indexOf('.') < 0 ? '' : ';domain=.' + host;
	document.cookie = 'otheremwin=' + encodeURIComponent(v) + ';expires=' + new Date(Date.now() + 365 * 864e5).toUTCString() + ';path=/' + dom;
	if (!v) document.cookie = 'otheremwin=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + dom;
}
function hiddenBulletins() { try { return JSON.parse(localStorage.getItem('labHiddenBulletins') || '{}'); } catch (e) { return {}; } }
function bulletinPicker(panel, all, stationList, mine, hidden)
{
	var have = {}; mine.forEach(function (b) { have[b.identifier] = 1; });
	var office = ''; try { office = localStorage.getItem('labNwsOffice') || ''; } catch (e) {}
	if (!office) { var m = mine.map(function (b) { return (b.identifier.match(/\)?([A-Z]{3})\[A-Z0-9\]\{2\}$/) || [])[1]; }).filter(Boolean); office = m[0] || ''; }
	var offices = {}; all.forEach(function (id) { offices[id.substr(3, 3)] = 1; });
	function idFor(pil, off) { return pil + off + '[A-Z0-9]{2}'; }
	function box(id, title, checked, note) {
		return '<label style="display:flex;gap:8px;align-items:baseline;margin:4px 0"><input type="checkbox" data-id="' + esc(id) + '" data-title="' + esc(title) + '"' + (checked ? ' checked' : '') + '><span>' + esc(title) + (note ? ' <span class="muted">' + esc(note) + '</span>' : '') + '</span></label>';
	}
	function officeList(off) {
		var pils = {}; all.forEach(function (id) { if (id.substr(3, 3) == off) pils[id.substr(0, 3)] = 1; });
		var keys = Object.keys(pils).sort(function (a, b) { return (PIL_SUGGESTED[b] ? 1 : 0) - (PIL_SUGGESTED[a] ? 1 : 0) || pilName(a).localeCompare(pilName(b)); });
		if (!off) return '<p class="muted">Type your office\'s 3-letter code above, for example MKX for Milwaukee/Sullivan. You can look yours up at weather.gov.</p>';
		if (!keys.length) return '<p class="muted">Nothing from ' + esc(off) + ' has been received yet. Check the code, or try again after the station has run for a while.</p>';
		var fresh = !mine.some(function (b) { return b.identifier.indexOf(off + '[') > 0; });
		return keys.map(function (p) { var id = idFor(p, off); return box(id, pilName(p) + ' (' + off + ')', have[id] || (fresh && PIL_SUGGESTED[p]), p); }).join('');
	}
	var lakes = all.filter(function (id) { return /^(GLF|NSH|CWF|OFF)/.test(id); });
	panel.innerHTML =
		'<div class="bul-panel">' +
		'<h2 class="h3" style="margin-top:0">Choose your bulletins</h2>' +
		'<p class="muted" style="margin-top:0">Saved in this browser only, so everyone viewing the station picks their own. The classic site uses the same choices.</p>' +
		'<h3>Your NWS office</h3>' +
		'<input id="bulOffice" list="bulOffices" maxlength="3" value="' + esc(office) + '" placeholder="MKX" style="text-transform:uppercase;width:7em" aria-label="NWS office code">' +
		'<datalist id="bulOffices">' + Object.keys(offices).sort().map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>' +
		'<div id="bulOfficeList" style="margin-top:10px">' + officeList(office) + '</div>' +
		(lakes.length ? '<h3>Great Lakes and marine forecasts</h3>' + lakes.map(function (id) { return box(id, pilName(id.substr(0, 3)) + ' (' + id.substr(3) + ')', have[id], id); }).join('') : '') +
		(window.EMWIN_CATALOG ? '<h3>Tsunami and tropical bulletins</h3><p class="muted" style="margin:0 0 6px">From the NWS EMWIN product catalog, by region. These only have messages when the NWS issues them, for example during a hurricane or tsunami.</p>' +
			EMWIN_CATALOG.map(function (g) {
				var n = 0, inner = g.regions.map(function (r) {
					return '<div style="margin:6px 0 10px 4px"><b>' + esc(r.name) + '</b>' + r.items.map(function (it) {
						var id = emwinCatalogId(it.id); if (have[id]) n++;
						return box(id, emwinCatalogTitle(r, it), have[id]).replace('<span>' + esc(emwinCatalogTitle(r, it)), '<span>' + esc(it.title));
					}).join('') + '</div>';
				}).join('');
				return '<details style="margin:4px 0"' + (n ? ' open' : '') + '><summary style="cursor:pointer">' + esc(g.group) + (n ? ' <span class="muted">' + n + ' on</span>' : '') + '</summary>' + inner + '</details>';
			}).join('') : '') +
		'<h3>Any other bulletin received</h3>' +
		'<input id="bulFind" placeholder="Search, e.g. RWR or SWODY1" style="width:16em" aria-label="Search all received bulletins"><div id="bulFound"></div>' +
		(stationList.length ? '<h3>The station\'s bulletins</h3>' + stationList.map(function (b) {
			return '<label style="display:flex;gap:8px;margin:4px 0"><input type="checkbox" data-station="' + esc(b.title) + '"' + (hidden[b.title] ? '' : ' checked') + '><span>' + esc(titleCaseKeep(b.title)) + '</span></label>';
		}).join('') : '') +
		'<div class="reader-nav" style="margin-top:18px"><button type="button" class="btn ghost" id="bulClear">Remove all of mine</button><button type="button" class="btn" id="bulSave">Save</button></div></div>';
	var offIn = panel.querySelector('#bulOffice');
	offIn.addEventListener('input', function () { var v = offIn.value.toUpperCase().replace(/[^A-Z]/g, ''); if (v.length == 3 || !v) panel.querySelector('#bulOfficeList').innerHTML = officeList(v); });
	panel.querySelector('#bulFind').addEventListener('input', function () {
		var q = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
		panel.querySelector('#bulFound').innerHTML = q.length < 2 ? '' : all.filter(function (id) { return id.indexOf(q) >= 0; }).slice(0, 30)
			.map(function (id) { return box(id, pilName(id.substr(0, 3)) + ' (' + id.substr(3) + ')', have[id], id); }).join('') || '<p class="muted">Nothing received matches.</p>';
	});
	panel.querySelector('#bulClear').addEventListener('click', function () { saveMyBulletins([]); location.reload(); });
	panel.querySelector('#bulSave').addEventListener('click', function () {
		var keep = mine.slice(), seen = {};
		// boxes on screen decide their own bulletin; everything else already saved stays
		panel.querySelectorAll('input[data-id]').forEach(function (cb) {
			var id = cb.dataset.id, at = keep.findIndex(function (b) { return b.identifier == id; });
			if (seen[id]) return; seen[id] = 1;
			if (cb.checked && at < 0) keep.push({ identifier: id, title: cb.dataset.title, format: 'paragraph', truncate: 0 });
			if (!cb.checked && at >= 0) keep.splice(at, 1);
		});
		if (window.emwinSaveUserCards ? !emwinSaveUserCards(keep) : (saveMyBulletins(keep), false)) {
			alert('That is too many bulletins to remember in this browser. Untick a few and save again.'); return;
		}
		var hide = {}; panel.querySelectorAll('input[data-station]').forEach(function (cb) { if (!cb.checked) hide[cb.dataset.station] = 1; });
		try { localStorage.setItem('labHiddenBulletins', JSON.stringify(hide)); localStorage.setItem('labNwsOffice', offIn.value.toUpperCase()); } catch (e) {}
		location.reload();
	});
}
// EMWIN and NWS graphics, grouped like the classic site's pages: whole charts (not cropped),
// the time of each latest image, and radar loops playing in place when the product is set to autoplay
var CHART_GROUPS = {
	emwin: [['Radar', /radar/i], ['Satellite', /meteosat|himawari|goes|sat\b|satellite|hurricane basin|cloud tops/i], ['Forecasts and outlooks', /./]],
	nws: [['Atlantic and Caribbean', /^(atl|car|gulf|watl|hiwind_atl)/i], ['Pacific', /^(pac|epac|hiwind_pac)/i], ['United States', /./]]
};
function groupedCharts(cat)
{
	var data = config.categories[cat].data, groups = CHART_GROUPS[cat], seen = {};
	return groups.map(function (g) {
		var keys = Object.keys(data).filter(function (s) { if (seen[s] || !g[1].test(cat == 'nws' ? s : data[s].title)) return false; seen[s] = 1; return true; });
		if (!keys.length) return '';
		return '<h2 class="h3" style="margin:34px 0 14px">' + esc(g[0]) + ' <span class="muted">' + keys.length + '</span></h2>' +
			'<div class="tiles charts">' + keys.map(function (s) {
				var d = data[s], live = d.videoPath && (d.autoplay === true || d.autoplay == '1' || d.autoplay == 'true');
				return '<a class="tile" href="#/imagery/' + enc(cat) + '/' + enc(s) + '"><div class="thumb">' +
					(live ? '<video muted loop autoplay playsinline preload="metadata" src="' + esc(API.video(d.videoPath)) + '" aria-label="' + esc(d.title) + ' loop"></video>'
						: '<img loading="lazy" decoding="async" alt="" src="' + API.img(cat, s, 480) + '" onerror="labNoThumb(this)"' + (d.videoPath ? ' data-video="' + esc(API.video(d.videoPath)) + '"' : '') + '>') +
					'</div><span class="tile-title">' + esc(d.title) + '</span><span class="tile-note" data-when="' + esc(s) + '">' + (live ? 'Loop, last 24 hours' : '&nbsp;') + '</span></a>';
			}).join('') + '</div>';
	}).join('');
}
// fill in "3 h ago" under each still chart (a few lookups at a time)
function chartTimes(cat, root)
{
	var notes = Array.prototype.slice.call(root.querySelectorAll('[data-when]')).filter(function (n) { return n.textContent.trim() === ''; });
	(function next() {
		var batch = notes.splice(0, 4); if (!batch.length) return;
		Promise.all(batch.map(function (n) {
			return getJSON(API.meta(cat, n.dataset.when)).then(function (m) {
				var f = (m.images || [])[m.images.length - 1];
				n.textContent = f ? ago(f.timestamp) : 'No image yet';
			}).catch(function () { n.textContent = ''; });
		})).then(next);
	})();
}

// bulletin text arrives as HTML paragraphs with <br> line breaks; keep the text and the line breaks only
function bulletinParas(html)
{
	var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
	doc.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
	var ps = Array.prototype.map.call(doc.querySelectorAll('p'), function (p) { return p.textContent; });
	if (!ps.length) ps = [doc.body.textContent];
	return ps.map(function (t) { return t.replace(/[ \t]+/g, ' ').replace(/^\s+|\s+$/g, ''); }).filter(Boolean);
}
// "LOCAL MKX NWS FLOOD WARNING" reads better as "Local MKX NWS Flood Warning"; leave mixed-case titles alone
function titleCaseKeep(t) { t = String(t || '').trim(); return t == t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\b(Nws|Mkx|Emwin|Sdm|Ops)\b/g, function (w) { return w.toUpperCase(); }) : t; }

// ------------------------------------------------------------------ WEATHER
function renderWeather()
{
	main.innerHTML =
	'<header class="page-head"><h1 class="display">Local weather</h1><p class="lede">The latest National Weather Service observation and forecast, received by satellite over EMWIN rather than the internet.</p></header>' +
	'<div class="wx"><div id="wxNow"><p class="caption">Reading the latest observation…</p></div>' +
	'<div><div class="media" id="wxRadar" style="aspect-ratio:16/11"></div><p class="caption">Great Lakes radar composite, last 24 hours.</p></div></div>' +
	'<h2 class="h2" style="margin-top:40px">The week ahead</h2><div class="week" id="wxWeek"></div>';

	var v = config.localRadarVideo, rb = document.getElementById('wxRadar');
	if (v) { rb.innerHTML = '<video muted loop autoplay playsinline controls aria-label="Radar loop"></video>'; rb.querySelector('video').src = API.video(v); }

	getJSON(API.weather).then(function (w)
	{
		document.getElementById('wxNow').innerHTML =
			'<div class="reading">' + esc(w.temp || '–') + '<small>°F</small></div>' +
			'<p class="h3" style="margin-top:10px">' + esc(wxWords(w.weatherDesc)) + '</p>' +
			'<p class="caption" style="margin:0">' + esc(titleCase(w.city)) + ', ' + esc(w.state || '') + (w.weatherTime ? '. ' + esc(titleCase(w.weatherTime)) : '') + '</p>' +
			'<dl class="facts">' +
				'<dt>Wind</dt><dd>' + (w.wind ? esc(w.windDirection + ' ' + w.wind + ' mph') : 'Calm') + (w.windGust && w.windGust != 'N/A' ? ', gusts ' + esc(w.windGust.toLowerCase()) : '') + '</dd>' +
				'<dt>Humidity</dt><dd>' + esc(w.humidity || '–') + '%</dd>' +
				'<dt>Dew point</dt><dd>' + esc(w.dewPoint || '–') + '°F</dd>' +
				'<dt>Pressure</dt><dd>' + esc(pressure(w.pressure)) + '</dd>' +
			'</dl>' +
			(w.summary ? '<div class="discussion">' + plainParas(w.summary).map(function (t, i) { return '<p' + (i == 0 ? ' class="caption"' : '') + '>' + esc(t) + '</p>'; }).join('') + '</div>' : '');
		document.getElementById('wxWeek').innerHTML = (w.sevenDayForcast || []).map(function (d) {
			var pop = Math.max(+d.amPrecip || 0, +d.pmPrecip || 0);
			return '<div><div class="day">' + esc(dayName(d.date)) + '</div>' +
				'<div class="temps">' + esc(d.maxTemp != null ? d.maxTemp + '°' : '–') + ' <span>' + esc(d.minTemp != null ? d.minTemp + '°' : '') + '</span></div>' +
				'<div class="pop">' + pop + '% chance of precipitation</div><div class="bar"><i style="width:' + pop + '%"></i></div></div>';
		}).join('');
	}).catch(function () { document.getElementById('wxNow').innerHTML = '<p class="caption">The local observation is not available right now.</p>'; });
}

// ------------------------------------------------------------------ SPACE WEATHER
function renderSpace(bust)
{
	var s = config.categories.solar, net = window.LAB_SPACENET === true;
	main.innerHTML =
	'<header class="page-head"><h1 class="display">Space weather</h1><p class="lede">The Sun in several wavelengths, plus the forecasts for aurora and geomagnetic storms. Choose an image to step through its history.</p></header>' +
	(net ? '<div class="bul-panel" id="swNet"><h2 class="h3" style="margin-top:0">Latest images from the internet</h2>' +
		'<p class="muted" style="margin-top:0">From NASA SDO, GOES-18 SUVI (UW-SSEC) and NOAA SWPC. Nothing downloads by itself: press the button to fetch the newest images. This station needs internet access for it.</p>' +
		'<div class="reader-nav"><span class="muted" id="swNetMsg">' + (bust ? 'Updated just now.' : '') + '</span><button type="button" class="btn" id="swNetGo">Download the latest images</button></div></div>' : '') +
	(s ? '<div class="gallery">' + Object.keys(s.data).map(function (k) {
		return '<a href="#/imagery/solar/' + enc(k) + '"><div class="media"><img loading="lazy" alt="" src="' + API.img('solar', k, 480) + (bust ? '&_=' + bust : '') + '" onerror="labNoThumb(this)"></div><h2 class="h3">' + esc(s.data[k].title) + '</h2></a>';
	}).join('') + '</div>' : '<p class="empty">No space weather products are configured.</p>');
	var go = document.getElementById('swNetGo');
	if (!go) return;
	go.addEventListener('click', function () {
		var msg = document.getElementById('swNetMsg');
		go.disabled = true; msg.textContent = 'Downloading, this takes up to a minute…';
		fetch('../spaceweather-fetch.php', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (r) {
			if (!r.ok && r.error) { msg.textContent = r.error; go.disabled = false; return; }
			var parts = [];
			if (r.saved && r.saved.length) parts.push(r.saved.length + ' new image' + (r.saved.length == 1 ? '' : 's'));
			if (r.fresh && r.fresh.length) parts.push(r.fresh.length + ' already up to date (under 10 minutes old)');
			if (r.failed && r.failed.length) parts.push(r.failed.length + ' could not be downloaded: ' + r.failed.join('; '));
			try { localStorage.setItem('labVideoBust', String(Date.now())); } catch (e) {}
			renderSpace(Date.now());
			var m2 = document.getElementById('swNetMsg');
			if (m2) {
				m2.textContent = parts.join('. ') + '. ';
				m2.insertAdjacentHTML('beforeend', '<button type="button" class="btn ghost" id="swNetReload">Refresh the page</button>');
				document.getElementById('swNetReload').addEventListener('click', function () { location.reload(); });
			}
		}).catch(function () { msg.textContent = 'The download did not work. Check that this station can reach the internet.'; go.disabled = false; });
	});
}

// ------------------------------------------------------------------ RECEIVERS
function renderReceivers()
{
	main.innerHTML =
	'<header class="page-head"><h1 class="display">Receivers</h1><p class="lede">Two Raspberry Pi receivers decode the HRIT downlinks with goestools. Viterbi is the number of bit errors corrected in each packet, so lower means a cleaner signal.</p></header>' +
	'<div class="receivers">' + RECEIVERS.map(function (r) {
		return '<section><h2 class="h2">' + esc(r.sat) + '</h2><p class="caption" style="margin:0" id="rxState_' + r.id + '">' + esc(r.where) + '</p>' +
			'<div class="big-readings"><div><span>Viterbi per packet</span><b id="rxVit_' + r.id + '">–</b></div><div><span>Packets a second</span><b id="rxPps_' + r.id + '">–</b></div><div><span>Packets good</span><b id="rxOk_' + r.id + '">–</b></div></div>' +
			'<p class="muted" style="margin:0 0 4px;font-size:13px">Viterbi, last hour</p><svg class="spark" id="rxSpark_' + r.id + '" viewBox="0 0 100 40" preserveAspectRatio="none"><path class="a"/><path class="l"/></svg>' +
			'<dl class="facts" id="rxPi_' + r.id + '"></dl></section>';
	}).join('') + '</div>' +
	'<p style="margin-top:30px"><a href="../Ground-Station">Open the full ground station display</a></p>';

	every(5000, function ()
	{
		RECEIVERS.forEach(function (r)
		{
			getJSON(API.stats('goes', r.id)).then(function (g)
			{
				var st = rxState(g), d = g.decoder || {}, dm = g.demod || {};
				var s = document.getElementById('rxState_' + r.id); if (!s) return;
				s.innerHTML = '<span class="dot ' + st.cls + '" style="display:inline-block;margin-right:8px"></span>' + st.word + ', ' + esc(r.where) + (dm.frequency != null ? ', ' + fmt(dm.frequency) + ' Hz offset' : '');
				document.getElementById('rxVit_' + r.id).textContent = fmt(d.viterbiAvg);
				document.getElementById('rxPps_' + r.id).textContent = fmt(d.packetsPerSec);
				document.getElementById('rxOk_' + r.id).textContent = d.okPercent != null ? fmt(d.okPercent, 1) + '%' : '–';
			}).catch(function () {});
		});
	});
	every(30000, function ()
	{
		RECEIVERS.forEach(function (r)
		{
			getJSON(API.stats('history', r.id)).then(function (h)
			{
				var svg = document.getElementById('rxSpark_' + r.id); if (!svg || !h.viterbi || h.viterbi.length < 2) return;
				var v = h.viterbi.map(function (p) { return p[1]; }), max = Math.max.apply(null, v) * 1.2 || 1;
				var pts = v.map(function (y, i) { return (i * 100 / (v.length - 1)).toFixed(2) + ',' + (38 - 36 * y / max).toFixed(2); });
				svg.querySelector('.l').setAttribute('d', 'M' + pts.join(' L'));
				svg.querySelector('.a').setAttribute('d', 'M0,40 L' + pts.join(' L') + ' L100,40Z');
			}).catch(function () {});
			getJSON(API.stats('pi', r.id)).then(function (p)
			{
				var dl = document.getElementById('rxPi_' + r.id); if (!dl || !p.online) return;
				dl.innerHTML = '<dt>Pi temperature</dt><dd>' + fmt(p.temp, 1) + ' °C</dd><dt>Pi processor</dt><dd>' + fmt(p.cpu) + '%</dd>' +
					'<dt>Pi memory</dt><dd>' + fmt(p.memPct) + '%</dd><dt>Running for</dt><dd>' + uptime(p.uptime) + '</dd>';
			}).catch(function () {});
		});
	});
}
function uptime(s) { if (!s) return '–'; var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600); return (d ? d + (d == 1 ? ' day ' : ' days ') : '') + h + (h == 1 ? ' hour' : ' hours'); }

// ------------------------------------------------------------------ LOCAL SETTINGS
// The same location profiles as the classic site's Local Settings page (cookies
// "localSettings" and "selectedProfile"), so a profile saved on either site is used by both.
var PROFILE_KEYS = ['city', 'lat', 'lon', 'orig', 'radarCode', 'rwrOrig', 'stateAbbr', 'timezone', 'wxZone'];
function readProfiles()
{
	return (vgGetCookie('localSettings') || '').split('~').map(function (p) {
		var v = p.split('!'); if (v.length != 9) return null;
		var o = {}; PROFILE_KEYS.forEach(function (k, i) { o[k] = v[i]; }); return o;
	}).filter(Boolean);
}
function saveProfiles(list) { vgSetCookie('localSettings', list.map(function (o) { return PROFILE_KEYS.map(function (k) { return String(o[k] || '').replace(/[!~]/g, ''); }).join('!'); }).join('~')); }
function renderSettings()
{
	main.innerHTML = '<header class="page-head"><h1 class="display">Local settings</h1><p class="lede">Where you are, for the local forecast, radar and weather roundup, and the look of the classic site. Saved in this browser only, and shared with the classic site\'s Local Settings.</p></header><div id="setBody"><p class="caption">Loading…</p></div>';
	// the server fills in the station's own profile (number 0) the first time
	fetch('../dataHandler.php?type=preload', { cache: 'no-store' }).catch(function () {}).then(function () {
		var profiles = readProfiles(), sel = parseInt(vgGetCookie('selectedProfile'), 10) || 0;
		if (!profiles.length) { document.getElementById('setBody').innerHTML = '<p class="empty">Location settings need EMWIN data from this station. They appear once EMWIN bulletins are being received.</p>'; themeCard(document.getElementById('setBody'), true); return; }
		if (sel >= profiles.length) sel = 0;
		var p = profiles[sel], locked = sel == 0;
		function field(id, label, input) { return '<label class="set-row"><span>' + label + '</span>' + input + '</label>'; }
		function selectEl(id) { return '<select id="set_' + id + '"' + (locked ? ' disabled' : '') + '><option value="' + esc(p[id]) + '">' + esc(p[id] || '…') + '</option></select>'; }
		document.getElementById('setBody').innerHTML = (config.showEmwinInfo === false ? '' :
			'<section class="bul-panel"><h2 class="h3" style="margin-top:0">Location</h2>' +
			'<div class="reader-nav" style="margin-bottom:14px"><label class="set-row" style="margin:0"><span>Profile</span><select id="set_profile">' + profiles.map(function (o, i) {
				return '<option value="' + i + '"' + (i == sel ? ' selected' : '') + '>' + esc(i == 0 ? 'Ground station defaults' : (o.city ? titleCaseKeep(o.city.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); })) : o.wxZone) + ', ' + o.stateAbbr) + '</option>';
			}).join('') + '</select></label>' +
			'<span><button type="button" class="btn ghost" id="set_add"' + (profiles.length >= 10 ? ' disabled' : '') + '>Add a profile</button> <button type="button" class="btn ghost" id="set_del"' + (locked ? ' disabled' : '') + '>Delete</button></span></div>' +
			(locked ? '<p class="muted">These are the station\'s own settings. To use another place, press <b>Add a profile</b>, then change it.</p>' : '') +
			field('timezone', 'Time zone', selectEl('timezone')) +
			field('radarCode', 'Radar region', selectEl('radarCode')) +
			field('stateAbbr', 'State or territory', selectEl('stateAbbr')) +
			field('lat', 'Latitude', '<input id="set_lat" value="' + esc(p.lat) + '" style="width:8em"' + (locked ? ' disabled' : '') + '>') +
			field('lon', 'Longitude', '<input id="set_lon" value="' + esc(p.lon) + '" style="width:8em"' + (locked ? ' disabled' : '') + '>') +
			field('orig', 'NWS office', selectEl('orig')) +
			field('wxZone', 'Forecast zone', selectEl('wxZone')) +
			field('rwrOrig', 'NWS office (weather roundup)', selectEl('rwrOrig')) +
			field('city', 'City (weather roundup)', selectEl('city')) +
			(locked ? '' : '<div class="reader-nav" style="margin-top:16px"><span class="muted" id="set_msg"></span><button type="button" class="btn" id="set_save">Save</button></div>') +
			'</section>');
		themeCard(document.getElementById('setBody'));
		if (config.showEmwinInfo === false) return;

		function fill(id, items, value) {
			var s = document.getElementById('set_' + id); if (!s) return;
			s.innerHTML = items.map(function (it) { return '<option value="' + esc(it[0]) + '">' + esc(it[1]) + '</option>'; }).join('');
			s.value = value; if (s.value != value && value) s.insertAdjacentHTML('afterbegin', '<option value="' + esc(value) + '" selected>' + esc(value) + '</option>');
		}
		function zones(orig) { getJSON('../dataHandler.php?type=settings&dropdown=wxZone&orig=' + encodeURIComponent(orig)).then(function (z) { fill('wxZone', z.map(function (x) { return [x.wxZone, x.wxZone + ' - ' + x.city]; }), p.wxZone); }).catch(function () {}); }
		function cities(rwr) { getJSON('../dataHandler.php?type=settings&dropdown=city&rwrOrig=' + encodeURIComponent(rwr)).then(function (c) { fill('city', c.map(function (x) { return [x, x.toLowerCase().replace(/\b\w/g, function (m) { return m.toUpperCase(); })]; }), p.city); }).catch(function () {}); }
		getJSON('../dataHandler.php?type=settings&dropdown=general').then(function (g) {
			fill('timezone', (g.timezone || []).map(function (x) { return [x, x]; }), p.timezone);
			fill('radarCode', (g.radar || []).map(function (x) { return [x, x]; }), p.radarCode);
			fill('stateAbbr', (g.stateAbbr || []).map(function (x) { return [x, x]; }), p.stateAbbr);
			fill('orig', (g.orig || []).map(function (x) { return [x.orig + x.state, x.state + ' - ' + x.orig]; }), p.orig);
			fill('rwrOrig', (g.rwrOrig || []).map(function (x) { return [x.orig + x.state, x.state + ' - ' + x.orig]; }), p.rwrOrig);
		}).catch(function () {});
		zones(p.orig); cities(p.rwrOrig);
		document.getElementById('set_orig').addEventListener('change', function () { zones(this.value); });
		document.getElementById('set_rwrOrig').addEventListener('change', function () { cities(this.value); });
		document.getElementById('set_profile').addEventListener('change', function () { vgSetCookie('selectedProfile', this.value); renderSettings(); });
		document.getElementById('set_add').addEventListener('click', function () {
			profiles.push(JSON.parse(JSON.stringify(p))); saveProfiles(profiles); vgSetCookie('selectedProfile', profiles.length - 1); renderSettings();
		});
		document.getElementById('set_del').addEventListener('click', function () {
			if (locked || !confirm('Delete this location profile?')) return;
			profiles.splice(sel, 1); saveProfiles(profiles); vgSetCookie('selectedProfile', 0); renderSettings();
		});
		var save = document.getElementById('set_save');
		if (save) save.addEventListener('click', function () {
			['timezone', 'radarCode', 'stateAbbr', 'orig', 'wxZone', 'rwrOrig', 'city', 'lat', 'lon'].forEach(function (k) { profiles[sel][k] = document.getElementById('set_' + k).value.trim(); });
			saveProfiles(profiles);
			// the server checks the profile and resets it if something is not valid
			fetch('../dataHandler.php', { cache: 'no-store' }).then(function () {
				var back = readProfiles()[sel];
				document.getElementById('set_msg').textContent = back && back.wxZone == profiles[sel].wxZone ? 'Saved. Weather and radar pages now use this place.' : 'The station could not use those settings, so they were reset.';
			});
		});
	});
}
// the classic site's theme (the Lab has one look)
function themeCard(root, alone)
{
	root.insertAdjacentHTML('beforeend', '<section class="bul-panel"><h2 class="h3" style="margin-top:0">Classic site theme</h2><p class="muted" style="margin-top:0">How the classic view looks in this browser.</p><select id="set_theme" aria-label="Classic site theme"><option>…</option></select> <a href="../" class="btn ghost">Open the classic view</a></section>');
	getJSON('../dataHandler.php?type=settings&dropdown=theme').then(function (t) {
		var s = document.getElementById('set_theme'); if (!s) return;
		s.innerHTML = Object.keys(t).map(function (k) { return '<option value="' + esc(k) + '">' + esc(t[k]) + '</option>'; }).join('');
		s.value = vgGetCookie('selectedTheme') || config.theme || '';
		s.addEventListener('change', function () { vgSetCookie('selectedTheme', s.value); });
	}).catch(function () {});
}

// ------------------------------------------------------------------ router
function route()
{
	timers.forEach(clearInterval); timers = [];
	var parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
	var page = parts[0] || 'overview';
	document.querySelectorAll('.nav a').forEach(function (a) { a.toggleAttribute('aria-current', a.dataset.route == page); if (a.dataset.route == page) a.setAttribute('aria-current', 'page'); });
	window.scrollTo(0, 0);
	if (page == 'imagery') renderImagery(parts[1], parts[2]);
	else if (page == 'emwin') renderEmwin(parts[1]);
	else if (page == 'weather') renderWeather();
	else if (page == 'space') renderSpace();
	else if (page == 'receivers') renderReceivers();
	else if (page == 'settings') renderSettings();
	else renderOverview();
	document.title = (page == 'overview' ? '' : (page == 'emwin' ? 'EMWIN' : page == 'settings' ? 'Local settings' : page.charAt(0).toUpperCase() + page.slice(1)) + ', ') + 'USradioguy ground station';
}

getJSON(API.preload).then(function (c) { config = c; route(); window.addEventListener('hashchange', route); })
	.catch(function () { main.innerHTML = '<p class="empty">The station’s data feed is not answering. Check that Apache is running, then reload.</p>'; });
})();
