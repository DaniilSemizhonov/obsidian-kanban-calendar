// Превращает карточки досок в события календаря. Чистая логика, без Obsidian API.
import type { Board, Card } from './boards';

/** Ключ типа события для карточки без совпадающего свойства. */
export const CARD_KEY = '__card';

export interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  /** Ключ свойства (deadline_tz, …) или CARD_KEY для даты карточки. */
  key: string;
  /** Подпись типа с доски («ТЗ», «Текст», «📅») — может быть пустой. */
  label: string;
  title: string;
  notePath: string | null;
  boardPath: string;
  card: Card;
  /** Событие включает дату карточки: при переносе нужно менять и доску. */
  includesCardDate: boolean;
  lane: string;
  done: boolean;
}

export interface NoteInfo {
  path: string;
  frontmatter: Record<string, unknown> | undefined;
}

export interface BuildOptions {
  /** Находит заметку по ссылке из карточки. */
  resolve(link: string, boardPath: string): NoteInfo | null;
  showDone: boolean;
  /** Показывать дату карточки, если она не совпала ни с одним свойством. */
  showCardOnly: boolean;
}

/** Достаёт дату из значения свойства: «2026-10-12», «2026-10-12T19:00» и т. п. */
export function propDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value.trim());
  return m ? m[1] : null;
}

export function buildEvents(boards: { path: string; board: Board }[], opts: BuildOptions): CalEvent[] {
  const events: CalEvent[] = [];

  for (const { path: boardPath, board } of boards) {
    for (const card of board.cards) {
      const done = card.checked || card.laneComplete;
      if (done && !opts.showDone) continue;

      const note = card.link ? opts.resolve(card.link, boardPath) : null;
      const base = {
        title: card.title,
        notePath: note?.path ?? null,
        boardPath,
        card,
        lane: card.lane,
        done,
      };

      let cardMerged = false;
      for (const { key, label } of board.settings.metadataKeys) {
        const date = propDate(note?.frontmatter?.[key]);
        if (!date) continue;
        // Дата карточки совпала со свойством (у карточки = дедлайн текста) — одно событие вместо двух.
        const merged = !cardMerged && card.date === date;
        if (merged) cardMerged = true;
        events.push({ ...base, id: `${boardPath}:${card.line}:${key}`, date, key, label, includesCardDate: merged });
      }

      if (card.date && !cardMerged && opts.showCardOnly) {
        events.push({
          ...base,
          id: `${boardPath}:${card.line}:${CARD_KEY}`,
          date: card.date,
          key: CARD_KEY,
          label: '',
          includesCardDate: true,
        });
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'));
}

/** Группировка по дню для отрисовки. */
export function byDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const e of events) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}
