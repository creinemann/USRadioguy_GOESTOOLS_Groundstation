/*
 * emwin-catalog.js - tsunami and tropical cyclone bulletins from the NWS
 * "EMWIN Text Product Catalog" (rev. 241231, Appendix D), grouped by region.
 * https://www.weather.gov/media/emwin/EMWIN_Text_Product_Catalog_241231.pdf
 *
 * Each viewer ticks the ones they want; the choice is kept in this browser in the
 * same "otheremwin" cookie the classic site's "Load Additional Data" and the Earth
 * Lab use, so it shows up on both. "id" is matched against the 8-character EMWIN
 * file code (…-HAPT31US.TXT). Products the catalog lists as discontinued or "not
 * available" are left out.
 */
window.EMWIN_CATALOG = [
	{ group: 'Tsunami messages', regions: [
		{ name: 'Alaska, British Columbia and U.S. West Coast', short: 'West Coast/AK', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSU(AQ4|K51)US' },
			{ title: 'Tsunami information statements', id: 'TSUK53US' } ] },
		{ name: 'U.S. Atlantic, Gulf of Mexico and Canada', short: 'Atlantic/Gulf', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSU(AT1|ATE)US' },
			{ title: 'Tsunami information statements', id: 'TIBATEUS' } ] },
		{ name: 'U.S. West Coast and Atlantic, in Spanish', short: 'Spanish', items: [
			{ title: 'Spanish tsunami warnings, watches and advisories', id: 'TSUSPNUS' },
			{ title: 'Spanish tsunami information statements', id: 'TIBSPNUS' } ] },
		{ name: 'Hawaii', short: 'HI', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSUW40US' },
			{ title: 'Tsunami information statements', id: 'TSUW42US' } ] },
		{ name: 'American Samoa', short: 'Am. Samoa', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSUPPGUS' },
			{ title: 'Tsunami information statements', id: 'TIBPPGUS' } ] },
		{ name: 'Guam and Northern Mariana Islands', short: 'Guam', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSUGUMUS' },
			{ title: 'Tsunami information statements', id: 'TIBGUMUS' } ] },
		{ name: 'Puerto Rico and Virgin Islands', short: 'PR/VI', items: [
			{ title: 'Tsunami warnings, watches and advisories', id: 'TSU(CAR|CA1)US' },
			{ title: 'Tsunami information statements', id: 'TSUA42US' },
			{ title: 'Spanish tsunami warnings, watches and advisories', id: 'TSUSP1US' },
			{ title: 'Spanish tsunami information statements', id: 'TIBSP1US' } ] },
		{ name: 'Pacific outside the U.S.', short: 'Pacific', items: [
			{ title: 'Tsunami threat messages', id: 'TSUA40US' },
			{ title: 'Tsunami information statements', id: 'TIBA42US' },
			{ title: 'Japan (JMA) Northwest Pacific tsunami advisory', id: 'PACA40US' } ] },
		{ name: 'Caribbean outside the U.S.', short: 'Caribbean', items: [
			{ title: 'Tsunami threat messages', id: 'TSUCAXUS' },
			{ title: 'Tsunami information statements', id: 'TIBCAXUS' } ] },
		{ name: 'Tests', short: 'Test', items: [
			{ title: 'Tsunami test messages', id: 'TST(HEB|PAQ)US' } ] }
	] },
	{ group: 'Hurricanes and tropical storms (U.S.)', regions: [
		{ name: 'Atlantic, Caribbean and Gulf of Mexico (National Hurricane Center)', short: 'Atlantic', items: [
			{ title: 'Public advisories', id: 'HAPT3[1-5]US' },
			{ title: 'Forecast advisories', id: 'HAFT2[1-5]US' },
			{ title: 'Storm discussions', id: 'HADT4[1-5]US' },
			{ title: 'Storm updates', id: 'TCUAT[1-5]US' },
			{ title: 'Wind speed probabilities', id: 'PWSAT[1-5]US' },
			{ title: 'Tropical weather outlook', id: 'HAWT20US' },
			{ title: 'Tropical weather summary', id: 'HAST30US' },
			{ title: 'Tropical weather discussion', id: 'HATT20US' } ] },
		{ name: 'Eastern North Pacific (National Hurricane Center)', short: 'E. Pacific', items: [
			{ title: 'Public advisories', id: 'HEPZ3[1-5]US' },
			{ title: 'Forecast advisories', id: 'HEFZ2[1-5]US' },
			{ title: 'Storm discussions', id: 'HEDZ4[1-5]US' },
			{ title: 'Storm updates', id: 'TCUEP[1-5]US' },
			{ title: 'Wind speed probabilities', id: 'PWSEP[1-5]US' },
			{ title: 'Tropical weather outlook', id: 'HEWZ20US' },
			{ title: 'Tropical weather summary', id: 'HNSNHCUS' },
			{ title: 'Tropical weather discussion', id: 'HETNHCUS' } ] },
		{ name: 'Central Pacific (Central Pacific Hurricane Center, Honolulu)', short: 'C. Pacific', items: [
			{ title: 'Public and forecast advisories', id: 'HNPA3[1-5]US' },
			{ title: 'Wind speed probabilities', id: 'PWSCP[1-5]US' } ] }
	] },
	{ group: 'Tropical cyclone notices from other countries', regions: [
		{ name: 'Caribbean and Central America', short: '', items: [
			{ title: 'Antigua and Barbuda', id: '(SPS|CFW)CA3AT' },
			{ title: 'Bahamas', id: '(SPS|CFW)BA3BA' },
			{ title: 'Barbados', id: '(SPS|CFW)CA3BR' },
			{ title: 'Belize', id: '(SPS|CFW)CA3BH' },
			{ title: 'Colombia', id: '(SPSCO1CB|HCDIR1CO)' },
			{ title: 'Costa Rica', id: '(SPS|CFW)CA3CS' },
			{ title: 'Cuba', id: '(SPS|CFW)CA3CU' },
			{ title: 'Dominican Republic', id: '(SPS|CFW)CA3DR' },
			{ title: 'Guadeloupe (France)', id: '(SPS|CFW)MF3MF' },
			{ title: 'Guatemala', id: '(SPS|CFW)CA3GU' },
			{ title: 'Honduras', id: '(SPS|CFW)CA3HO' },
			{ title: 'Jamaica', id: '(SPS|CFW)CA3JM' },
			{ title: 'Martinique (France)', id: '(SPS|CFW)MR3MR' },
			{ title: 'Nicaragua', id: '(SPS|CFW)CA3NK' },
			{ title: 'Panama', id: '(SPS|CFW)CA3PM' },
			{ title: 'Trinidad and Tobago', id: '(SPS|CFW)CA3TD' } ] },
		{ name: 'Mexico', short: '', items: [
			{ title: 'Mexico', id: '(SPS|CFW)MX[12]MX' } ] },
		{ name: 'Canada (Canadian Hurricane Centre)', short: 'Canada', items: [
			{ title: 'Hurricane information, warnings and discussions (English)', id: '(SPS|HAF|HAD|SUM)N3[1-3]CN' },
			{ title: 'Hurricane information, warnings and discussions (French)', id: '(SPS|HAF|HAD|SUM)N4[1-3]CN' } ] }
	] }
];

// --- shared cookie helpers (same format as the classic site's "Load Additional Data") ---
window.emwinUserCards = function ()
{
	var c = (document.cookie.match(/(?:^|;\s*)otheremwin=([^;]*)/) || [])[1];
	if (!c) return [];
	try { c = decodeURIComponent(c); } catch (e) { return []; }
	return c.split('~').map(function (card) {
		var p = card.split('!'); if (p.length != 4) return null;
		var id; try { id = atob(p[0].replace(/-/g, '=')); } catch (e) { return null; }
		return { identifier: id, title: p[1], format: +p[2] ? 'paragraph' : 'formatted', truncate: p[3] };
	}).filter(Boolean);
};
window.emwinSaveUserCards = function (cards)
{
	var v = cards.map(function (b) {
		return [btoa(b.identifier).replace(/=/g, '-'), String(b.title).replace(/[!~<>]/g, ''), b.format == 'formatted' ? 0 : 1, b.truncate || 0].join('!');
	}).join('~');
	if (v.length > 3800) return false;   // a browser keeps at most about 4 KB per cookie
	var host = location.hostname, dom = /^[\d.]+$/.test(host) || host.indexOf('.') < 0 ? '' : ';domain=.' + host;
	if (v) document.cookie = 'otheremwin=' + encodeURIComponent(v) + ';expires=' + new Date(Date.now() + 365 * 864e5).toUTCString() + ';path=/' + dom;
	else document.cookie = 'otheremwin=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + dom;
	return true;
};
// identifiers as the catalog writes them, wrapped so "A|B" stays one pattern
window.emwinCatalogId = function (id) { return id.charAt(0) == '(' && id.slice(-1) == ')' && id.indexOf(')') == id.length - 1 ? id : '(' + id + ')'; };
window.emwinCatalogTitle = function (region, item) { return region.short ? region.short + ': ' + item.title : item.title; };

// --- a self-contained picker (used on the classic site's Other EMWIN page) ---
window.emwinCatalogPicker = function (target)
{
	var have = {}; emwinUserCards().forEach(function (b) { have[b.identifier] = 1; });
	var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
	var html = '<p style="margin-top:0">Tick the bulletins you want to see; they are saved in this browser only and appear as cards on this page and in the Earth Lab. Messages show up only when the NWS sends them (for example during a hurricane or tsunami).</p>';
	EMWIN_CATALOG.forEach(function (g) {
		html += '<h3 style="margin:18px 0 6px">' + esc(g.group) + '</h3>';
		g.regions.forEach(function (r) {
			html += '<div style="margin:6px 0 10px"><b>' + esc(r.name) + '</b>';
			r.items.forEach(function (it) {
				var id = emwinCatalogId(it.id);
				html += '<label style="display:block;margin:3px 0 3px 12px;cursor:pointer"><input type="checkbox" data-id="' + esc(id) + '" data-title="' + esc(emwinCatalogTitle(r, it)) + '"' + (have[id] ? ' checked' : '') + '> ' + esc(it.title) + '</label>';
			});
			html += '</div>';
		});
	});
	html += '<input type="button" value="Save" style="width:100%;margin-top:10px" id="emwinCatalogSave">';
	target.innerHTML = html;
	target.querySelector('#emwinCatalogSave').addEventListener('click', function () {
		var cards = emwinUserCards();
		target.querySelectorAll('input[data-id]').forEach(function (cb) {
			var at = cards.findIndex(function (b) { return b.identifier == cb.dataset.id; });
			if (cb.checked && at < 0) cards.push({ identifier: cb.dataset.id, title: cb.dataset.title, format: 'paragraph', truncate: 0 });
			if (!cb.checked && at >= 0) cards.splice(at, 1);
		});
		if (!emwinSaveUserCards(cards)) { alert('That is too many bulletins to remember in this browser. Untick a few and save again.'); return; }
		location.reload();
	});
};
