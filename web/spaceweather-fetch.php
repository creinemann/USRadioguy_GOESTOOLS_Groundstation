<?php
/*
 * spaceweather-fetch.php - download the latest space weather images from the internet.
 *
 * Nothing runs on a schedule: the Space Weather page calls this (POST) only when
 * someone presses "Download the latest images". Turned on by the installer question
 * "space weather from the internet" ([spaceweather] internet = true in config.ini).
 *
 * Each image is saved as <prefix><YYYYMMDDHHMMSS>.<ext> in the space weather folder,
 * the names the Space Weather pages (config/solar.ini) already read, so the pages,
 * timelines and 24-hour loops work the same as for a GRB station's images.
 * An image is skipped if the copy saved in the last 10 minutes is still fresh, and
 * files older than 3 days are removed.
 */
header('Content-Type: application/json');
header('Cache-Control: no-store');

function done($code, $data) { http_response_code($code); echo json_encode($data); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') done(405, ['ok' => false, 'error' => 'Use the button on the Space Weather page.']);

$config = @parse_ini_file(__DIR__ . '/config/config.ini', true, INI_SCANNER_RAW);
$sw = $config['spaceweather'] ?? [];
if (empty($sw['internet']) || !in_array(strtolower($sw['internet']), ['1', 'true', 'yes', 'on'], true))
	done(403, ['ok' => false, 'error' => 'Space weather from the internet is turned off. Re-run install.sh and answer yes to turn it on.']);
$dir = rtrim(str_replace('\\', '/', $sw['folder'] ?? ''), '/');
if ($dir === '' || !is_dir($dir) || !is_writable($dir))
	done(500, ['ok' => false, 'error' => 'The space weather folder is missing or the web server cannot write to it: ' . $dir]);
if (!function_exists('curl_init')) done(500, ['ok' => false, 'error' => 'PHP curl is not installed (sudo apt install php-curl).']);

// crop = [pixels off the top, pixels off the bottom]; label = stamp the time and source
$images = [
	['prefix' => 'SDO_193_',        'title' => 'SDO 193 Å',        'url' => 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0193.jpg'],
	['prefix' => 'SDO_171_',        'title' => 'SDO 171 Å',        'url' => 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg'],
	['prefix' => 'SUVI195_',        'title' => 'GOES-18 SUVI 195', 'url' => 'https://www.ssec.wisc.edu/data/geo/images/suvi-goes-18/latest_suvi-goes-18_FE195_sun.jpg', 'crop' => [10, 10], 'label' => true],
	['prefix' => 'geospace_3_day_', 'title' => 'Geospace 3 day',   'url' => 'https://services.swpc.noaa.gov/images/geospace/geospace_3_day.png'],
	['prefix' => 'AURORA_',         'title' => 'Aurora forecast',  'url' => 'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg'],
	['prefix' => 'WSA_ENLIL_',      'title' => 'WSA-ENLIL',        'url' => 'https://services.swpc.noaa.gov/images/animations/enlil/latest.jpg'],
	['prefix' => 'SUVI284_',        'title' => 'GOES-18 SUVI 093/171/284', 'url' => 'https://www.ssec.wisc.edu/data/geo/images/suvi-goes-18/latest_suvi-goes-18_FE093FE171FE284_sun.jpg', 'crop' => [10, 10], 'label' => true],
	['prefix' => 'SUVI303_',        'title' => 'GOES-18 SUVI 195/284/304', 'url' => 'https://www.ssec.wisc.edu/data/geo/images/suvi-goes-18/latest_suvi-goes-18_FE195FE284HE303_sun.jpg', 'crop' => [10, 10], 'label' => true],
	['prefix' => 'SUVI093_',        'title' => 'GOES-18 SUVI 304/171/093', 'url' => 'https://www.ssec.wisc.edu/data/geo/images/suvi-goes-18/latest_suvi-goes-18_HE303FE171FE093_sun.jpg', 'crop' => [10, 10], 'label' => true],
];

// one download at a time, however many people press the button
$lock = fopen($dir . '/.fetch.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) done(429, ['ok' => false, 'error' => 'A download is already running. Try again in a minute.']);
set_time_limit(180);

$now = time();
$result = ['ok' => true, 'saved' => [], 'fresh' => [], 'failed' => []];

foreach ($images as $img) {
	// still fresh? (a copy from the last 10 minutes)
	$latest = 0;
	foreach (glob($dir . '/' . $img['prefix'] . '*') ?: [] as $f) $latest = max($latest, filemtime($f));
	if ($now - $latest < 600) { $result['fresh'][] = $img['title']; continue; }

	$ch = curl_init($img['url']);
	curl_setopt_array($ch, [
		CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
		CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 30,
		CURLOPT_USERAGENT => 'USRadioguy-GOESTOOLS-Groundstation (space weather page)',
	]);
	$bytes = curl_exec($ch);
	$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	$err = curl_error($ch);
	curl_close($ch);
	if ($bytes === false || $code != 200 || strlen($bytes) < 1000) {
		$result['failed'][] = $img['title'] . ': ' . ($err ?: 'HTTP ' . $code);
		continue;
	}
	$info = @getimagesizefromstring($bytes);
	if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) {
		$result['failed'][] = $img['title'] . ': not an image';
		continue;
	}
	$ext = $info[2] == IMAGETYPE_PNG ? 'png' : 'jpg';
	$out = $dir . '/' . $img['prefix'] . gmdate('YmdHis', $now) . '.' . $ext;

	if ((!empty($img['crop']) || !empty($img['label'])) && function_exists('imagecreatefromstring')) {
		$im = @imagecreatefromstring($bytes);
		if ($im) {
			if (!empty($img['crop'])) {
				[$top, $bottom] = $img['crop'];
				$h = imagesy($im) - $top - $bottom;
				if ($h > 50) {
					$c = imagecrop($im, ['x' => 0, 'y' => $top, 'width' => imagesx($im), 'height' => $h]);
					if ($c) { imagedestroy($im); $im = $c; }
				}
			}
			if (!empty($img['label'])) {
				$text = $img['title'] . '  ' . gmdate('Y-m-d H:i', $now) . ' UTC';
				$white = imagecolorallocate($im, 255, 255, 255);
				$shade = imagecolorallocatealpha($im, 0, 0, 0, 50);
				$font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
				$size = max(10, (int) round(imagesx($im) / 70));
				$y = imagesy($im) - 10;
				if (function_exists('imagettftext') && is_file($font)) {
					imagefilledrectangle($im, 0, $y - $size - 10, imagesx($im), imagesy($im), $shade);
					imagettftext($im, $size, 0, 10, $y, $white, $font, $text);
				} else {
					imagefilledrectangle($im, 0, imagesy($im) - 22, imagesx($im), imagesy($im), $shade);
					imagestring($im, 4, 8, imagesy($im) - 19, $text, $white);
				}
			}
			$ok = $ext == 'png' ? imagepng($im, $out) : imagejpeg($im, $out, 90);
			imagedestroy($im);
			if ($ok) { $result['saved'][] = $img['title']; continue; }
		}
	}
	if (file_put_contents($out, $bytes) !== false) $result['saved'][] = $img['title'];
	else $result['failed'][] = $img['title'] . ': could not save';
}

// tidy up: keep 3 days
foreach (glob($dir . '/*.{jpg,png}', GLOB_BRACE) ?: [] as $f)
	if ($now - filemtime($f) > 3 * 86400) @unlink($f);

flock($lock, LOCK_UN);
fclose($lock);
$result['ok'] = count($result['failed']) < count($images);
done(200, $result);
