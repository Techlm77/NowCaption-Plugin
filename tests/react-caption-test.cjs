const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '..'), process.env.VENCORD_DIR || path.join(os.homedir(), 'Documents/Vencord-source'), process.cwd()] }));
function load(relative, stubs = {}) {
    const filename = path.join(__dirname, '..', 'src', 'userplugins', 'nowCaption', relative);
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const m = { exports: {} };
    new Function('require', 'module', 'exports', js)(s => { if (s in stubs) return stubs[s]; throw new Error('Unexpected dependency ' + s); }, m, m.exports);
    return m.exports;
}
const stability = load('core/captionStability.ts');
const { CaptionViewModel } = load('ui/components/captionModel.ts', { '../../core/captionStability': stability });

const model = new CaptionViewModel();
const prefix = 'i was playing a game earlier and decided to check whether it was available on steam then i opened';
const words = ['it', 'was', 'buggy', 'as', 'hell'];
let text = prefix;
for (const [index, word] of [null, ...words].entries()) {
    if (word) text += ' ' + word;
    assert.equal(model.update(text, index * 120), true);
    assert.equal(model.snapshot().text, text, 'the display must be a single cumulative passage, without sentence breaks or rewriting');
}
assert.equal(model.update(text, 950), false, 'unchanged recognition should not rerender');
assert.equal(model.snapshot().text, text);
assert(!model.snapshot().text.includes('\n'));
assert(!model.snapshot().text.includes('…'));

// A partial word may be revised without changing settled history or adding a newline.
const partial = new CaptionViewModel();
partial.update('the stea', 0);
partial.update('the steam', 120);
partial.update('the steam launcher', 240);
assert.equal(partial.snapshot().text, 'the steam launcher');
partial.update('the steam launchers', 360);
assert.equal(partial.snapshot().text, 'the steam launchers');

// Maintain a continuous paragraph across 1000 recognizer updates. No 18-word
// row segmentation, 12-row cutoff, automatic capitalization or punctuation.
const long = new CaptionViewModel();
let total = '';
for (let i = 0; i < 1000; i++) {
    total += (i ? ' ' : '') + `word${i}`;
    long.update(total, i * 120);
    assert.equal(long.snapshot().text, total);
}
assert.equal(long.snapshot().text.split(' ').length, 1000);
assert.equal(long.snapshot().text.includes('\n'), false);
long.reset();
assert.equal(long.snapshot().text, 'Waiting for speech');
long.update('hello again', 120_000);
assert.equal(long.snapshot().text, 'hello again');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'userplugins', 'nowCaption', 'ui', 'styles.css'), 'utf8');
const card = fs.readFileSync(path.join(__dirname, '..', 'src', 'userplugins', 'nowCaption', 'ui', 'components', 'CaptionCard.ts'), 'utf8');
assert(card.includes('className:"nc10-paragraph"'), 'one paragraph must own all caption text');
assert(!card.includes('view.rows'), 'speaker cards must not render fixed-word rows');
assert(!card.includes('view.draft'), 'speaker cards must not create a separate draft display');
assert(css.includes('.nc10-paragraph{white-space:normal;'), 'browser must wrap text naturally');
assert(css.includes('animation:none!important;transition:none!important;scroll-behavior:auto!important;'), 'no animations or smooth scrolling');
console.log('PASS: exact word-by-word growth, one lowercase paragraph, partial-word correction, 1000 updates, natural wrap');
