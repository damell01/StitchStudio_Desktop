<?php
declare(strict_types=1);

header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD');
    http_response_code(405);
    exit;
}

// Install this directory one level below public_html. The feed lives beside
// public_html and can only be read through this authenticated endpoint.
$root = dirname(__DIR__, 2) . '/stitch-studio-private';
$hashFile = $root . '/access-key.sha256';
if (!is_readable($hashFile)) {
    http_response_code(503);
    exit;
}
$expected = trim((string) file_get_contents($hashFile));
if (!preg_match('/\A[a-f0-9]{64}\z/', $expected)) {
    http_response_code(503);
    exit;
}
$authorization = ($_SERVER['HTTP_AUTHORIZATION'] ?? '') ?: ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/\ABearer ([a-f0-9]{64})\z/i', $authorization, $match)
    || !hash_equals($expected, hash('sha256', $match[1]))) {
    header('WWW-Authenticate: Bearer');
    http_response_code(401);
    exit;
}

$asset = $_GET['asset'] ?? '';
if (!is_string($asset)) {
    http_response_code(404);
    exit;
}
if ($asset === 'latest.json') {
    $type = 'application/json';
} elseif (preg_match('/\A[0-9]+\.[0-9]+\.[0-9]+\/(windows-x86_64|darwin-(?:aarch64|x86_64))\/stitch-studio-\1\.(exe|app\.tar\.gz|dmg)\z/', $asset, $target)) {
    $windows = $target[1] === 'windows-x86_64';
    if ($windows !== ($target[2] === 'exe')) {
        http_response_code(404);
        exit;
    }
    $type = 'application/octet-stream';
} else {
    http_response_code(404);
    exit;
}

$path = $root . '/feed/' . $asset;
if (!is_file($path) || !is_readable($path)) {
    http_response_code($asset === 'latest.json' ? 204 : 404);
    exit;
}
$file = fopen($path, 'rb');
if ($file === false) {
    http_response_code(503);
    exit;
}
$metadata = fstat($file);
header('Content-Type: ' . $type);
if ($metadata !== false) {
    header('Content-Length: ' . $metadata['size']);
}
if ($method === 'GET') {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    fpassthru($file);
}
fclose($file);
