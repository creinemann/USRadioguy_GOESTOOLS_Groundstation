<?php
/*
 * USRadioguy Lab layout (Nov 2026) - a new front end for Vitality GOES.
 * Reads the same data as the main site (dataHandler.php, station_stats.php,
 * /videos) and changes nothing there. Open at /lab/
 */
$v = function ($f) { return @filemtime(__DIR__ . "/$f"); };   // cache-busting
require_once dirname(__DIR__) . '/station.php';
$station = stationPublic();
$h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES); };
?><!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow">
	<meta name="theme-color" content="#070A14">
	<title><?php echo $h($station['name']); ?></title>
	<link rel="icon" href="../favicon.ico">
	<link rel="stylesheet" href="lab.css?v=<?php echo $v('lab.css'); ?>">
</head>
<body>
	<a class="skip" href="#main">Skip to content</a>
	<header class="masthead">
		<a class="brand" href="#/" aria-label="<?php echo $h($station['name']); ?>, home">
			<img src="logo.png" alt="" width="120" height="50">
			<span><?php echo $h($station['name']); ?><small><?php echo $h($station['location']); ?></small></span>
		</a>
		<nav class="nav" aria-label="Sections">
			<a href="#/" data-route="overview">Overview</a>
			<a href="#/imagery" data-route="imagery">Imagery</a><a href="#/emwin" data-route="emwin">EMWIN</a>
			<a href="#/weather" data-route="weather">Weather</a>
			<a href="#/space" data-route="space">Space weather</a>
			<a href="#/receivers" data-route="receivers">Receivers</a>
		</nav>
		<div class="clocks" aria-label="Current time">
			<div><span class="clock-label">UTC</span><time id="clockUtc">--:--:--</time></div>
			<div><span class="clock-label">Local</span><time id="clockLocal">--:--</time></div>
		</div>
	</header>

	<main id="main" tabindex="-1"></main>

	<footer class="foot">
		<p><?php echo $h($station['footer']); ?>
		Solar imagery courtesy of NASA/SDO and NOAA. Built on <a href="https://github.com/JVital2013/vitality-goes">Vitality GOES</a>. <a href="../">Classic view</a></p>
	</footer>

	<script>window.STATION = <?php echo json_encode($station); ?>;</script>
	<script src="lab-config.js?v=<?php echo $v('lab-config.js'); ?>"></script>
	<script src="lab.js?v=<?php echo $v('lab.js'); ?>"></script>
</body>
</html>
