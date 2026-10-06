import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import moment from 'moment';
import { DateCodec, parseBoard, setCardDate } from '../src/boards';
import { buildEvents, CARD_KEY, NoteInfo } from '../src/events';

const codec: DateCodec = {
  parse: (v, f) => {
    const m = moment(v, f, true);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
  },
  format: (iso, f) => moment(iso, 'YYYY-MM-DD').format(f),
};

const boardText = readFileSync(new URL('./fixtures/board.md', import.meta.url), 'utf8');
const posts: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(new URL('./fixtures/posts.json', import.meta.url), 'utf8')
);
const BOARD = 'Блог/Доска.md';
const resolve = (link: string): NoteInfo | null => {
  const path = Object.keys(posts).find((p) => p.endsWith(`/${link}.md`));
  return path ? { path, frontmatter: posts[path] } : null;
};

test('реальная доска: карточки, колонки, даты, настройки', () => {
  const { settings, cards } = parseBoard(boardText, codec);
  assert.equal(cards.length, 8);
  assert.equal(settings.dateFormat, 'YYYY-MM-DD');
  assert.deepEqual(
    settings.metadataKeys.map((k) => k.key),
    ['channel', 'rubric', 'deadline_tz', 'deadline_text', 'publish_date']
  );
  const c13 = cards.find((c) => c.link === 'Пять рецептов на осень')!;
  assert.equal(c13.title, 'Пять рецептов на осень');
  assert.equal(c13.date, '2026-10-11');
  assert.equal(c13.lane, '📥 Бэклог');
  assert.equal(c13.laneComplete, false);
  assert.equal(cards.find((c) => c.link?.startsWith('Фото-подборка'))!.lane, '👀 Проверка');
});

test('события: 3 даты на пост, дата карточки склеена с дедлайном текста', () => {
  const events = buildEvents([{ path: BOARD, board: parseBoard(boardText, codec) }], {
    resolve,
    showDone: true,
    showCardOnly: true,
  });
  assert.equal(events.length, 24);
  assert.equal(events.filter((e) => e.key === CARD_KEY).length, 0);
  const e13 = events.filter((e) => e.title === 'Пять рецептов на осень');
  assert.deepEqual(
    e13.map((e) => [e.key, e.label, e.date, e.includesCardDate]),
    [
      ['deadline_text', 'Текст', '2026-10-11', true],
      ['deadline_tz', 'ТЗ', '2026-10-12', false],
      ['publish_date', '📅', '2026-10-16', false],
    ]
  );
});

test('дата карточки без совпадения — отдельное событие', () => {
  const text = boardText.replace('[[Пять рецептов на осень]] @{2026-10-11}', '[[Пять рецептов на осень]] @{2026-10-01}');
  const events = buildEvents([{ path: BOARD, board: parseBoard(text, codec) }], { resolve, showDone: true, showCardOnly: true });
  const card = events.filter((e) => e.key === CARD_KEY);
  assert.equal(card.length, 1);
  assert.equal(card[0].date, '2026-10-01');
  assert.equal(events.find((e) => e.title === 'Пять рецептов на осень' && e.key === 'deadline_text')!.includesCardDate, false);
});

test('выполненные: колонка с **Complete**, чекбокс [x], архив после ***', () => {
  const text = `---\nkanban-plugin: board\n---\n\n## Дела\n\n- [x] Готово @{2026-10-02}\n- [ ] Не готово @{2026-10-03}\n\n## Сделано\n\n**Complete**\n- [ ] Сдано @{2026-10-04}\n\n***\n\n## Archive\n\n- [ ] Старое @{2026-01-01}\n`;
  const board = parseBoard(text, codec);
  assert.deepEqual(board.cards.map((c) => c.title), ['Готово', 'Не готово', 'Сдано']);
  const shown = buildEvents([{ path: 'b.md', board }], { resolve: () => null, showDone: false, showCardOnly: true });
  assert.deepEqual(shown.map((e) => e.title), ['Не готово']);
});

test('карточка: текст, подпись ссылки, время, многострочная, @[[дата]], свой формат', () => {
  const text = [
    '## A',
    '- [ ] Позвонить @{06.10.2026} @@{14:30}',
    '- [ ] [[Папка/Заметка|Красивое имя]]',
    '- [ ] Обсудить [[План]] с командой',
    '- [ ] Многострочная',
    '  вторая строка @[[07.10.2026]]',
    '',
    '%% kanban:settings',
    '```',
    '{"kanban-plugin":"board","date-format":"DD.MM.YYYY"}',
    '```',
    '%%',
  ].join('\n');
  const { cards } = parseBoard(text, codec);
  assert.deepEqual(
    cards.map((c) => [c.title, c.link, c.date]),
    [
      ['Позвонить', null, '2026-10-06'],
      ['Красивое имя', 'Папка/Заметка', null],
      ['Обсудить План с командой', 'План', null],
      ['Многострочная', null, '2026-10-07'],
    ]
  );
  assert.equal(cards[3].dateLine, 5);
});

test('setCardDate меняет ровно одну строку и сохраняет формат', () => {
  const board = parseBoard(boardText, codec);
  const card = board.cards.find((c) => c.link === 'Пять рецептов на осень')!;
  const out = setCardDate(boardText, card, '2026-10-13', board.settings, codec);
  const a = boardText.split('\n');
  const b = out.split('\n');
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(diff, [card.dateLine]);
  assert.equal(b[card.dateLine], '- [ ] [[Пять рецептов на осень]] @{2026-10-13}');

  const text = '## A\n- [ ] X @[[06.10.2026]]\n%% kanban:settings\n```\n{"date-format":"DD.MM.YYYY"}\n```\n%%';
  const b2 = parseBoard(text, codec);
  assert.equal(setCardDate(text, b2.cards[0], '2026-12-31', b2.settings, codec).split('\n')[1], '- [ ] X @[[31.12.2026]]');
});

test('setCardDate отказывается, если доска изменилась', () => {
  const board = parseBoard(boardText, codec);
  const card = board.cards.find((c) => c.link === 'Пять рецептов на осень')!;
  const changed = boardText.replace('@{2026-10-11}', '@{2026-10-15}');
  assert.throws(() => setCardDate(changed, card, '2026-10-13', board.settings, codec), /доска изменилась/);
});
