<?php
/*
 * station.php - station settings for the USRadioguy additions to Vitality GOES.
 * Reads config/station.ini (see config/station.ini.example). The config folder
 * is blocked from the web, so Grafana keys and receiver addresses stay private:
 * stationPublic() only returns what is safe to show in a browser.
 */
function stationSettings()
{
	static $cfg = null;
	if ($cfg !== null) return $cfg;
	$file = __DIR__ . '/config/station.ini';
	$ini = is_file($file) ? parse_ini_file($file, true, INI_SCANNER_TYPED) : [];
	if (!is_array($ini)) $ini = [];

	$cfg = [
		'site' => array_merge([
			'name'         => 'Ground station',
			'location'     => '',
			'credit'       => 'All imagery and data was received by this ground station.',
			'footer'       => 'Imagery received on the GOES HRIT downlink (1694.1 MHz), decoded with goestools.',
			'analytics_id' => '',
		], $ini['site'] ?? []),
		'pc' => array_merge(['disks' => ''], $ini['pc'] ?? []),
		'media' => $ini['media'] ?? [],
		'receivers' => [],
	];
	foreach ($ini as $section => $values) {
		if (strpos($section, 'receiver.') !== 0 || !is_array($values)) continue;
		$id = substr($section, 9);
		$cfg['receivers'][$id] = array_merge([
			'label' => strtoupper($id), 'sat' => '', 'where' => '',
			'host' => '127.0.0.1', 'local' => false,
			'grafana' => '', 'datasource' => 0, 'key' => '',
		], $values);
	}
	return $cfg;
}

// Only browser-safe fields: no hosts, Grafana URLs or keys.
function stationPublic()
{
	$cfg = stationSettings();
	$rx = [];
	foreach ($cfg['receivers'] as $id => $r) $rx[] = ['id' => $id, 'label' => $r['label'], 'sat' => $r['sat'], 'where' => $r['where']];
	return [
		'name' => $cfg['site']['name'], 'location' => $cfg['site']['location'],
		'credit' => $cfg['site']['credit'], 'footer' => $cfg['site']['footer'],
		'receivers' => $rx,
	];
}
