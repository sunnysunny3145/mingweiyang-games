<?php
/**
 * Deterministic replay verifier. Coordinates are integer tenths of a pixel.
 * Keep physics and level data identical to sim.js.
 */
function mwg_simulate(string $inputs): array {
    $length = strlen($inputs);
    if ($length > 7200 || preg_match('/[^0-5]/', $inputs)) {
        throw new InvalidArgumentException('Replay must contain at most 7200 input digits (0–5)');
    }
    $platforms = [
        [0, 4400, 6000], [7400, 4400, 5000], [13800, 4400, 5200],
        [20500, 4400, 5700], [27700, 4400, 8300],
        [3400, 3500, 1250], [9200, 3450, 1350], [15800, 3500, 1500],
        [22700, 3450, 1400], [30200, 3500, 1500],
    ];
    $coin_positions = [
        [2200, 4000], [3900, 3100], [6600, 3520], [8500, 4000],
        [9800, 3050], [13000, 3520], [15000, 4000], [16500, 3100],
        [19700, 3520], [21800, 4000], [23300, 3050], [26900, 3520],
        [28800, 4000], [30900, 3100], [33000, 4000],
    ];
    $collected = array_fill(0, count($coin_positions), false);
    $x = 700; $y = 4100; $vy = 0; $coins = 0; $deaths = 0; $ticks = 0;
    $grounded = true; $won = false;
    for ($i = 0; $i < $length; $i++) {
        if ($won) {
            throw new InvalidArgumentException('Replay continues after victory');
        }
        $key = (int) $inputs[$i];
        $vx = ($key === 1 || $key === 4) ? -38 : (($key === 2 || $key === 5) ? 38 : 0);
        if ($key >= 3 && $grounded) $vy = -125;
        $previous_bottom = $y + 300;
        $x = max(0, min(35780, $x + $vx));
        $vy += 5;
        $y += $vy;
        $grounded = false;
        if ($vy >= 0) {
            foreach ($platforms as [$px, $py, $width]) {
                if ($x + 220 > $px && $x < $px + $width && $previous_bottom <= $py && $y + 300 >= $py) {
                    $y = $py - 300;
                    $vy = 0;
                    $grounded = true;
                }
            }
        }
        foreach ($coin_positions as $index => [$cx, $cy]) {
            if (!$collected[$index] && abs($x + 110 - $cx) < 230 && abs($y + 150 - $cy) < 290) {
                $collected[$index] = true;
                $coins++;
            }
        }
        if ($y > 6100) {
            $x = 700; $y = 4100; $vy = 0; $grounded = true;
            $deaths++;
        }
        $ticks++;
        if ($x >= 34300 && $y + 300 <= 4400) $won = true;
    }
    $score = $won ? max(0, 10000 + $coins * 250 + (7200 - $ticks) * 2 - $deaths * 500) : 0;
    return ['won' => $won, 'ticks' => $ticks, 'coins' => $coins, 'score' => $score];
}
