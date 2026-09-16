'use strict';
// index.html の中身(本番と完全に同一のソース)をNodeのvmサンドボックス内で実行するためのローダー。
//
// 重要: index.html自体にはテスト専用のフック等を一切追加しない。
// 「実際にブラウザで動くのと同じ計算関数・state」へアクセスする橋渡しコードは、
// このファイル(テスト側)が index.html から取り出したスクリプト文字列の末尾に
// その場で追記するだけであり、本番ファイルには一切書き込まれない。
// (window.App は index.html が元から公開している機能で、こちらはそのまま利用する)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSandbox } = require('./dom-stub');

function extractInlineScript(html) {
  // src属性を持たない<script>...</script>ブロック(=アプリ本体のインラインスクリプト)を取り出す。
  // vendor/supabase.min.js のような外部<script src="...">は対象外。
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, best = null;
  while ((m = re.exec(html))) {
    if (!best || m[1].length > best.length) best = m[1];
  }
  if (!best) throw new Error('インラインの<script>ブロックが見つかりません');
  return best;
}

// index.html本体は `(function(){ ... (function initSite(){ ... })(); })();` という
// 二重IIFEで閉じられている。その最内側/外側どちらの閉じ括弧が続く末尾
// `  })();\n})();` の直前(＝外側IIFEのスコープ内・initSite実行後)に、
// テスト専用の橋渡しコードをテキストとして差し込む。index.htmlのソース自体は変更しない。
const CLOSE_MARKER = '})();\n})();';
const TEST_BRIDGE_SNIPPET = `
  // ↓↓↓ ここから下は tests/load-app.js がテスト実行時にのみ追記するコード。
  // index.html の配布物(実ファイル)には一切含まれない。
  globalThis.__TEST_BRIDGE__ = {
    getState: ()=>state,
    setState: (s)=>{ state = s; },
    getSite: ()=>site,
    setSite: (s)=>{ site = s; },
    defaultState, stripLegacyPipeSizeField, migrateLegacyPointLabels, migrateLoadedChecks,
    computeStartRow, computeAllPoints, cumulativeDistances,
    pipeOffsetMm, evaluateSlopeJudge, slopeN, stationById, currentStation,
    numberingStepSign, computeAutoLabel, missingLabelNumbers, connectionCandidateOptions,
    branchOfToValue, valueToBranchOf,
    switchLine, nextBranchId, createLineData, MAIN_LINE, lineIdList,
    confirmDeleteLine, deleteLine, showLineModal,
    bindSafeTap, startNewFile,
    renderAll, syncFormFields, PIPE_OFFSETS
  };
`;

function injectTestBridge(script) {
  const idx = script.lastIndexOf(CLOSE_MARKER);
  if (idx < 0) throw new Error('index.htmlの末尾構造(二重IIFEの閉じ括弧)が見つかりません。ローダーの前提が崩れていないか確認してください。');
  return script.slice(0, idx) + TEST_BRIDGE_SNIPPET + script.slice(idx);
}

function loadApp(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rawScript = extractInlineScript(html);
  const script = injectTestBridge(rawScript); // ← この注入はテストプロセスのメモリ上だけで起こる
  const sandbox = createSandbox();
  const context = vm.createContext(sandbox);
  vm.runInContext(script, context, { filename: path.basename(htmlPath) });
  const hooks = sandbox.__TEST_BRIDGE__;
  if (!hooks) throw new Error('テスト用ブリッジの注入に失敗しました(index.htmlの末尾構造が変わった可能性があります)');
  hooks.document = sandbox.document; // ボタンのclickハンドラ等をテストから直接起動するため
  hooks.App = sandbox.App; // index.htmlが元から公開しているApp(画面操作のエントリポイント)をそのまま使う
  return hooks;
}

module.exports = { loadApp, extractInlineScript };
