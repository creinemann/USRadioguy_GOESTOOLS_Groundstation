<?php
/*
 * station_stats.php - Ground Station HUD data feed (USRadioguy addition)
 * Written November 2026 as an add-on to Vitality GOES (GPL v3).
 *
 * Returns JSON for the "Ground Station" page:
 *   ?part=goes  -> live goesrecv stats from the Raspberry Pi
 *   ?part=pc    -> this PC's CPU / RAM / GPU / disks / uptime
 *
 * goesrecv publishes its stats with nanomsg (see goesrecv.conf):
 *   [demodulator.stats_publisher] bind = "tcp://0.0.0.0:6001"  (gain, frequency, omega)
 *   [decoder.stats_publisher]     bind = "tcp://0.0.0.0:6002"  (viterbi, reed-solomon, ok)
 * nanomsg's TCP format is simple, so this file talks to it directly -
 * nothing extra needs installing on the Pi or this PC.
 *
 * Results are cached for a few seconds so any number of viewers
 * only causes one connection to the Pi.
 */

// ======================= SETTINGS =======================
// Receivers, Grafana keys and disks come from config/station.ini
// (see config/station.ini.example). Nothing station-specific lives here.
require_once __DIR__ . '/station.php';
$cfg = stationSettings();
$stations = $cfg['receivers'];
$disks = array_values(array_filter(array_map('trim', explode(',', (string)$cfg['pc']['disks']))));
$demodPort    = 6001;
$decoderPort  = 6002;
$sampleSecs   = 1.2;      // how long to listen each time
$goesCacheSec = 3;
$pcCacheSec   = 5;
$piCacheSec   = 10;
$historyMins  = 60;            // Viterbi / packet-rate history charts
$historyCache = 30;
// ========================================================

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$part = isset($_GET['part']) ? $_GET['part'] : 'goes';
if (!in_array($part, ['goes', 'pc', 'pi', 'history'], true)) { http_response_code(400); echo '{"error":"bad part"}'; exit; }

if (!$stations && $part !== 'pc') { echo json_encode(['online' => false, 'error' => 'no receivers set in config/station.ini']); exit; }
$stId = isset($_GET['st']) && isset($stations[$_GET['st']]) ? $_GET['st'] : array_key_first($stations ?: ['none' => 0]);
$st = $stations[$stId] ?? null;
$cacheFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "usrg_station_{$part}" . ($part === 'pc' ? '' : "_$stId") . ".json";
$maxAge = ['goes' => $goesCacheSec, 'pi' => $piCacheSec, 'pc' => $pcCacheSec, 'history' => $historyCache][$part];
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < $maxAge) { readfile($cacheFile); exit; }

// only one request refreshes at a time; others get the last copy
$lock = fopen($cacheFile . '.lock', 'c');
if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) {
	if (is_file($cacheFile)) { readfile($cacheFile); exit; }
	flock($lock, LOCK_EX);
}

$noKey = ['online' => false, 'error' => 'no Grafana key set for this station'];
$hasKey = $st && $st['key'] !== '' && $st['grafana'] !== '';
if ($part === 'goes')        $result = goesStats($st['host'], $demodPort, $decoderPort, $sampleSecs);
elseif ($part === 'pi')      $result = $hasKey ? piStats($st['grafana'], $st['key'], $st['datasource']) : (!empty($st['local']) ? localPiStats($disks) : $noKey);
elseif ($part === 'history') $result = $hasKey ? historyStats($st['grafana'], $st['key'], $st['datasource'], $historyMins) : $noKey;
else                         $result = pcStats($disks);
if ($part !== 'pc') { $result['station'] = $stId; $result['label'] = $st['label']; }
$result['time'] = time();
$json = json_encode($result);
file_put_contents($cacheFile, $json);
if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
echo $json;
exit;

// ------------------------------------------------------------------
// nanomsg SUB over TCP: send an 8-byte hello ("\0SP\0" + protocol 33 = SUB),
// read the publisher's hello, then each message is an 8-byte big-endian
// length followed by the message (here, one JSON object).
function goesStats($host, $demodPort, $decoderPort, $secs)
{
	$out = ['online' => false, 'demod' => null, 'decoder' => null, 'errors' => []];
	$socks = [];
	foreach (['demod' => $demodPort, 'decoder' => $decoderPort] as $name => $port) {
		$s = @stream_socket_client("tcp://$host:$port", $errno, $errstr, 1.5);
		if (!$s) { $out['errors'][] = "$name ($port): $errstr"; continue; }
		stream_set_blocking($s, false);
		fwrite($s, "\x00SP\x00\x00\x21\x00\x00");
		$socks[$name] = ['s' => $s, 'buf' => '', 'hello' => false, 'msgs' => []];
	}
	if (!$socks) return $out;

	$start = microtime(true);
	while (($left = $start + $secs - microtime(true)) > 0) {
		$read = array_map(function ($x) { return $x['s']; }, $socks); $w = $e = null;
		if (@stream_select($read, $w, $e, 0, (int)($left * 1e6)) < 1) continue;
		foreach ($socks as $name => &$c) {
			if (!in_array($c['s'], $read, true)) continue;
			$data = fread($c['s'], 65536);
			if ($data === '' || $data === false) { if (feof($c['s'])) $out['errors'][] = "$name: closed by Pi"; continue; }
			$c['buf'] .= $data;
			if (!$c['hello']) {
				if (strlen($c['buf']) < 8) continue;
				$c['buf'] = substr($c['buf'], 8); $c['hello'] = true;
			}
			while (strlen($c['buf']) >= 8) {
				$len = unpack('J', substr($c['buf'], 0, 8))[1];
				if ($len > 1048576) { $c['buf'] = ''; break; }       // garbage - resync next time
				if (strlen($c['buf']) < 8 + $len) break;
				$msg = json_decode(substr($c['buf'], 8, $len), true);
				$c['buf'] = substr($c['buf'], 8 + $len);
				if (is_array($msg)) $c['msgs'][] = $msg;
			}
		}
		unset($c);
	}
	$elapsed = max(0.001, microtime(true) - $start);
	foreach ($socks as $c) fclose($c['s']);

	if (isset($socks['demod']) && $socks['demod']['msgs']) {
		$m = $socks['demod']['msgs'];
		$avg = function ($k) use ($m) { $v = array_column($m, $k); return $v ? array_sum($v) / count($v) : null; };
		$out['demod'] = ['gain' => $avg('gain'), 'frequency' => $avg('frequency'), 'omega' => $avg('omega'), 'samples' => count($m)];
	}
	if (isset($socks['decoder'])) {
		$m = $socks['decoder']['msgs'];
		$n = count($m);
		$ok = $n ? array_sum(array_map(function ($x) { return !empty($x['ok']) ? 1 : 0; }, $m)) : 0;
		$vit = array_column($m, 'viterbi_errors');
		$rs  = array_map(function ($x) { return isset($x['reed_solomon_errors']) && $x['reed_solomon_errors'] > 0 ? $x['reed_solomon_errors'] : 0; }, $m);
		$out['decoder'] = [
			'packetsPerSec' => $n / $elapsed,
			'okPercent'     => $n ? 100 * $ok / $n : 0,
			'viterbiAvg'    => $vit ? array_sum($vit) / count($vit) : null,
			'viterbiMax'    => $vit ? max($vit) : null,
			'rsPerSec'      => array_sum($rs) / $elapsed,
			'dropped'       => $n - $ok,
			'packets'       => $n,
		];
	}
	$out['online'] = ($out['decoder'] && $out['decoder']['packets'] > 0) || ($out['demod'] !== null);
	$out['locked'] = $out['decoder'] && $out['decoder']['packets'] > 0 && $out['decoder']['okPercent'] > 50;
	return $out;
}

// ------------------------------------------------------------------
// Ask Grafana's InfluxDB data source a question. Grafana sometimes gives the
// data source a new ID number (the GOES-19 Pi went from 1071 to 1072), so if the
// ID in the settings no longer works, look up the current one by asking Grafana
// for its InfluxDB "telegraf" data source, remember it, and try again.
function grafanaQuery($url, $key, $dsId, $q, $timeout)
{
	$ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "Authorization: Bearer $key\r\n", 'ignore_errors' => true]]);
	$memo = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'usrg_grafana_ds_' . md5($url) . '.txt';
	if (is_file($memo) && ($m = (int)trim((string)@file_get_contents($memo))) > 0) $dsId = $m;
	$ask = function ($id) use ($url, $q, $ctx) {
		return json_decode((string)@file_get_contents("$url/api/datasources/proxy/$id/query?db=telegraf&epoch=s&q=" . rawurlencode($q), false, $ctx), true);
	};
	$j = $ask($dsId);
	if (is_array($j) && isset($j['results'])) return $j;
	// Find the current ID (frontend settings are readable with a Viewer key)
	$fs = json_decode((string)@file_get_contents("$url/api/frontend/settings", false, $ctx), true);
	foreach (($fs['datasources'] ?? []) as $d) {
		if (($d['type'] ?? '') === 'influxdb' && ($d['database'] ?? '') === 'telegraf' && isset($d['id']) && (int)$d['id'] !== (int)$dsId) {
			$j = $ask((int)$d['id']);
			if (is_array($j) && isset($j['results'])) { @file_put_contents($memo, (int)$d['id']); return $j; }
		}
	}
	return $j;
}

// ------------------------------------------------------------------
// The Pi's own health: Telegraf already stores it in InfluxDB, and Grafana
// can query InfluxDB for us. Only the last 5 minutes are asked for.
function piStats($url, $key, $dsId)
{
	$q = implode(';', [
		"SELECT last(\"usage_idle\") FROM \"cpu\" WHERE \"cpu\"='cpu-total' AND time > now()-5m",
		"SELECT last(\"temp\") FROM \"temp\" WHERE \"sensor\"='cpu_thermal_input' AND time > now()-5m",
		"SELECT last(\"used_percent\"), last(\"total\") FROM \"mem\" WHERE time > now()-5m",
		"SELECT last(\"load1\"), last(\"uptime\"), last(\"n_cpus\") FROM \"system\" WHERE time > now()-5m",
		"SELECT last(\"used_percent\"), last(\"free\"), last(\"total\") FROM \"disk\" WHERE time > now()-5m GROUP BY \"path\"",
	]);
	$ctx = stream_context_create(['http' => ['timeout' => 4, 'header' => "Authorization: Bearer $key\r\n", 'ignore_errors' => true]]);
	$j = grafanaQuery($url, $key, $dsId, $q, 4);
	if (!is_array($j) || !isset($j['results'])) return ['online' => false, 'error' => 'Grafana not reachable or key refused'];
	$val = function ($i, $col = 1) use ($j) { return $j['results'][$i]['series'][0]['values'][0][$col] ?? null; };

	$out = ['online' => false];
	$idle = $val(0);
	if ($idle !== null) { $out['cpu'] = round(100 - $idle, 1); $out['online'] = true; }
	$out['temp']     = $val(1);
	$out['memPct']   = $val(2);
	$out['memTotal'] = $val(2, 2) ? round($val(2, 2) / 1073741824, 1) : null;
	$out['load1']    = $val(3);
	$out['uptime']   = $val(3, 2);
	$out['cores']    = $val(3, 3);
	// the disk with the most space is the Pi's main card/drive
	$best = null;
	foreach ($j['results'][4]['series'] ?? [] as $sr) {
		$v = $sr['values'][0];
		if ($best === null || $v[3] > $best[3]) $best = $v;
	}
	if ($best) { $out['diskPct'] = $best[1]; $out['diskFree'] = round($best[2] / 1073741824, 1); }
	return $out;
}

// ------------------------------------------------------------------
// Last hour of decoder stats from Telegraf, one point per minute.
// packets_ok is logged as a count per 10-second batch, so /10 = packets/sec.
function historyStats($url, $key, $dsId, $mins)
{
	$q = implode(';', [
		"SELECT mean(\"mean\") FROM \"viterbi_errors\" WHERE time > now()-{$mins}m GROUP BY time(1m) fill(none)",
		"SELECT mean(\"value\")/10 FROM \"packets_ok\" WHERE time > now()-{$mins}m GROUP BY time(1m) fill(none)",
	]);
	$ctx = stream_context_create(['http' => ['timeout' => 5, 'header' => "Authorization: Bearer $key\r\n", 'ignore_errors' => true]]);
	$j = grafanaQuery($url, $key, $dsId, $q, 5);
	if (!is_array($j) || !isset($j['results'])) return ['online' => false, 'error' => 'Grafana not reachable or key refused'];
	$series = function ($i) use ($j) {
		$out = [];
		foreach ($j['results'][$i]['series'][0]['values'] ?? [] as $v) if ($v[1] !== null) $out[] = [$v[0], round($v[1], 2)];
		return $out;
	};
	return ['online' => true, 'minutes' => $mins, 'viterbi' => $series(0), 'packets' => $series(1)];
}

// ------------------------------------------------------------------
function pcStats($disks)
{
	$out = ['host' => php_uname('n'), 'os' => ucfirst(php_uname('v'))];   // e.g. "Build 26200 (Windows 11)" 
	if (PHP_OS_FAMILY !== 'Windows') return $out + linuxStats($disks ?: ['/']);

	$diskList = "'" . implode("','", $disks) . "'";
	$ps = <<<PS
\$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
\$os  = Get-CimInstance Win32_OperatingSystem
\$d = foreach(\$l in @($diskList)){ \$x = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='\$l'"; if(\$x){ @{ name=\$l; free=[math]::Round(\$x.FreeSpace/1GB,1); size=[math]::Round(\$x.Size/1GB,1) } } }
@{ cpu=\$cpu; cpuName=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim();
   memTotal=[math]::Round(\$os.TotalVisibleMemorySize/1MB,1); memFree=[math]::Round(\$os.FreePhysicalMemory/1MB,1);
   uptime=[int]((Get-Date) - \$os.LastBootUpTime).TotalSeconds; disks=@(\$d) } | ConvertTo-Json -Compress -Depth 4
PS;
	$enc = base64_encode(mb_convert_encoding($ps, 'UTF-16LE', 'UTF-8'));
	$data = json_decode((string)shell_exec("powershell -NoProfile -NonInteractive -EncodedCommand $enc"), true);
	if (is_array($data)) $out += $data;

	// NVIDIA GPU, if there is one
	$smi = 'nvidia-smi';
	foreach (['C:\\Windows\\System32\\nvidia-smi.exe', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'] as $p) if (is_file($p)) { $smi = "\"$p\""; break; }
	$line = trim((string)@shell_exec("$smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>NUL"));
	if ($line !== '' && strpos($line, ',') !== false) {
		$g = array_map('trim', explode(',', strtok($line, "\n")));
		$out['gpu'] = ['name' => $g[0], 'util' => (float)$g[1], 'temp' => (float)$g[2], 'memUsed' => (float)$g[3], 'memTotal' => (float)$g[4]];
	}
	return $out;
}

// ------------------------------------------------------------------
// Linux (Raspberry Pi) health read straight from /proc and /sys.
function cpuPercent()
{
	$read = function () { $f = @file('/proc/stat'); if (!$f) return null; $v = preg_split('/\s+/', trim($f[0])); array_shift($v); return array_map('intval', $v); };
	$a = $read(); usleep(250000); $b = $read();
	if (!$a || !$b) return null;
	$idle = ($b[3] + ($b[4] ?? 0)) - ($a[3] + ($a[4] ?? 0));
	$total = array_sum($b) - array_sum($a);
	return $total > 0 ? round(100 * (1 - $idle / $total), 1) : null;
}
function linuxStats($disks)
{
	$out = ['cpu' => cpuPercent()];
	if (is_readable('/proc/cpuinfo') && preg_match('/^(model name|Model)\s*:\s*(.+)$/m', (string)@file_get_contents('/proc/cpuinfo'), $m)) $out['cpuName'] = trim($m[2]);
	$mem = [];
	foreach ((array)@file('/proc/meminfo') as $l) if (preg_match('/^(\w+):\s+(\d+)/', $l, $m)) $mem[$m[1]] = (int)$m[2];
	if (isset($mem['MemTotal'])) { $out['memTotal'] = round($mem['MemTotal'] / 1048576, 1); $out['memFree'] = round(($mem['MemAvailable'] ?? $mem['MemFree']) / 1048576, 1); }
	$up = (float)@file_get_contents('/proc/uptime'); if ($up) $out['uptime'] = (int)$up;
	$out['disks'] = [];
	foreach ($disks as $d) { $t = @disk_total_space($d); $f = @disk_free_space($d); if ($t) $out['disks'][] = ['name' => $d, 'free' => round($f / 1073741824, 1), 'size' => round($t / 1073741824, 1)]; }
	$t = @file_get_contents('/sys/class/thermal/thermal_zone0/temp'); if ($t !== false && $t !== '') $out['temp'] = round((int)$t / 1000, 1);
	return $out;
}
// Same fields as piStats(), for a website running on the receiver Pi itself.
function localPiStats($disks)
{
	$l = linuxStats($disks ?: ['/']);
	$out = ['online' => $l['cpu'] !== null, 'cpu' => $l['cpu'], 'temp' => $l['temp'] ?? null];
	if (isset($l['memTotal'])) { $out['memTotal'] = $l['memTotal']; $out['memPct'] = round(100 * (1 - $l['memFree'] / max(0.01, $l['memTotal'])), 1); }
	$la = explode(' ', (string)@file_get_contents('/proc/loadavg')); $out['load1'] = isset($la[0]) ? (float)$la[0] : null;
	$out['uptime'] = $l['uptime'] ?? null;
	$out['cores'] = function_exists('shell_exec') ? (int)trim((string)@shell_exec('nproc 2>/dev/null')) : null;
	if (!empty($l['disks'])) { $d = $l['disks'][0]; $out['diskPct'] = round(100 * (1 - $d['free'] / max(0.01, $d['size'])), 1); $out['diskFree'] = $d['free']; }
	return $out;
}
