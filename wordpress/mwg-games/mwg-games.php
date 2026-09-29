<?php
/**
 * Plugin Name: Mingwei Games
 * Description: Account-backed platform game records, replay validation and portable exports.
 * Version: 1.0.3
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/simulation.php';
const MWG_APP = 'https://games.mingweiyang.com';
const MWG_ORIGINS = [MWG_APP, 'https://sunnysunny3145.github.io', 'http://localhost:4173'];

function mwg_table(string $name): string {
    global $wpdb;
    return $wpdb->prefix . 'mwg_' . $name;
}

function mwg_activate(): void {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $charset = $wpdb->get_charset_collate();
    $players = mwg_table('players');
    $limits = mwg_table('limits');
    dbDelta("CREATE TABLE $players (
        player_id char(36) NOT NULL,
        user_id bigint(20) unsigned NOT NULL,
        display_name varchar(24) NOT NULL,
        best_score int unsigned NOT NULL DEFAULT 0,
        best_ticks int unsigned NOT NULL DEFAULT 0,
        completed_runs int unsigned NOT NULL DEFAULT 0,
        run_id char(36) DEFAULT NULL,
        run_started bigint unsigned NOT NULL DEFAULT 0,
        last_result text DEFAULT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (player_id),
        UNIQUE KEY user_id (user_id),
        KEY leaderboard (best_score)
    ) $charset;");
    dbDelta("CREATE TABLE $limits (
        bucket char(64) NOT NULL,
        hits int unsigned NOT NULL DEFAULT 0,
        expires bigint unsigned NOT NULL,
        PRIMARY KEY  (bucket)
    ) $charset;");
    foreach ([$players, $limits] as $table) {
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
            wp_die('Game database setup failed. Contact your hosting provider before activating again.');
        }
    }
}
register_activation_hook(__FILE__, 'mwg_activate');

function mwg_db_error() {
    error_log('Mingwei Games: database operation failed.');
    return new WP_Error('storage_unavailable', 'Storage is unavailable. Please try again later.', ['status' => 503]);
}

function mwg_limit(string $scope, int $max, int $seconds) {
    global $wpdb;
    $table = mwg_table('limits');
    $now = time();
    $period = $seconds ? intdiv($now, $seconds) : 0;
    $key = hash_hmac('sha256', "$scope:$period", wp_salt('auth'));
    $expires = $seconds ? ($period + 1) * $seconds : PHP_INT_MAX;
    // Atomic increments prevent concurrent requests from bypassing the resource cap.
    $result = $wpdb->query($wpdb->prepare(
        "INSERT INTO $table (bucket,hits,expires) VALUES (%s,1,%d)
         ON DUPLICATE KEY UPDATE hits = LEAST(hits + 1, 1000000)", $key, $expires
    ));
    if ($result === false) {
        return mwg_db_error();
    }
    $hits = $wpdb->get_var($wpdb->prepare("SELECT hits FROM $table WHERE bucket = %s", $key));
    if ($hits === null) {
        return mwg_db_error();
    }
    $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE expires < %d LIMIT 100", $now));
    return (int) $hits <= $max
        ? true
        : new WP_Error('rate_limit', 'Request or free-plan capacity limit reached. Please try later.', ['status' => 429]);
}

function mwg_ip(): string {
    // Do not trust arbitrary forwarding headers for rate-limit identity.
    return hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown', wp_salt('auth'));
}

function mwg_account_url(): string {
    return set_url_scheme(admin_url('admin-post.php?action=mwg_account'), 'https');
}

function mwg_logout_url(): string {
    return add_query_arg(['logout' => '1', '_mwg_nonce' => wp_create_nonce('mwg_logout')], mwg_account_url());
}

function mwg_form_value(string $key): string {
    return isset($_POST[$key]) && is_string($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
}

function mwg_player() {
    global $wpdb;
    $table = mwg_table('players');
    $uid = get_current_user_id();
    if (!$uid) {
        return new WP_Error('login_required', 'Please sign in to save scores.', ['status' => 401]);
    }
    $player = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE user_id=%d", $uid), ARRAY_A);
    if ($wpdb->last_error) {
        return mwg_db_error();
    }
    if (!$player) {
        $user = wp_get_current_user();
        $name = substr(sanitize_user($user->user_login, true), 0, 24);
        $created = $wpdb->query($wpdb->prepare(
            "INSERT INTO $table (player_id,user_id,display_name,updated_at) VALUES (%s,%d,%s,%s)
             ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",
            wp_generate_uuid4(), $uid, $name, current_time('mysql', true)
        ));
        if ($created === false) {
            return mwg_db_error();
        }
        $player = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE user_id=%d", $uid), ARRAY_A);
    }
    return $player ?: mwg_db_error();
}

function mwg_authorize() {
    return is_user_logged_in() && current_user_can('read')
        ? true
        : new WP_Error('login_required', 'Please sign in to save or export your records.', ['status' => 401]);
}

function mwg_rest(WP_REST_Request $request) {
    global $wpdb;
    $action = basename($request->get_route());
    $table = mwg_table('players');
    $gate = mwg_limit('api-global', 12000, 3600);
    if (is_wp_error($gate)) {
        return $gate;
    }
    $gate = mwg_limit('api-ip:' . mwg_ip(), 180, 60);
    if (is_wp_error($gate)) {
        return $gate;
    }
    if ($action === 'profile') {
        $player = is_user_logged_in() ? mwg_player() : null;
        if (is_wp_error($player)) {
            return $player;
        }
        return [
            'player' => $player ? [
                'displayName' => $player['display_name'],
                'bestScore' => (int) $player['best_score'],
                'bestTicks' => (int) $player['best_ticks'],
                'runs' => (int) $player['completed_runs'],
            ] : null,
            'accountUrl' => mwg_account_url(),
            'logoutUrl' => is_user_logged_in() ? mwg_logout_url() : null,
        ];
    }
    if ($action === 'leaderboard') {
        $rows = $wpdb->get_results(
            "SELECT display_name,best_score,best_ticks FROM $table WHERE best_score>0
             ORDER BY best_score DESC,best_ticks ASC,player_id ASC LIMIT 20", ARRAY_A
        );
        if ($wpdb->last_error) {
            return mwg_db_error();
        }
        return ['players' => array_map(static fn($row) => [
            'displayName' => $row['display_name'], 'score' => (int) $row['best_score'], 'ticks' => (int) $row['best_ticks'],
        ], $rows), 'limit' => 20];
    }
    $player = mwg_player();
    if (is_wp_error($player)) {
        return $player;
    }
    if ($action === 'export') {
        return [
            'schemaVersion' => 1, 'game' => 'cloud-hop-v1', 'exportedAt' => gmdate('c'),
            'player' => [
                'id' => $player['player_id'], 'displayName' => $player['display_name'],
                'bestScore' => (int) $player['best_score'], 'bestTicks' => (int) $player['best_ticks'],
                'runs' => (int) $player['completed_runs'],
                'lastResult' => $player['last_result'] ? json_decode($player['last_result'], true) : null,
                'updatedAt' => $player['updated_at'],
            ],
        ];
    }
    if ($action === 'start') {
        $gate = mwg_limit('start:' . $player['player_id'], 30, 600);
        if (is_wp_error($gate)) {
            return $gate;
        }
        $id = wp_generate_uuid4();
        if ($wpdb->update($table, ['run_id' => $id, 'run_started' => time()], ['user_id' => get_current_user_id()]) === false) {
            return mwg_db_error();
        }
        return ['runId' => $id, 'maxTicks' => 7200];
    }
    $body = $request->get_json_params();
    if (!is_array($body) || !is_string($body['runId'] ?? null) || !is_string($body['inputs'] ?? null)
        || strlen($body['inputs']) > 7200 || !preg_match('/^[0-5]+$/D', $body['inputs'])) {
        return new WP_Error('invalid_replay', 'Invalid or oversized game replay.', ['status' => 400]);
    }
    // A retry after a lost response returns the saved result without counting a second win.
    $last = $player['last_result'] ? json_decode($player['last_result'], true) : null;
    if ($last && ($last['runId'] ?? '') === $body['runId']) {
        if (!hash_equals($last['replayHash'], hash('sha256', $body['inputs']))) {
            return new WP_Error('invalid_replay', 'This run was already saved with different inputs.', ['status' => 409]);
        }
        return [
            'score' => $last['score'], 'coins' => $last['coins'], 'ticks' => $last['ticks'],
            'bestScore' => (int) $player['best_score'], 'runs' => (int) $player['completed_runs'],
        ];
    }
    if (!$player['run_id'] || !hash_equals($player['run_id'], $body['runId'])) {
        return new WP_Error('invalid_run', 'Run expired or replaced. Start a new ranked game.', ['status' => 409]);
    }
    $age = time() - (int) $player['run_started'];
    if ($age > 900 || $age + 2 < strlen($body['inputs']) / 60) {
        return new WP_Error('invalid_timing', 'Run timing is invalid or expired.', ['status' => 400]);
    }
    $gate = mwg_limit('finish:' . $player['player_id'], 60, 3600);
    if (is_wp_error($gate)) {
        return $gate;
    }
    try {
        $result = mwg_simulate($body['inputs']);
    } catch (InvalidArgumentException $exception) {
        return new WP_Error('invalid_replay', 'The game replay failed validation.', ['status' => 400]);
    }
    if (!$result['won']) {
        return new WP_Error('unfinished_run', 'Reach the finish before submitting a score.', ['status' => 400]);
    }
    $best = max((int) $player['best_score'], $result['score']);
    $best_ticks = $result['score'] > (int) $player['best_score'] ? $result['ticks'] : (int) $player['best_ticks'];
    $result['runId'] = $body['runId'];
    $result['replayHash'] = hash('sha256', $body['inputs']);
    $updated = $wpdb->query($wpdb->prepare(
        "UPDATE $table SET best_score=%d,best_ticks=%d,completed_runs=completed_runs+1,
         last_result=%s,run_id=NULL,run_started=0,updated_at=%s WHERE user_id=%d AND run_id=%s",
        $best, $best_ticks, wp_json_encode($result), current_time('mysql', true), get_current_user_id(), $body['runId']
    ));
    if ($updated === false) {
        return mwg_db_error();
    }
    if ($updated !== 1) {
        return new WP_Error('run_changed', 'Another request changed this run. Refresh your records.', ['status' => 409]);
    }
    return [
        'score' => $result['score'], 'coins' => $result['coins'], 'ticks' => $result['ticks'],
        'bestScore' => $best, 'runs' => (int) $player['completed_runs'] + 1,
    ];
}

add_action('rest_api_init', static function (): void {
    foreach (['profile', 'leaderboard', 'start', 'finish', 'export'] as $action) {
        register_rest_route('mwg/v1', '/' . $action, [
            'methods' => in_array($action, ['start', 'finish'], true) ? 'POST' : 'GET',
            'callback' => 'mwg_rest',
            'permission_callback' => in_array($action, ['profile', 'leaderboard'], true) ? '__return_true' : 'mwg_authorize',
        ]);
    }
});
add_filter('rest_post_dispatch', static function ($response, $server, $request) {
    if (str_starts_with($request->get_route(), '/mwg/v1/')) {
        $response->header('Cache-Control', 'no-store, private');
    }
    return $response;
}, 10, 3);
add_filter('rest_pre_dispatch', static function ($result, $server, $request) {
    if (str_starts_with($request->get_route(), '/mwg/v1/') && strlen($request->get_body()) > 8000) {
        return new WP_Error('payload_too_large', 'Request exceeds the game data limit.', ['status' => 413]);
    }
    return $result;
}, 10, 3);

function mwg_bridge(): void {
    nocache_headers();
    header_remove('X-Frame-Options');
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'self' " . implode(' ', MWG_ORIGINS));
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    $config = [
        'origins' => MWG_ORIGINS,
        'api' => set_url_scheme(rest_url('mwg/v1/'), 'https'),
        'nonce' => is_user_logged_in() ? wp_create_nonce('wp_rest') : '',
    ];
    echo '<!doctype html><html><head><meta charset="utf-8"><title>Game data connection</title></head><body>';
    echo '<div id="mwg-config" data-config="' . esc_attr(wp_json_encode($config)) . '"></div>';
    echo '<script src="' . esc_url(set_url_scheme(plugins_url('bridge.js', __FILE__), 'https')) . '"></script>';
    echo '</body></html>';
    exit;
}
add_action('admin_post_mwg_bridge', 'mwg_bridge');
add_action('admin_post_nopriv_mwg_bridge', 'mwg_bridge');

function mwg_account(): void {
    nocache_headers();
    header('X-Frame-Options: DENY');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    header('Referrer-Policy: same-origin');
    $error = '';
    if (isset($_GET['logout'])) {
        if (!wp_verify_nonce(sanitize_text_field(wp_unslash($_GET['_mwg_nonce'] ?? '')), 'mwg_logout')) {
            wp_die('Invalid logout link. Refresh the game and try again.', '', ['response' => 403]);
        }
        wp_logout();
        wp_safe_redirect(mwg_account_url(), 303);
        exit;
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (get_http_origin() !== 'https://mingweiyang.com' || (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) {
            wp_die('Invalid account request origin or size.', '', ['response' => 403]);
        }
        $gate = mwg_limit('account-global', 300, 3600);
        if (!is_wp_error($gate)) {
            $gate = mwg_limit('account-ip:' . mwg_ip(), 20, 900);
        }
        if (is_wp_error($gate)) {
            $error = $gate->get_error_message();
        } elseif (!wp_verify_nonce(sanitize_text_field(mwg_form_value('_mwg_nonce')), 'mwg_account')) {
            $error = 'This form expired. Please reload and try again.';
        } elseif (is_user_logged_in()) {
            $error = 'You are already signed in. Return to the game or sign out first.';
        } else {
            $mode = sanitize_key(mwg_form_value('mode'));
            $name = trim(mwg_form_value('username'));
            $password = mwg_form_value('password');
            if (!is_string($name) || !is_string($password) || strlen($password) > 128 || strlen($name) > 60) {
                $error = 'Invalid account details.';
            } elseif ($mode === 'register') {
                $email = sanitize_email(mwg_form_value('email'));
                if (!preg_match('/^[A-Za-z0-9_]{3,24}$/D', $name) || strlen($password) < 12 || !is_email($email)
                    || !empty($_POST['website'])) {
                    $error = 'Use a 3-24 character username (letters, numbers, underscore), a valid email and a password of at least 12 characters.';
                } else {
                    $gate = mwg_limit('register-day', 20, DAY_IN_SECONDS);
                    if (!is_wp_error($gate)) {
                        $gate = mwg_limit('register-ip:' . mwg_ip(), 3, HOUR_IN_SECONDS);
                    }
                    if (!is_wp_error($gate)) {
                        $gate = mwg_limit('register-total', 200, 0);
                    }
                    if (is_wp_error($gate)) {
                        $error = $gate->get_error_message();
                    } else {
                        $user_id = wp_insert_user([
                            'user_login' => $name, 'user_pass' => $password, 'user_email' => $email,
                            'display_name' => $name, 'role' => 'subscriber',
                        ]);
                        if (is_wp_error($user_id)) {
                            $error = 'Unable to create this account. Try different details or contact the site owner.';
                        }
                    }
                }
            } elseif ($mode !== 'login') {
                $error = 'Unknown account action.';
            }
            if (!$error) {
                $user = wp_signon(['user_login' => $name, 'user_password' => $password, 'remember' => false], true);
                if (is_wp_error($user)) {
                    $error = 'Sign-in failed. Check your username and password.';
                } else {
                    wp_set_current_user($user->ID);
                    $player = mwg_player();
                    if (is_wp_error($player)) {
                        $error = $player->get_error_message();
                    } else {
                        wp_safe_redirect(mwg_account_url(), 303);
                        exit;
                    }
                }
            }
        }
    }
    header('Content-Type: text/html; charset=utf-8');
    ?>
    <!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Mingwei Games - Account</title>
    <style>
    body{font:16px/1.6 system-ui;background:#f4f2ff;color:#272342;margin:0;padding:32px 16px}
    main{max-width:700px;margin:auto}section{background:white;padding:24px;border-radius:20px;margin:20px 0}
    input,button{box-sizing:border-box;font:inherit;padding:12px;border:1px solid #bbb;border-radius:10px;width:100%}
    label{display:block;margin:12px 0}button{background:#5940be;color:white;cursor:pointer;margin-top:16px}
    a{color:#5437b7}.error{border:2px solid #b33442;padding:16px;background:#fff}small{display:block}.trap{display:none}
    </style></head><body><main><h1>Mingwei Games</h1>
    <p><a href="<?php echo esc_url(MWG_APP); ?>">Back to games</a> &middot; <a href="https://mingweiyang.com/">Personal homepage</a></p>
    <?php if ($error): ?><p class="error" role="alert"><?php echo esc_html($error); ?></p><?php endif; ?>
    <?php if (is_user_logged_in()): ?>
        <section><h2>You are signed in</h2><p>Return to the game and refresh your profile.</p>
        <a href="<?php echo esc_url(mwg_logout_url()); ?>">Sign out</a></section>
    <?php else: foreach (['login' => 'Sign in', 'register' => 'Create account'] as $mode => $label): ?>
        <section><h2><?php echo esc_html($label); ?></h2><form method="post" action="<?php echo esc_url(mwg_account_url()); ?>">
        <?php wp_nonce_field('mwg_account', '_mwg_nonce'); ?>
        <input type="hidden" name="mode" value="<?php echo esc_attr($mode); ?>">
        <label>Username <input name="username" required maxlength="24" autocomplete="username"
            <?php if ($mode === 'register') echo 'pattern="[A-Za-z0-9_]{3,24}"'; ?>></label>
        <?php if ($mode === 'register'): ?>
        <small>Your username and best score will be public. Choose a nickname, not your real name.</small>
        <label>Email <input type="email" name="email" required maxlength="100" autocomplete="email"></label>
        <label class="trap" aria-hidden="true">Leave empty <input name="website" tabindex="-1" autocomplete="off"></label>
        <?php endif; ?>
        <label>Password <input type="password" name="password" required maxlength="128"
            <?php echo $mode === 'register' ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'; ?>></label>
        <button type="submit"><?php echo esc_html($label); ?></button></form></section>
    <?php endforeach; endif; ?>
    <p><a href="<?php echo esc_url(wp_lostpassword_url(mwg_account_url())); ?>">Reset password</a></p>
    <p>Accounts and game records are stored on this site's Northwest-hosted WordPress installation.
    Passwords are hashed by WordPress. Your email is not included in the public leaderboard.
    Best scores and completed runs sync across devices; an in-progress round does not.
    You can export your own records from the game. For account/data deletion, contact the site owner.</p>
    <p>This is a small experimental service: registration is capped at 200 accounts and 20 attempts per day.
    Password reset depends on the host's email delivery. Email ownership is not verified during registration.</p>
    </main></body></html>
    <?php
    exit;
}
add_action('admin_post_mwg_account', 'mwg_account');
add_action('admin_post_nopriv_mwg_account', 'mwg_account');

add_action('admin_menu', static function (): void {
    add_management_page('Game data export', 'Game data export', 'manage_options', 'mwg-export', static function (): void {
        echo '<div class="wrap"><h1>Game data export</h1><p>Portable player IDs, WordPress user IDs and game records. No passwords or emails. Store exports privately.</p>';
        echo '<a class="button button-primary" href="' . esc_url(wp_nonce_url(admin_url('admin-post.php?action=mwg_export_all'), 'mwg_export_all')) . '">Download JSON backup</a></div>';
    });
});
add_action('admin_post_mwg_export_all', static function (): void {
    if (!current_user_can('manage_options')) {
        wp_die('Not authorized.', '', ['response' => 403]);
    }
    check_admin_referer('mwg_export_all');
    global $wpdb;
    $table = mwg_table('players');
    $rows = $wpdb->get_results("SELECT player_id,user_id,display_name,best_score,best_ticks,completed_runs,last_result,updated_at FROM $table ORDER BY player_id", ARRAY_A);
    if ($wpdb->last_error) {
        wp_die('Database export failed.', '', ['response' => 503]);
    }
    nocache_headers();
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="mingwei-games-backup-' . gmdate('Y-m-d') . '.json"');
    echo wp_json_encode(['schemaVersion' => 1, 'game' => 'cloud-hop-v1', 'exportedAt' => gmdate('c'), 'players' => $rows], JSON_PRETTY_PRINT);
    exit;
});

add_action('deleted_user', static function ($user_id): void {
    global $wpdb;
    if ($wpdb->delete(mwg_table('players'), ['user_id' => (int) $user_id]) === false) {
        error_log('Mingwei Games: failed to delete records for a deleted account.');
    }
});
