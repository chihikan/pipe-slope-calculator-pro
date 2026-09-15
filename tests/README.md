# 計算エンジンの回帰テスト

`index.html` は単一ファイルのアプリのため、ビルド手順や依存パッケージは不要です。
`node tests/run-calc-tests.js` を実行するだけで、実際に配信している `index.html` と
**同一のソース**を Node の `vm` 内で読み込み、`computeStartRow()`/`computeAllPoints()` などの
本番の計算関数を直接呼び出して検証します（別実装で計算を再現しているわけではありません）。

## 実行方法

```
node tests/run-calc-tests.js
```

## 本番ファイルにはテスト専用コードを一切追加しない

`index.html` 自体にはテスト用のグローバル変数・フック等を **一切書き込みません**。
`state` や `computeStartRow()`/`computeAllPoints()` のような内部関数へアクセスするための
橋渡しコードは、`tests/load-app.js` が `index.html` から取り出したスクリプト文字列の**末尾に
テスト実行時だけ追記**することで実現しています（Node の `vm` サンドボックス内のメモリ上だけの
処理で、ファイルには一切書き込まれません）。それ以外は、画面操作の入口として元から公開されて
いる `window.App`（ボタンの`onclick`から呼ばれる本番の関数群）と、実クリックハンドラの起動
（`el._trigger('click')`、後述）だけを使って検証します。

## 構成

- `dom-stub.js` — `document`/`localStorage` 等の最小限のダミー実装。画面には何も描画しないが、
  `index.html` 内のDOM操作コードが例外を出さずに動くようにする。ボタンの`addEventListener`は
  同じidなら同じ要素を返すようキャッシュしており、`el._trigger('click')`で実クリックハンドラを
  そのまま起動できる。
- `load-app.js` — `index.html` からインラインの `<script>` を取り出し、末尾にテスト専用の
  橋渡しコード（`state`・計算関数への参照を返すだけの小さなオブジェクト）をテキストとして
  追記したうえで `dom-stub.js` のサンドボックス内で実行する。**`index.html` 自体は読み込むだけで
  変更しない**。
- `fixtures/武市元洋様竣工.json` — 不具合報告に添付されたJSON（雨水No.2の実測落差 -56mm 不具合の再現データ）。
- `run-calc-tests.js` — 不具合報告のテストA〜J、および項目1(管上/管下ボタンとmeasureLocの一致)・
  項目6(旧・直下pipeSizeフィールドの整理)を含む回帰テスト本体。

## テストが使えるもの(すべてテスト実行時のみ有効)

```js
{
  getState, setState, defaultState, stripLegacyPipeSizeField, migrateLoadedChecks,
  computeStartRow, computeAllPoints, cumulativeDistances,
  pipeOffsetMm, evaluateSlopeJudge, slopeN, stationById, currentStation,
  renderAll, syncFormFields, PIPE_OFFSETS,
  document, // ダミーDOM(dom-stub.js)。document.getElementById('id')._trigger('click') で実ハンドラを起動できる
  App,      // index.htmlが元から公開している画面操作の入口(App.updatePoint等)
}
```
