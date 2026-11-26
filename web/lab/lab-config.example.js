/*
 * lab-config.example.js (copied to lab-config.js by the installer) - satellites and products on the Lab Overview page.
 * Written by scripts/make-site-config.py for the satellites you chose at
 * install time; edit by hand to change the products or their order.
 *
 * Each product is [ id, label ], where id is a section name in
 * config/abi.ini (e.g. [fdGeoColor19]). "rx" is the receiver id from
 * config/station.ini whose status is shown (defaults to the key itself).
 */
window.LAB_SATS = {
	east: { name: 'GOES-19', tab: 'GOES-19 east', lon: '75.2° west', region: 'the Americas and the Atlantic',
		products: [['fdGeoColor19', 'GeoColor'], ['fdNIGHTLUT19', 'Night color'], ['fdch07e_19', 'Shortwave IR'], ['fdch13_19', 'Infrared'], ['fdch02_19', 'Visible'], ['fdch09e_19', 'Water vapor']] }
};
