<?php
// A small WordPress boundary stub; live integration tests also exercise real cookies and SQL.
define('ABSPATH', '/unused/');
define('ARRAY_A', 'ARRAY_A');
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data = []) {}
}
class WP_REST_Request {
    public function __construct(private string $action, private array $body = []) {}
    public function get_route() { return '/mwg/v1/' . $this->action; }
    public function get_json_params() { return $this->body; }
}
function register_activation_hook(...$args) {}
function add_action(...$args) {}
function add_filter(...$args) {}
function get_current_user_id() { return $GLOBALS['test_uid']; }
function is_user_logged_in() { return get_current_user_id() > 0; }
function current_user_can($cap) { return is_user_logged_in(); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_salt($type) { return 'test-only-salt'; }
function admin_url($path) { return 'https://mingweiyang.com/wp-admin/' . $path; }
function set_url_scheme($url, $scheme) { return $url; }
function wp_nonce_url($url, ...$args) { return $url . '&test_nonce=1'; }
function wp_unslash($value) { return stripslashes($value); }
function wp_json_encode($value) { return json_encode($value); }
function current_time(...$args) { return gmdate('Y-m-d H:i:s'); }
function wp_generate_uuid4() { return '12345678-1234-4234-8234-123456789012'; }

class DatabaseStub {
    public string $prefix = 'wp_';
    public string $last_error = '';
    public int $counter = 1;
    public array $players = [];
    public int $updates = 0;
    public function prepare($query, ...$args) { return [$query, $args]; }
    public function query($query) {
        if (str_starts_with($query[0], 'UPDATE wp_mwg_players')) {
            $this->updates++;
        }
        return 1;
    }
    public function get_var($query) { return $this->counter; }
    public function get_row($query, $type) {
        return $this->players[$query[1][0]] ?? null;
    }
    public function get_results($query, $type) {
        return [['display_name' => 'PlayerOne', 'best_score' => 50, 'best_ticks' => 200]];
    }
    public function update(...$args) { return 1; }
}
$GLOBALS['test_uid'] = 0;
$GLOBALS['wpdb'] = new DatabaseStub();
require __DIR__ . '/../wordpress/mwg-games/mwg-games.php';

function check($condition, $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}
function error_is($value, $code): bool {
    return $value instanceof WP_Error && $value->code === $code;
}

check(error_is(mwg_authorize(), 'login_required'), 'Anonymous writes must require login');
check(mwg_rest(new WP_REST_Request('profile'))['player'] === null, 'Anonymous profile must not expose a player');
$board = mwg_rest(new WP_REST_Request('leaderboard'));
check(array_keys($board['players'][0]) === ['displayName', 'score', 'ticks'], 'Leaderboard must expose only public fields');

$GLOBALS['test_uid'] = 1;
$player = [
    'player_id' => 'player-one', 'user_id' => 1, 'display_name' => 'PlayerOne',
    'best_score' => 50, 'best_ticks' => 200, 'completed_runs' => 2,
    'run_id' => 'current-run', 'run_started' => time() - 120,
    'last_result' => null, 'updated_at' => '2026-09-29 00:00:00',
];
$wpdb->players[1] = $player;
$wpdb->players[2] = array_merge($player, ['player_id' => 'player-two', 'user_id' => 2]);
check(mwg_authorize() === true, 'Authenticated read-capable user must be authorized');
$export = mwg_rest(new WP_REST_Request('export', ['user_id' => 2]));
check($export['player']['id'] === 'player-one', 'Caller-supplied user ID must not select another player');
check(!isset($export['player']['user_id']), 'Own portable export does not need WordPress IDs');
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'current-run', 'inputs' => []])), 'invalid_replay'), 'Reject non-string replay');
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'current-run', 'inputs' => str_repeat('0', 7201)])), 'invalid_replay'), 'Reject oversized replay');
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'someone-elses-run', 'inputs' => '0'])), 'invalid_run'), 'Reject another run ID');
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'current-run', 'inputs' => '0', 'score' => 999999])), 'unfinished_run'), 'Claimed score must not bypass simulation');
$wpdb->players[1]['run_started'] = time() + 100;
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'current-run', 'inputs' => '0'])), 'invalid_timing'), 'Reject impossible timing');
$wpdb->players[1]['last_result'] = json_encode([
    'runId' => 'saved-run', 'replayHash' => hash('sha256', '0'), 'score' => 50, 'coins' => 1, 'ticks' => 200,
]);
$retry = mwg_rest(new WP_REST_Request('finish', ['runId' => 'saved-run', 'inputs' => '0']));
check($retry['score'] === 50 && $retry['runs'] === 2 && $wpdb->updates === 0, 'Retry must not double-count a saved run');
check(error_is(mwg_rest(new WP_REST_Request('finish', ['runId' => 'saved-run', 'inputs' => '1'])), 'invalid_replay'), 'Reject modified replay on a saved run');
$wpdb->counter = 12001;
check(error_is(mwg_rest(new WP_REST_Request('profile')), 'rate_limit'), 'Enforce shared resource gate');
$_POST['username'] = ['not-a-string'];
check(mwg_form_value('username') === '', 'Malformed form values must not cause a type error');
echo "Backend assertions passed\n";
