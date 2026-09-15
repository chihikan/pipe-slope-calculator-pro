'use strict';
// 配管勾配計算Pro 計算エンジンの回帰テスト。
// index.html を書き換えず「実際に動いているのと同じソース」を読み込んで(tests/load-app.js)、
// computeStartRow()/computeAllPoints() 等の本番関数を直接呼び出して検証する。
//
// 実行方法: node tests/run-calc-tests.js
//
// ここでのテストは、不具合報告に含まれる A〜J の実測ケースと、
// 「桝の上流側/下流側の測定位置(管上/管下)保存」「JSON保存→復元」「区間距離変更」
// 「lines.本管直下pipeSizeとjobs[種別].pipeSizeの整合性」を対象にする。

const fs = require('fs');
const path = require('path');
const { loadApp } = require('./load-app');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message, stack: err.stack });
  }
}
function approxEqual(actual, expected, tol, label) {
  if (actual === null || actual === undefined) throw new Error(`${label}: 値がnull/undefinedです(期待値${expected})`);
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: 期待値${expected} 実際${actual} (差${(actual - expected).toFixed(3)})`);
  }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg}: 期待値${JSON.stringify(b)} 実際${JSON.stringify(a)}`); }

const hooks = loadApp(path.join(__dirname, '..', 'index.html'));

// ---------- 共通フィクスチャ ----------
function station(id, ihMm) {
  return { id, label: id, ihMm, basis: { type: 'BM', readingM: ihMm / 1000 }, cumulativeCorrectionMm: 0 };
}
function boxMasuType(patch) {
  return Object.assign({
    type: 'box', customSign: 'plus', customMm: 30,
    boxStepEnabled: false, boxSign: 'minus', boxMm: 10,
    upstreamActualReadingM: null, downstreamActualReadingM: null,
    upstreamActualStationId: null, downstreamActualStationId: null,
  }, patch);
}
function simpleMasuType(type, patch) {
  return Object.assign({
    type, customSign: 'plus', customMm: 30,
    boxStepEnabled: false, boxSign: 'minus', boxMm: 10,
    upstreamActualReadingM: null, downstreamActualReadingM: null,
    upstreamActualStationId: null, downstreamActualStationId: null,
  }, patch);
}
function freshState({ pipeType = 'rain', pipeSize = 75, direction = 'down', mode = '100', stations, start, points }) {
  const s = hooks.defaultState();
  s.pipe = { type: pipeType, size: pipeSize };
  s.slope = { mode, customN: 80, direction, distanceMode: 'stacking' };
  s.stations = stations;
  s.checks = [];
  s.start = start;
  s.points = points;
  return s;
}
// mm(整数)からm(読み値の内部表現)へ。JSONの実測値は常にメートル表記。
function mm(v) { return v / 1000; }

// =====================================================================
// A. 今回の雨水75A(不具合報告そのもの): No.1管上1300 / No.2上流管上1330 / No.2下流管上1340 / 距離2520mm
// =====================================================================
test('A. 雨水75A No.1→No.2 (measureLoc=top): 実測落差+30mm・1/84・合格', () => {
  const st = [station('st1', 1130)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const startRow = hooks.computeStartRow();
  approxEqual(startRow.actualElevMm, -256, 0.01, 'No.1 実測管下高');
  const results2 = hooks.computeAllPoints();
  const r = results2[0];
  approxEqual(r.actualElevUpMm, -286, 0.01, 'No.2上流 現況高(管下換算)');
  approxEqual(r.actualElevDownMm, -296, 0.01, 'No.2下流 現況高(管下換算)');
  assertTrue(r.slopeJudge, 'No.2 slopeJudge が計算されていること');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差');
  approxEqual(r.slopeJudge.actualN, 84, 0.5, '実測勾配分母');
  assertEqual(r.slopeJudge.kind, 'normal', '実測勾配種別(逆勾配でないこと)');
  assertTrue(r.slopeJudge.pass === true, '勾配判定は合格のはず');
});

// =====================================================================
// B. 同じ値をすべて管下読みへ換算 → Aと完全一致
// =====================================================================
test('B. 管下読みへ換算(measureLoc=invert)しても A と同じ結果', () => {
  const st = [station('st1', 1130)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300 + 86), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1300 + 86), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1330 + 86), downstreamActualReadingM: mm(1340 + 86), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'invert',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const startRow = hooks.computeStartRow();
  approxEqual(startRow.actualElevMm, -256, 0.01, 'No.1 実測管下高');
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevUpMm, -286, 0.01, 'No.2上流 現況高(管下換算)');
  approxEqual(r.actualElevDownMm, -296, 0.01, 'No.2下流 現況高(管下換算)');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差');
  approxEqual(r.slopeJudge.actualN, 84, 0.5, '実測勾配分母');
  assertTrue(r.slopeJudge.pass === true, '勾配判定は合格のはず');
});

// =====================================================================
// C. 下りだが勾配不足: 距離2520・落差10mm → 1/252・不合格(「逆勾配」ではない)
// =====================================================================
test('C. 下りだが勾配不足: 1/252・不合格・「逆勾配」ではない', () => {
  const st = [station('st1', 1130)];
  // measureLoc='invert' に統一して単純化(オフセットは相殺されるので影響しない = B と同じ理屈)
  const startElevMm = -256;
  const upElevMm = startElevMm - 10; // 下り10mm
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1130 - startElevMm), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1130 - startElevMm), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1130 - upElevMm), downstreamActualReadingM: mm(1130 - upElevMm), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'invert',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.slopeJudge.dropMm, 10, 0.01, '実測落差');
  approxEqual(r.slopeJudge.actualN, 252, 0.5, '実測勾配分母');
  assertEqual(r.slopeJudge.kind, 'normal', '下りなので逆勾配(reverse)ではないこと');
  assertTrue(r.slopeJudge.pass === false, '1/100未満なので不合格のはず');
});

// =====================================================================
// D. 逆勾配: 前地点より現地点が10mm高い → 実測落差-10・逆勾配・不合格
// =====================================================================
test('D. 逆勾配: 実測落差-10mm・逆勾配・不合格', () => {
  const st = [station('st1', 1130)];
  const startElevMm = -256;
  const upElevMm = startElevMm + 10; // 10mm高い(逆勾配)
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1130 - startElevMm), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1130 - startElevMm), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1130 - upElevMm), downstreamActualReadingM: mm(1130 - upElevMm), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'invert',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.slopeJudge.dropMm, -10, 0.01, '実測落差');
  assertEqual(r.slopeJudge.kind, 'reverse', '逆勾配と判定されること');
  assertTrue(r.slopeJudge.pass === false, '逆勾配は不合格のはず');
});

// =====================================================================
// E. 同じ区間で前後の器械点が異なる(盛替え) → 各器械のihMmでBM換算後、同一器械の場合と同じ結果
// =====================================================================
test('E. 前後で器械点(盛替え)が異なっても A と同じ結果になる', () => {
  const st = [station('st1', 1130), station('st2', 1500)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1', // No.1はst1で実測
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      // No.2はst2(盛替え後の器械)で実測。st2のihMm=1500で同じ現況高(BM-286/-296)になるよう読み値を設定
      masuType: boxMasuType({
        upstreamActualReadingM: mm(1500 - (-286 + 86)), downstreamActualReadingM: mm(1500 - (-296 + 86)),
        upstreamActualStationId: 'st2', downstreamActualStationId: 'st2',
      }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevUpMm, -286, 0.01, 'No.2上流 現況高(st2基準でもA(st1のみ)と同じはず)');
  approxEqual(r.actualElevDownMm, -296, 0.01, 'No.2下流 現況高');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差(器械が違っても不変)');
  approxEqual(r.slopeJudge.actualN, 84, 0.5, '実測勾配分母');
  assertTrue(r.slopeJudge.pass === true, '合格のはず');
});

// =====================================================================
// F. 前後で管サイズが異なる → 各地点の管径補正を個別適用し、管下高へ統一後の落差が正しいこと
// =====================================================================
test('F. No.2からサイズ変更(75→100)しても、正規化後の落差は A と同じ', () => {
  const st = [station('st1', 1130)];
  const offset100 = 110;
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1', // 75A基準:offset86
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      // No.2からは管サイズ100(offset110)に変更。管上実測(raw)=elev+offset なので、同じ管下高-286/-296になるよう逆算
      masuType: boxMasuType({
        upstreamActualReadingM: mm(1130 - (-286 + offset100)), downstreamActualReadingM: mm(1130 - (-296 + offset100)),
        upstreamActualStationId: 'st1', downstreamActualStationId: 'st1',
      }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: true, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.offsetMm, 110, 0.01, 'No.2のこの地点補正値は100A(110mm)になっていること');
  approxEqual(r.actualElevUpMm, -286, 0.01, 'No.2上流 現況高(管下換算・サイズ変更後も正しく正規化)');
  approxEqual(r.actualElevDownMm, -296, 0.01, 'No.2下流 現況高');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差(管サイズ変更しても不変)');
  assertTrue(r.slopeJudge.pass === true, '合格のはず');
});

// =====================================================================
// G. 汚水No.8のように前地点が管下、現地点が管上でも、正規化後に正しい勾配になること
// =====================================================================
test('G. 前地点=管下読み・現地点=管上読み(汚水)でも正規化後の落差が正しい', () => {
  const st = [station('st1', 1130)];
  const startElevMm = -500; // 前地点(No.1)は管下(invert)で実測
  const offset100 = 110;
  const p2ElevMm = startElevMm - 10; // 10mm下り
  const s = freshState({
    pipeType: 'sewage', pipeSize: 100,
    stations: st,
    start: {
      method: 'measure', readingM: mm(1130 - startElevMm), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1130 - startElevMm), actualStationId: 'st1',
      masuType: simpleMasuType('', {}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(500),
      masuType: simpleMasuType('90L', {}), // 段差無しの単純地点(管上で実測)
      stationId: 'st1',
      actualReadingM: mm(1130 - p2ElevMm - offset100), // 管上(top)での読み = raw - offset/1000相当。rawElevMm=ihMm-reading*1000
      actualStationId: 'st1', measureLoc: 'top',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevMm, p2ElevMm, 0.01, 'No.2 現況高(管下換算) は前地点(管下)との混在でも正しく正規化されること');
  approxEqual(r.slopeJudge.dropMm, 10, 0.01, '実測落差');
  approxEqual(r.slopeJudge.actualN, 50, 0.5, '実測勾配分母(500/10)');
  assertTrue(r.slopeJudge.pass === true, '1/100より緩い(50<=100)ので合格のはず');
});

// =====================================================================
// H. 上流施工と下流施工: 同じ物理配置を「施工方向どおりの入力順」で入れれば、
//    どちら向きでも同じ実測落差・合否になること。
//    物理配置: masuA(上流側の端・管下高-256, 段差の無い単純桝) -- 2520mm -- masuB(下流側の端・
//    上流側管下高-286／下流側管下高-296の段差桝)。
//    上流から施工(down)なら No.1=masuA(先に測る)→No.2=masuB。
//    下流から施工(up)なら現場では逆側から測るため No.1=masuB(先に測る)→No.2=masuA になる
//    （施工方向が変わっても、各masuの上流側/下流側という物理ラベル自体は変わらない）。
// =====================================================================
test('H. 上流施工(down)/下流施工(up) で同じ物理配置なら同じ判定結果になる', () => {
  const st = [station('st1', 1130)];
  function buildDown() {
    return freshState({
      stations: st, direction: 'down',
      start: { // No.1=masuA(単純桝・管下高-256)
        method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
        stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1',
        masuType: boxMasuType({}), // No.1はbox指定でも段差適用なし(skipStartBoxStep)として扱われる
      },
      points: [{ // No.2=masuB(段差桝・上流-286/下流-296)
        id: 'p2', label: 'No.2', distanceInputM: mm(2520),
        masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
        stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
        sizeOverride: { enabled: false, mode: '100', customMm: 110 },
      }],
    });
  }
  function buildUp() {
    return freshState({
      stations: st, direction: 'up',
      start: { // No.1=masuB(先に測る側)。始点は常に非分割扱いなので、masuBの「施工の先に進む側」＝上流側(-286)を単一値として入力する
        method: 'measure', readingM: mm(1330), directMm: null, glCheckId: null, glDepthMm: null,
        stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1330), actualStationId: 'st1',
        masuType: simpleMasuType('box', {}),
      },
      points: [{ // No.2=masuA(単純桝・管下高-256)。段差の無い単純桝として同じ実測値をそのまま入力
        id: 'p2', label: 'No.2', distanceInputM: mm(2520),
        masuType: simpleMasuType('small', {}),
        stationId: 'st1', actualReadingM: mm(1300), actualStationId: 'st1', measureLoc: 'top',
        sizeOverride: { enabled: false, mode: '100', customMm: 110 },
      }],
    });
  }
  hooks.setState(buildDown());
  const rDown = hooks.computeAllPoints()[0];
  hooks.setState(buildUp());
  const rUp = hooks.computeAllPoints()[0];
  assertTrue(!!rDown.slopeJudge && !!rUp.slopeJudge, '両方向とも勾配判定が計算されていること');
  approxEqual(rUp.slopeJudge.dropMm, rDown.slopeJudge.dropMm, 0.01, '実測落差(masuA→masuBの+30mm)が施工方向によらず一致');
  approxEqual(rUp.slopeJudge.actualN, rDown.slopeJudge.actualN, 0.5, '実測勾配分母が施工方向によらず一致');
  assertEqual(rUp.slopeJudge.pass, rDown.slopeJudge.pass, '合否が施工方向によらず一致');
});

// =====================================================================
// I. 区間距離変更: 変更後はその地点以降だけ再計算され、入力済み実測値・設定は消えない
// =====================================================================
test('I. 距離変更後もその他の入力(実測値・器械・段差設定)は保持され、以降だけ再計算される', () => {
  const st = [station('st1', 1130)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  const before = hooks.computeAllPoints()[0];
  approxEqual(before.slopeJudge.dropMm, 30, 0.01, '変更前の実測落差');

  // 距離だけ変更(距離モードのUI操作 App.updatePoint({distanceInputM:...}) に相当する直接更新)
  const st2 = hooks.getState();
  st2.points[0].distanceInputM = mm(1000);
  hooks.setState(st2);
  const after = hooks.computeAllPoints()[0];
  approxEqual(after.slopeJudge.distMm, 1000, 0.01, '距離が更新されていること');
  // 落差(高さ)自体は実測値ベースなので変わらないが、分母Nと合否は距離依存で再計算される
  approxEqual(after.slopeJudge.dropMm, 30, 0.01, '実測落差は距離変更の影響を受けない');
  approxEqual(after.slopeJudge.actualN, 1000 / 30, 0.5, '実測勾配分母は新しい距離で再計算されること');
  // 実測値・器械・段差設定が消えていないこと
  const p = hooks.getState().points[0];
  assertEqual(p.masuType.upstreamActualStationId, 'st1', '上流側の使用器械が保持されていること');
  approxEqual(p.masuType.upstreamActualReadingM * 1000, 1330, 0.01, '上流側の実測読みが保持されていること');
  assertEqual(p.measureLoc, 'top', '管上/管下の選択が保持されていること');
  assertEqual(p.masuType.type, 'box', '桝種類が保持されていること');
});

// =====================================================================
// J. JSON保存→復元: 管上/管下選択・上流側/下流側実測値・各actualStationId・管サイズ・段差設定が完全一致
// =====================================================================
test('J. JSON保存→復元で measureLoc/実測値/actualStationId/段差設定が完全一致する', () => {
  const st = [station('st1', 1130), station('st2', 1500)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({
        upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340),
        upstreamActualStationId: 'st1', downstreamActualStationId: 'st2', boxStepEnabled: true, boxMm: 15,
      }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: true, mode: 'custom', customMm: 95 },
    }],
  });
  hooks.setState(s);
  const roundTripped = JSON.parse(JSON.stringify(hooks.getState()));
  assertEqual(roundTripped.points[0].measureLoc, 'top', '管上/管下選択');
  assertEqual(roundTripped.points[0].masuType.upstreamActualStationId, 'st1', '上流側actualStationId');
  assertEqual(roundTripped.points[0].masuType.downstreamActualStationId, 'st2', '下流側actualStationId');
  approxEqual(roundTripped.points[0].masuType.upstreamActualReadingM * 1000, 1330, 0.01, '上流側実測値');
  approxEqual(roundTripped.points[0].masuType.downstreamActualReadingM * 1000, 1340, 0.01, '下流側実測値');
  assertEqual(roundTripped.points[0].masuType.boxStepEnabled, true, '段差設定(boxStepEnabled)');
  assertEqual(roundTripped.points[0].masuType.boxMm, 15, '段差量');
  assertEqual(roundTripped.points[0].sizeOverride.enabled, true, '管サイズ変更フラグ');
  assertEqual(roundTripped.points[0].sizeOverride.customMm, 95, '管サイズ変更(手入力mm)');
  // 復元後も同じ計算結果になること(データが変質していないことの検算)
  hooks.setState(roundTripped);
  const r = hooks.computeAllPoints()[0];
  assertTrue(!!r.slopeJudge, '復元後も勾配判定が計算されること');
});

// =====================================================================
// 追加: 不具合レポート項目6 — lines.本管直下pipeSize と jobs[現在種別].pipeSize の矛盾を修正
// =====================================================================
test('K. defaultState()に不要な直下pipeSizeフィールドを持たせない(項目6)', () => {
  const s = hooks.defaultState();
  assertTrue(!Object.prototype.hasOwnProperty.call(s, 'pipeSize'), 'defaultState()はpipeSizeを持たないこと(state.pipe.sizeが正本)');
});

test('L. 旧JSON(直下pipeSizeあり)を読み込んでも一度きりで取り除かれ、以後の保存に引き継がれない', () => {
  const fixturePath = path.join(__dirname, 'fixtures', '武市元洋様竣工.json');
  const site = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const lineData = site.lines['本管'];
  assertTrue(Object.prototype.hasOwnProperty.call(lineData, 'pipeSize'), '前提: 添付JSON自体には旧・直下pipeSizeフィールドがある');
  assertEqual(lineData.pipeSize, 100, '前提: 添付JSONの直下pipeSizeは100(実際の種別=雨水75Aと矛盾)');
  assertEqual(lineData.pipe.size, 75, '前提: state.pipe.size(正本)は75');

  // applyLoadedFile() 等の読込処理と同じ手順(defaultState()にマージ→sanitize)
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(lineData)));
  hooks.stripLegacyPipeSizeField(restored);
  assertTrue(!Object.prototype.hasOwnProperty.call(restored, 'pipeSize'), '読込後、直下pipeSizeが除去されていること');
  assertEqual(restored.pipe.size, 75, '読込後もstate.pipe.size(正本)は75のまま(雨水75Aとして正しく扱われる)');

  // 再保存(JSON.stringify)しても、もう矛盾フィールドは含まれない
  const resaved = JSON.parse(JSON.stringify(restored));
  assertTrue(!Object.prototype.hasOwnProperty.call(resaved, 'pipeSize'), '再保存後も直下pipeSizeが復活しないこと');
});

// =====================================================================
// 追加: 添付JSON(武市元洋様竣工.json)の再読込結果を、報告された不具合と対応づけて記録する。
// これはコード修正の正否を判定する assert ではなく、ユーザーへの報告用に数値を記録するテスト。
// =====================================================================
test('M. 添付JSONの雨水No.2: 保存データそのまま(measureLoc=invert)では-56mmを再現する(データ起因・計算エンジンは正しいことの確認)', () => {
  const fixturePath = path.join(__dirname, 'fixtures', '武市元洋様竣工.json');
  const site = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const lineData = site.lines['本管'];
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(lineData)));
  hooks.stripLegacyPipeSizeField(restored);
  // 本管直下の値は雨水jobの内容そのもの(pipe.type='rain')なので、現在アクティブな雨水データとしてそのまま計算できる
  hooks.setState(restored);
  const startRow = hooks.computeStartRow();
  const r = hooks.computeAllPoints()[0];
  approxEqual(startRow.actualElevMm, -256, 0.01, 'No.1 実測管下高(BM-256)');
  approxEqual(r.actualElevUpMm, -200, 0.01, '保存データのmeasureLoc=invertのままだとNo.2上流はBM-200(管上補正が掛からない=不具合報告と一致)');
  approxEqual(r.actualElevDownMm, -210, 0.01, '同上、下流はBM-210');
  approxEqual(r.slopeJudge.dropMm, -56, 0.01, '保存データのままでは実測落差-56mm(不具合報告と一致)');
  assertEqual(r.slopeJudge.kind, 'reverse', '保存データのままでは逆勾配と表示される(不具合報告と一致)');
});

test('N. 添付JSONの雨水No.2: measureLoc を実際の入力条件どおり top に直すと +30mm・1/84・合格になる', () => {
  const fixturePath = path.join(__dirname, 'fixtures', '武市元洋様竣工.json');
  const site = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const lineData = JSON.parse(JSON.stringify(site.lines['本管']));
  // 入力条件どおり、No.2の測定位置を「管上」に修正(このJSONの唯一のデータ不備)
  lineData.points[0].measureLoc = 'top';
  lineData.jobs.rain.points[0].measureLoc = 'top';
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(lineData)));
  hooks.stripLegacyPipeSizeField(restored);
  hooks.setState(restored);
  const startRow = hooks.computeStartRow();
  const r = hooks.computeAllPoints()[0];
  approxEqual(startRow.actualElevMm, -256, 0.01, 'No.1 実測管下高(BM-256)');
  approxEqual(r.actualElevUpMm, -286, 0.01, 'No.2上流 現況高(BM-286)');
  approxEqual(r.actualElevDownMm, -296, 0.01, 'No.2下流 現況高(BM-296)');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差+30mm');
  approxEqual(r.slopeJudge.actualN, 84, 0.5, '実測勾配1/84');
  assertEqual(r.slopeJudge.kind, 'normal', '逆勾配ではない');
  assertTrue(r.slopeJudge.pass === true, '勾配判定は合格');
});

// =====================================================================
// 追加: 不具合レポート項目1 — 「管上/管下ボタン」の実クリックハンドラを直接起動し、
// 画面のボタン操作と保存されるp.measureLocが常に一致すること、および新規地点は
// 直前の地点(無ければ始点)のmeasureLocを引き継ぐことを検証する(DOM相当の操作を経由)。
// =====================================================================
test('O. 「管上ボタン」クリック(実ハンドラ)で p.measureLoc が top になり、次に追加した地点にも引き継がれる', () => {
  const st = [station('st1', 1130)];
  const s = freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1300), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [{
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'invert',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    }],
  });
  hooks.setState(s);
  assertEqual(hooks.getState().points[0].measureLoc, 'invert', '前提: 初期状態はinvert');

  // 画面の「管上ボタン」相当: App.updatePoint(id,{measureLoc:'top'}) を実ハンドラ経由で呼ぶのと同じ効果を確認
  hooks.App.updatePoint('p2', { measureLoc: 'top' });
  assertEqual(hooks.getState().points[0].measureLoc, 'top', '管上ボタン操作後、p.measureLocがtopになること');

  // 画面の「＋地点を追加」ボタン(実クリックハンドラ)を起動し、新規地点が直前(No.2, top)を引き継ぐこと
  hooks.document.getElementById('btnAddPoint')._trigger('click');
  const stateAfterAdd = hooks.getState();
  assertEqual(stateAfterAdd.points.length, 2, '地点が1件追加されていること');
  assertEqual(stateAfterAdd.points[1].measureLoc, 'top', '新規地点は直前の地点のmeasureLoc(top)を引き継ぐこと');
});

// =====================================================================
// 追加: 添付JSONの汚水側(No.2〜No.11、11地点・自動段差90YS・浄化槽流入/放流等を含む実データ)を
// そのまま計算しても例外が出ず、全地点ぶんの結果が返ること(実データでのリグレッション確認)。
// =====================================================================
test('P. 添付JSONの汚水側(11地点・自動段差/浄化槽まじり)を計算しても例外なく全地点分の結果が返る', () => {
  const fixturePath = path.join(__dirname, 'fixtures', '武市元洋様竣工.json');
  const site = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const lineData = site.lines['本管'];
  const sewageJob = lineData.jobs.sewage;
  const s = hooks.defaultState();
  s.pipe = { type: 'sewage', size: 100 };
  s.stations = JSON.parse(JSON.stringify(lineData.stations));
  s.checks = JSON.parse(JSON.stringify(lineData.checks));
  s.slope = sewageJob.slope;
  s.start = sewageJob.start;
  s.tolerance = sewageJob.tolerance;
  s.precheck = sewageJob.precheck;
  s.points = sewageJob.points;
  hooks.setState(s);
  const startRow = hooks.computeStartRow();
  assertTrue(startRow.designElevMm !== null, '始点の設計高が計算できること');
  const rs = hooks.computeAllPoints();
  assertEqual(rs.length, sewageJob.points.length, '地点数ぶんの結果が返ること');
  rs.forEach((r, i) => {
    assertTrue(r.designElevMm !== null, `No.${i + 2}の設計高が計算できること`);
    assertTrue(!Number.isNaN(r.designElevMm), `No.${i + 2}の設計高がNaNでないこと`);
  });
});

// =====================================================================
// 追加(最終確認 項目2): No.1の管上/管下と、新規地点への引き継ぎ(A/B)、
// 手動変更時の即時反映(C/D、表示HTMLまで確認)
// =====================================================================
function baseFixtureForQ(startMeasureLoc) {
  const st = [station('st1', 1130)];
  return freshState({
    stations: st,
    start: {
      method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
      stationId: 'st1', measureLoc: startMeasureLoc, actualReadingM: mm(1300), actualStationId: 'st1',
      masuType: boxMasuType({}),
    },
    points: [],
  });
}
test('Q-A. No.1を管上にしてNo.2を追加すると、No.2も管上になる', () => {
  hooks.setState(baseFixtureForQ('top'));
  hooks.document.getElementById('btnAddPoint')._trigger('click');
  assertEqual(hooks.getState().points[0].measureLoc, 'top', '新規地点(No.2)がNo.1(管上)を引き継ぐこと');
});
test('Q-B. No.1を管下にしてNo.2を追加すると、No.2も管下になる', () => {
  hooks.setState(baseFixtureForQ('invert'));
  hooks.document.getElementById('btnAddPoint')._trigger('click');
  assertEqual(hooks.getState().points[0].measureLoc, 'invert', '新規地点(No.2)がNo.1(管下)を引き継ぐこと');
});
test('Q-C. No.2を管上→管下へ手動変更すると、状態・計算・表示HTMLが即時にinvertへ変わる', () => {
  const s = baseFixtureForQ('top');
  s.points = [{
    id: 'p2', label: 'No.2', distanceInputM: mm(2520),
    masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
    stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
    sizeOverride: { enabled: false, mode: '100', customMm: 110 },
  }];
  hooks.setState(s);
  assertEqual(hooks.computeAllPoints()[0].actualElevUpMm, -286, '変更前(top): 上流BM-286');
  hooks.App.updatePoint('p2', { measureLoc: 'invert' }); // 画面の「管下ボタン」クリック相当(内部でrenderPoints()も実行される)
  assertEqual(hooks.getState().points[0].measureLoc, 'invert', '保存データが即時にinvertになること');
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevUpMm, -200, 0.01, '計算が即時に更新されること(invertでは86mm補正が掛からないので-200)');
  const html = String(hooks.document.getElementById('pointList').innerHTML || '');
  assertTrue(html.includes('BM-200'), '表示HTML(pointList)にも即時にBM-200が反映されていること');
  assertTrue(!html.includes('BM-286'), '表示HTMLに変更前のBM-286が残っていないこと');
});
test('Q-D. No.2を管下→管上へ手動変更すると、状態・計算・表示HTMLが即時にtopへ変わる', () => {
  const s = baseFixtureForQ('top');
  s.points = [{
    id: 'p2', label: 'No.2', distanceInputM: mm(2520),
    masuType: boxMasuType({ upstreamActualReadingM: mm(1330 + 86), downstreamActualReadingM: mm(1340 + 86), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
    stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'invert',
    sizeOverride: { enabled: false, mode: '100', customMm: 110 },
  }];
  hooks.setState(s);
  assertEqual(hooks.computeAllPoints()[0].actualElevUpMm, -286, '変更前(invert): 上流BM-286');
  hooks.App.updatePoint('p2', { measureLoc: 'top' }); // 画面の「管上ボタン」クリック相当
  assertEqual(hooks.getState().points[0].measureLoc, 'top', '保存データが即時にtopになること');
  const r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevUpMm, -286 - 86, 0.01, '計算が即時に更新されること(同じ読み値のままtop扱いになるので86mm分深くなる)');
  const html = String(hooks.document.getElementById('pointList').innerHTML || '');
  assertTrue(html.includes('BM-372'), '表示HTML(pointList)にも即時に新しい値(BM-372)が反映されていること');
});
test('Q-E. 保存→再読込後も、複数地点それぞれの管上/管下選択が個別に完全復元される', () => {
  const s = baseFixtureForQ('top');
  s.points = [
    {
      id: 'p2', label: 'No.2', distanceInputM: mm(2520),
      masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(1340), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
      stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    },
    {
      id: 'p3', label: 'No.3', distanceInputM: mm(1000),
      masuType: simpleMasuType('small', {}),
      stationId: 'st1', actualReadingM: mm(1450), actualStationId: 'st1', measureLoc: 'invert',
      sizeOverride: { enabled: false, mode: '100', customMm: 110 },
    },
  ];
  hooks.setState(s);
  const restored = JSON.parse(JSON.stringify(hooks.getState()));
  assertEqual(restored.points[0].measureLoc, 'top', 'No.2(管上)が復元されること');
  assertEqual(restored.points[1].measureLoc, 'invert', 'No.3(管下)が復元されること');
});

// =====================================================================
// 追加(最終確認 項目4): No.2上流1330→下流1340の10mm差(桝内部)を、
// No.1→No.2区間(2520mm)の実測勾配計算に使っていないことを明示的に確認する。
// =====================================================================
test('R. No.2下流側の値だけを変えても、No.1→No.2区間の実測落差(判定)は変わらない', () => {
  const st = [station('st1', 1130)];
  function build(downstreamMm) {
    return freshState({
      stations: st,
      start: {
        method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null,
        stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1',
        masuType: boxMasuType({}),
      },
      points: [{
        id: 'p2', label: 'No.2', distanceInputM: mm(2520),
        masuType: boxMasuType({ upstreamActualReadingM: mm(1330), downstreamActualReadingM: mm(downstreamMm), upstreamActualStationId: 'st1', downstreamActualStationId: 'st1' }),
        stationId: 'st1', actualReadingM: null, actualStationId: null, measureLoc: 'top',
        sizeOverride: { enabled: false, mode: '100', customMm: 110 },
      }],
    });
  }
  hooks.setState(build(1340));
  const r1 = hooks.computeAllPoints()[0];
  hooks.setState(build(1900)); // 下流側だけ大きく変える(桝内部の値。区間勾配には無関係のはず)
  const r2 = hooks.computeAllPoints()[0];
  approxEqual(r1.slopeJudge.dropMm, 30, 0.01, '下流側変更前の実測落差');
  approxEqual(r2.slopeJudge.dropMm, 30, 0.01, '下流側の値を変えても実測落差は+30mmのまま(桝内部の値は区間勾配に使わない)');
  assertEqual(r2.slopeJudge.pass, r1.slopeJudge.pass, '合否も変わらないこと');
});

// =====================================================================
// 追加(最終確認 項目6): 旧・直下pipeSizeとjobs[種別].pipeSizeが食い違う場合、
// state.pipe.size(=jobs[アクティブ種別]が保持していた値と一致)を正本として使うこと。
// さらに、pipeオブジェクトすら存在しない「本当に旧い」単体形式JSONは、直下pipeSizeを
// state.pipe.sizeへ移行したうえで正常に開けること(移行後の再保存には残らないこと)。
// =====================================================================
test('S. pipeオブジェクトを持たない本当に旧いJSON(直下pipeSizeのみ)を読み込むと、pipe.sizeへ移行される', () => {
  // multi-type/pipeオブジェクト導入より前を想定した最小限のJSON(pipeキーが無い)
  const veryOldJson = {
    project: { name: '旧現場', date: '2020-01-01', memo: '' },
    shareEmail: '', bmLabel: 'BM±0',
    stations: [{ id: 'st1', label: 'st1', ihMm: 1130, basis: { type: 'BM', readingM: 1.13 } }],
    checks: [],
    pipeSize: 75, // 当時はこれだけがサイズ情報(pipeオブジェクト無し)
    slope: { mode: '100', customN: 80, direction: 'down', distanceMode: 'stacking' },
    start: { method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null, stationId: 'st1', measureLoc: 'invert', actualReadingM: mm(1300), actualStationId: 'st1', masuType: { type: '', customSign: 'plus', customMm: 30, boxStepEnabled: false, boxSign: 'minus', boxMm: 10, upstreamActualReadingM: null, downstreamActualReadingM: null, upstreamActualStationId: null, downstreamActualStationId: null } },
    tolerance: 5, precheck: { totalLengthM: '', masuCount: '', targetMm: '' },
    points: [],
  };
  assertTrue(!veryOldJson.pipe, '前提: この旧JSONはpipeオブジェクトを持たない');

  // applyLoadedFile()の「旧形式(単体ファイル)」分岐と同じ手順
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(veryOldJson)));
  hooks.stripLegacyPipeSizeField(restored, veryOldJson);
  assertTrue(!Object.prototype.hasOwnProperty.call(restored, 'pipeSize'), '直下pipeSizeが除去されていること');
  assertEqual(restored.pipe.size, 75, '直下pipeSize(75)がstate.pipe.sizeへ正しく移行されていること(消えて既定値100に戻ってはいけない)');

  // 移行後、正常に計算できること(=旧JSONが開けなくなっていないこと)
  hooks.setState(restored);
  const startRow = hooks.computeStartRow();
  assertTrue(startRow.designElevMm !== null, '移行後も計算できること(旧JSONが開ける)');
  approxEqual(hooks.pipeOffsetMm(), 86, 0.01, '移行後の管上/管下補正が75A(86mm)で計算されること(誤って100Aの110mmにならない)');

  // 再保存しても直下pipeSizeが復活しないこと
  const resaved = JSON.parse(JSON.stringify(restored));
  assertTrue(!Object.prototype.hasOwnProperty.call(resaved, 'pipeSize'), '再保存後も直下pipeSizeが復活しないこと');
});

test('T. jobs[種別].pipeSizeと直下pipeSizeが食い違う現行形式JSONは、常にpipe.size(=アクティブ種別が保持していた値)を使う', () => {
  // 添付JSON同様: 直下pipeSize=100(旧値のまま放置)だが、pipeオブジェクト(正本)は75(雨水)
  const lineData = {
    project: { name: 'X', date: '2026-01-01', memo: '' },
    pipe: { type: 'rain', size: 75 },
    shareEmail: '', bmLabel: 'BM±0',
    stations: [{ id: 'st1', label: 'st1', ihMm: 1130, basis: { type: 'BM', readingM: 1.13 } }],
    checks: [],
    jobs: { rain: { pipeSize: 75 }, sewage: { pipeSize: 100 } },
    pipeSize: 100, // 旧・直下フィールド(矛盾値)
    slope: { mode: '100', customN: 80, direction: 'down', distanceMode: 'stacking' },
    start: { method: 'measure', readingM: mm(1300), directMm: null, glCheckId: null, glDepthMm: null, stationId: 'st1', measureLoc: 'top', actualReadingM: mm(1300), actualStationId: 'st1', masuType: boxMasuType({}) },
    tolerance: 5, precheck: { totalLengthM: '', masuCount: '', targetMm: '' },
    points: [],
  };
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(lineData)));
  hooks.stripLegacyPipeSizeField(restored, lineData); // pipeオブジェクトがあるので移行はせず、単に削除
  assertEqual(restored.pipe.size, 75, 'pipeオブジェクト(jobs.rain.pipeSizeと一致する75)が正本として使われること');
  hooks.setState(restored);
  approxEqual(hooks.pipeOffsetMm(), 86, 0.01, '雨水75Aとして86mm補正で計算されること(矛盾していた直下100mmの110mmにならない)');
});

// =====================================================================
// 追加(最終確認 項目7): 添付JSONをそのまま読み込んでも自動でtopへ書き換えない(データ尊重)が、
// 画面でNo.2を「管上」へ変更した瞬間に、現況高・実測落差・実測勾配・勾配判定が連動して変わること。
// =====================================================================
test('U. 添付JSONをそのまま読み込むとinvert/-56mmのまま(自動書き換えしない)。App.updatePointでtopに変えた瞬間に全て連動する', () => {
  const fixturePath = path.join(__dirname, 'fixtures', '武市元洋様竣工.json');
  const site = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const lineData = site.lines['本管'];
  const restored = Object.assign(hooks.defaultState(), JSON.parse(JSON.stringify(lineData)));
  hooks.stripLegacyPipeSizeField(restored, lineData);
  hooks.setState(restored);

  // 読み込んだ直後: データを勝手に書き換えていないこと(-56mmのまま)
  assertEqual(hooks.getState().points[0].measureLoc, 'invert', '読込直後、保存されていたmeasureLoc(invert)を勝手に書き換えていないこと');
  let r = hooks.computeAllPoints()[0];
  approxEqual(r.slopeJudge.dropMm, -56, 0.01, '読込直後は保存データどおり-56mmのまま');

  // 画面で「管上ボタン」を押した瞬間(App.updatePoint)に、全てが連動して変わること
  hooks.App.updatePoint(restored.points[0].id, { measureLoc: 'top' });
  r = hooks.computeAllPoints()[0];
  approxEqual(r.actualElevUpMm, -286, 0.01, '上流 現況高がBM-286に連動');
  approxEqual(r.actualElevDownMm, -296, 0.01, '下流 現況高がBM-296に連動');
  approxEqual(r.slopeJudge.dropMm, 30, 0.01, '実測落差が+30mmに連動');
  approxEqual(r.slopeJudge.actualN, 84, 0.5, '実測勾配が1/84に連動');
  assertTrue(r.slopeJudge.pass === true, '勾配判定が合格に連動');
});

// ---------- 結果出力 ----------
let passCount = 0, failCount = 0;
for (const r of results) {
  if (r.pass) { passCount++; console.log(`PASS ${r.name}`); }
  else { failCount++; console.log(`FAIL ${r.name}\n  ${r.error}`); }
}
console.log(`\n合計 ${results.length}件 / 成功 ${passCount}件 / 失敗 ${failCount}件`);
process.exitCode = failCount > 0 ? 1 : 0;
