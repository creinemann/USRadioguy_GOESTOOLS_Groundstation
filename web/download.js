/*
 * Copyright 2023-2026 Carl Reinemann, USRadioguy.com
 * This software is licensed under the GNU General Public License
 *
 * This file written as an addendum to Vitality GOES. the original Vitality GOES can be found here https://github.com/JVital2013/vitality-goes
 * download.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * <http://www.gnu.org/licenses/>.
 *
 * Imagery from the Solar Dynamic Observatory is courtesy of NASA / SDO
 * Imagery from the NOAA GOES Satellite is courtesy of the SSEC at wsc.edu
 * This imagery can only be used for educational and not for profit use!
 * SHOWcast is open source software and is a part of GEOnetCast
 * Additional Data comes from the NOAA Space Weather Prediction Center
 *
 * Revised November 2026:
 *  - The list of source URLs now lives only in download_media.php on the
 *    server. This file just asks the server to refresh.
 *  - No longer needs jQuery, and finds download_media.php next to this file
 *    no matter which Vitality page is open.
 *  - Asks at most once per 10 minutes per browser (the server also limits
 *    itself, so many visitors can't pile up downloads).
 */

// Ask the server to refresh the latest SDO / SUVI / SWPC media in the background
(function () {
	var MIN_MINUTES = 10;
	var endpoint = new URL('download_media.php', document.currentScript ? document.currentScript.src : location.href).href;

	try {
		var last = parseInt(localStorage.getItem('usrg_mediaRefresh') || '0', 10);
		if (Date.now() - last < MIN_MINUTES * 60000) return;
		localStorage.setItem('usrg_mediaRefresh', String(Date.now()));
	} catch (e) { /* storage blocked - the server-side limit still applies */ }

	fetch(endpoint, { method: 'POST', keepalive: true })
		.then(function (r) { return r.text().then(function (t) { console.log('[media refresh] HTTP ' + r.status + '\n' + t); }); })
		.catch(function (err) { console.warn('[media refresh] request failed:', err); });
})();
