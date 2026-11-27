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
	video: function (v) { return '../videos/' + encodeURIComponent(v); },
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
	chips.innerHTML = sat.products.map(function (p, i) { return '<button type="button" aria-pressed="' + (i == state.product) + '" data-i="' + i + '">' + esc(p[1]) + (/GeoColor|himgeo/.test(p[0]) ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;background:#2e7d32;color:#fff;font-size:10px;font-weight:700;letter-spacing:.5px;vertical-align:middle">NEW</span>' : '') + '</button>'; }).join('');
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
			if (!playing) { stage.play(API.video(it.videoPath), function () { b.querySelector('span').textContent = 'Loop not ready yet'; }); b.querySelector('span').textContent = 'Show still image'; }
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
	if (!list.length) { body.innerHTML = '<p class="empty">No EMWIN bulletins are configured.</p>'; return; }
	body.innerHTML = '<p class="caption">Reading the latest bulletins…</p>';
	getJSON('../dataHandler.php?type=metadata&id=otherEmwin').then(function (m)
	{
		var msgs = m.system || [];
		body.innerHTML =
			'<div class="accordion">' + list.map(function (b, i) {
				var n = (msgs[i] || []).length;
				return '<section class="acc' + (n ? '' : ' none') + '">' +
					'<h2><button type="button" class="acc-btn" aria-expanded="false" aria-controls="acc' + i + '" data-i="' + i + '"' + (n ? '' : ' disabled') + '>' +
						'<span class="acc-title">' + esc(titleCaseKeep(b.title)) + '</span>' +
						'<span class="acc-count">' + (n ? n + (n == 1 ? ' message' : ' messages') : 'No messages') + '</span>' +
						'<svg class="acc-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button></h2>' +
					'<div class="acc-panel" id="acc' + i + '" hidden></div></section>';
			}).join('') + '</div>' +
			(m.satelliteTleDate ? '<p class="caption" style="margin-top:28px">Orbit data for ' + (m.satelliteTle || []).length + ' satellites last received ' + esc(m.satelliteTleDate) + '.</p>' : '');

		function showMsg(panel, i, at)
		{
			var all = msgs[i] || [];
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
function renderSpace()
{
	var s = config.categories.solar;
	main.innerHTML =
	'<header class="page-head"><h1 class="display">Space weather</h1><p class="lede">The Sun in several wavelengths, plus the forecasts for aurora and geomagnetic storms. Choose an image to step through its history.</p></header>' +
	(s ? '<div class="gallery">' + Object.keys(s.data).map(function (k) {
		return '<a href="#/imagery/solar/' + enc(k) + '"><div class="media"><img loading="lazy" alt="" src="' + API.img('solar', k, 480) + '"></div><h2 class="h3">' + esc(s.data[k].title) + '</h2></a>';
	}).join('') + '</div>' : '<p class="empty">No space weather products are configured.</p>');
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
	else renderOverview();
	document.title = (page == 'overview' ? '' : (page == 'emwin' ? 'EMWIN' : page.charAt(0).toUpperCase() + page.slice(1)) + ', ') + 'USradioguy ground station';
}

getJSON(API.preload).then(function (c) { config = c; route(); window.addEventListener('hashchange', route); })
	.catch(function () { main.innerHTML = '<p class="empty">The station’s data feed is not answering. Check that Apache is running, then reload.</p>'; });
})();
