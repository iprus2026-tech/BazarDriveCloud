// Minimal DOM tree + event boundary for VM smokes that run shipped screen/sheet
// source without a browser: parses the real render output so selectors and
// controls stay tied to shipped markup. Copied from smoke-driver-cancel-server-ack.mjs
// (#1029) so new behavioural smokes share one fake instead of growing more copies.

const decode = (value) => String(value).replace(/&(amp|lt|gt|quot|#39|apos);/g,
  (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[key]);
const dataKey = (name) => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this._text = '';
    this._attached = false;
    this.focusCount = 0;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const on = force ?? !this.classList.contains(name);
        if (on) this.classList.add(name); else this.classList.remove(name);
        return on;
      },
    };
  }
  get className() { return this.attributes.get('class') || ''; }
  set className(value) { this.attributes.set('class', String(value)); }
  get id() { return this.attributes.get('id') || ''; }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._attached; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(value) {
    this._html = String(value);
    this._text = '';
    this.children = [];
    const stack = [this];
    for (const token of this._html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) {
        const tag = token.match(/^<\/([^\s>]+)/)?.[1]?.toUpperCase();
        while (stack.length > 1) { if (stack.pop().tagName === tag) break; }
      } else if (token.startsWith('<')) {
        const tag = token.match(/^<([^\s/>]+)/)?.[1];
        if (!tag) continue;
        const node = new FakeElement(tag);
        const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          node.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        }
        stack.at(-1).appendChild(node);
        if (!/\/>$/.test(token) && !/^(input|br|hr|img|meta|link)$/i.test(tag)) stack.push(node);
      } else {
        const node = new FakeElement('#text');
        node._text = decode(token);
        stack.at(-1).appendChild(node);
      }
    }
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) { return name.startsWith('data-') ? this.dataset[dataKey(name)] ?? null : this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.dataset[dataKey(name)];
    if (name === 'disabled') this.disabled = false;
    if (name === 'hidden') this.hidden = false;
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this._attached = false;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return selector.split(',').some((part) => {
      const item = part.trim();
      if (!item) return false;
      const tag = item.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = item.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      if ([...item.matchAll(/\.([\w-]+)/g)].some((match) => !this.classList.contains(match[1]))) return false;
      for (const match of item.matchAll(/\[([^\s=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
        const actual = this.getAttribute(match[1]);
        if (actual == null || (match[2] != null && actual !== match[2])) return false;
      }
      return !!(tag || id || item.startsWith('.') || item.startsWith('['));
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => { for (const child of node.children) { if (child.matches(selector)) out.push(child); visit(child); } };
    visit(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  focus() { this.focusCount += 1; }
  scrollIntoView() {}
  fire(type = 'click') {
    const event = { target: this, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    const pending = [];
    for (let node = this; node; node = event.stopped ? null : node.parentElement) {
      for (const callback of node.listeners.get(type) || []) pending.push(callback(event));
    }
    return Promise.all(pending);
  }
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
