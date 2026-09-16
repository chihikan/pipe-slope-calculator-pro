'use strict';
// index.html を Node の vm サンドボックス内で実行するための最小限のDOMスタブ。
// 目的：実機のブラウザ動作を模倣することではなく、index.html内の計算関数(computeAllPoints等)を
// 「本番と同じコードのまま」呼び出せるようにするための土台。画面には何も描画しない。
// レンダリング系の呼び出し(innerHTML代入・classList操作等)は全て無害な no-op になる。

function makeDummyElement() {
  const store = { style: {}, dataset: {}, children: [] };
  const classListStore = new Set();
  const listeners = {};
  const el = {
    style: store.style,
    dataset: store.dataset,
    children: store.children,
    classList: {
      toggle(cls, force) {
        if (force === undefined) {
          if (classListStore.has(cls)) classListStore.delete(cls); else classListStore.add(cls);
        } else if (force) classListStore.add(cls); else classListStore.delete(cls);
      },
      add(...cls) { cls.forEach(c => classListStore.add(c)); },
      remove(...cls) { cls.forEach(c => classListStore.delete(c)); },
      contains(cls) { return classListStore.has(cls); },
    },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      if (!listeners[type]) return;
      const i = listeners[type].indexOf(handler);
      if (i >= 0) listeners[type].splice(i, 1);
    },
    dispatchEvent() { return true; },
    // テスト用: 実際のブラウザイベントを介さず、登録済みハンドラを直接起動する。
    _trigger(type, evt) { (listeners[type] || []).forEach(h => h(evt || { target: el, preventDefault() {} })); },
    appendChild(x) { store.children.push(x); return x; },
    removeChild(x) { const i = store.children.indexOf(x); if (i >= 0) store.children.splice(i, 1); return x; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, blur() {}, remove() {},
    click() { el._trigger('click'); },
    setSelectionRange() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    contains() { return false; },
  };
  return new Proxy(el, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return undefined;
    },
    set(target, prop, val) {
      target[prop] = val;
      return true;
    },
  });
}

function makeStorageStub() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
  };
}

function createSandbox() {
  // 同じidへの2回目以降のgetElementById()は同じダミー要素を返す(実DOMと同様)。
  // これにより、初期化時にaddEventListenerで登録したハンドラをテストから_trigger()で起動できる。
  const elementsById = new Map();
  // documentレベルのリスナー(index.htmlのdocument.addEventListener('touchstart', ..., {capture:true})等)。
  // captureフェーズかどうかは区別せず1つの配列にまとめて格納する(このスタブでは発火順序の厳密な
  // capture/bubble再現までは行わず、documentに登録されたハンドラを_triggerで直接起動できれば十分)。
  const documentListeners = {};
  const documentStub = {
    getElementById(id) {
      if (!elementsById.has(id)) elementsById.set(id, makeDummyElement());
      return elementsById.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, handler) { (documentListeners[type] = documentListeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      if (!documentListeners[type]) return;
      const i = documentListeners[type].indexOf(handler);
      if (i >= 0) documentListeners[type].splice(i, 1);
    },
    // テスト用: index.html内でdocument.addEventListener(...)された処理(ライン一覧モーダルの
    // クリック委譲、下部メニューのグローバルなドラッグ検出等)を直接起動する。
    _trigger(type, evt) { (documentListeners[type] || []).forEach(h => h(evt || { target: documentStub, preventDefault() {} })); },
    createElement() { return makeDummyElement(); },
    activeElement: makeDummyElement(),
    body: makeDummyElement(),
    _elementsById: elementsById,
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Error,
    Promise, Map, Set, Proxy,
    localStorage: makeStorageStub(),
    sessionStorage: makeStorageStub(),
    navigator: { serviceWorker: undefined, userAgent: 'node-test' },
    location: { protocol: 'file:', hostname: 'localhost', href: 'file://test' },
    document: documentStub,
    FileReader: function FileReader() {},
    Blob: function Blob() {},
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
    fetch: undefined,
    crypto: globalThis.crypto,
    addEventListener() {},
    removeEventListener() {},
    print() {},
    scrollTo() {},
    atob: typeof atob !== 'undefined' ? atob : (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  sandbox.window = sandbox; // window === global スコープとして扱う
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

module.exports = { createSandbox };
