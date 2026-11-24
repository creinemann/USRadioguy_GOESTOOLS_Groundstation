<?php
/*
 * lab/img.php - USradioguy "Lab" layout image helper (Nov 2026)
 * Serves a resized, cached copy of any Vitality GOES image, so the new
 * layout loads quickly (a GOES full-disk original is 10-16 MB).
 *
 *   img.php?id=abi&subid=fd19&w=1600                newest image
 *   img.php?id=abi&subid=fd19&w=960&t=1795370000    a specific frame
 *
 * Uses Vitality's own config and file-matching functions, so it finds
 * exactly the same files the main site does. Resized copies are kept in
 * the system temp folder and reused until the original changes.
 */
$programPath = dirname(__DIR__);
require_once("$programPath/functions.php");
$config = loadConfig();
ini_set('display_errors', 'Off');
set_time_limit(60);

$allowedWidths = [320, 480, 960, 1600, 2400];
$id  = $_GET['id']    ?? '';
$sub = $_GET['subid'] ?? '';
$w   = (int)($_GET['w'] ?? 960);
$t   = isset($_GET['t']) ? (int)$_GET['t'] : 0;
if (!in_array($w, $allowedWidths, true)) $w = 960;

if (!isset($config['categories'][$id]['data'][$sub])) { http_response_code(404); exit; }
$item = $config['categories'][$id]['data'][$sub];
if (!is_dir($item['path'])) { http_response_code(404); exit; }

// ---- find the file (same rules as dataHandler.php) ----
$fmt = getFormatByMode($item['mode'], $item['filter']);
$best = null; $bestTs = 0;
foreach (preg_grep($fmt['regex'], scandir_recursive($item['path'], $item['fast'])) as $file) {
	if (!preg_match($fmt['regex'], $file, $m)) continue;
	$dt = DateTime::createFromFormat($fmt['dateFormat'], $m['date'], new DateTimeZone('UTC'));
	if ($dt === false) continue;
	$ts = $dt->getTimestamp();
	if ($t) { if ($ts === $t) { $best = $file; $bestTs = $ts; break; } }
	elseif ($ts > $bestTs) { $best = $file; $bestTs = $ts; }
}
if ($best === null || !is_file($best)) { http_response_code(404); exit; }

// ---- cached resized copy ----
$cacheDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'usrg_lab_img';
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0777, true);
$mtime = filemtime($best);
$cacheFile = $cacheDir . DIRECTORY_SEPARATOR . md5($best . '|' . $mtime . '|' . $w) . '.jpg';

$etag = '"' . md5($best . $mtime . $w) . '"';
header('Cache-Control: public, max-age=' . ($t ? 604800 : 120));   // a specific frame never changes
header('ETag: ' . $etag);
header('X-Image-Time: ' . $bestTs);
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }

if (!is_file($cacheFile)) {
	$info = @getimagesize($best);
	if (!$info) { http_response_code(415); exit; }
	[$ow, $oh] = $info;
	if ($ow <= $w) {
		// already small (EMWIN, radar...) - send the original as-is
		header('Content-Type: ' . $info['mime']);
		header('Content-Length: ' . filesize($best));
		readfile($best);
		exit;
	}
	$src = @imagecreatefromstring(file_get_contents($best));
	if (!$src) { http_response_code(415); exit; }
	$h = (int)round($oh * $w / $ow);
	$dst = imagecreatetruecolor($w, $h);
	imagecopyresampled($dst, $src, 0, 0, 0, 0, $w, $h, $ow, $oh);
	imagedestroy($src);
	imagejpeg($dst, $cacheFile . '.part', 84);
	imagedestroy($dst);
	@rename($cacheFile . '.part', $cacheFile);

	// keep the cache tidy: drop copies not used for 3 days (checked now and then)
	if (mt_rand(1, 50) === 1) foreach (glob($cacheDir . DIRECTORY_SEPARATOR . '*.jpg') as $old) if (filemtime($old) < time() - 259200) @unlink($old);
}
header('Content-Type: image/jpeg');
header('Content-Length: ' . filesize($cacheFile));
readfile($cacheFile);
