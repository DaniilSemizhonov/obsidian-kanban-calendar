import { App, debounce, Events, TFile } from 'obsidian';
import { moment } from './moment';
import { BoardSettings, DateCodec, parseBoard, Board } from './boards';
import { buildEvents, byDay, CalEvent, CARD_KEY } from './events';
import type KanbanCalendarPlugin from './main';

export const codec: DateCodec = {
  parse: (value, format) => {
    const m = moment(value, format, true);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
  },
  format: (iso, format) => moment(iso, 'YYYY-MM-DD').format(format),
};

// Цвета Obsidian, подстраиваются под светлую и тёмную тему.
const PALETTE = ['orange', 'blue', 'green', 'purple', 'red', 'cyan', 'pink', 'yellow'];

export interface EventType {
  key: string;
  /** Подпись из metadata-keys доски. */
  boardLabel: string;
  /** Итоговая подпись с учётом настроек плагина. */
  label: string;
  color: string;
  defaultHex: string;
}

function cssColorToHex(cssVar: string): string {
  const raw = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
  if (raw.startsWith('#')) return raw.length === 4 ? `#${[...raw.slice(1)].map((c) => c + c).join('')}` : raw.slice(0, 7);
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(raw);
  return m ? `#${m.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('')}` : '#888888';
}

/** Все события со всех досок. Пересобирается при изменении досок и связанных заметок. */
export class TaskIndex extends Events {
  events: CalEvent[] = [];
  days = new Map<string, CalEvent[]>();
  types: EventType[] = [];
  private typeByKey = new Map<string, EventType>();
  private boardPaths = new Set<string>();
  private notePaths = new Set<string>();

  constructor(private app: App, private plugin: KanbanCalendarPlugin) {
    super();
  }

  schedule = debounce(() => this.rebuild(), 300, true);

  watch() {
    const { metadataCache, vault } = this.app;
    this.plugin.registerEvent(
      metadataCache.on('changed', (file) => {
        if (this.boardPaths.has(file.path) || this.notePaths.has(file.path) || this.isBoard(file)) this.schedule();
      })
    );
    // Переименование и удаление меняют разрешение ссылок — проще пересобрать.
    this.plugin.registerEvent(vault.on('rename', () => this.schedule()));
    this.plugin.registerEvent(vault.on('delete', () => this.schedule()));
  }

  type(key: string): EventType | undefined {
    return this.typeByKey.get(key);
  }

  private isBoard(file: TFile): boolean {
    return file.extension === 'md' && this.app.metadataCache.getFileCache(file)?.frontmatter?.['kanban-plugin'] != null;
  }

  private selected(file: TFile): boolean {
    const filters = this.plugin.settings.boards;
    if (!filters.length) return true;
    return filters.some((f) => file.path === f || file.path === `${f}.md` || file.path.startsWith(`${f.replace(/\/$/, '')}/`));
  }

  /** Настройки Kanban по умолчанию — для досок, где формат даты не переопределён. */
  private kanbanDefaults(): Partial<BoardSettings> {
    const s = (this.app as any).plugins?.plugins?.['obsidian-kanban']?.settings ?? {};
    const out: Partial<BoardSettings> = {};
    if (typeof s['date-format'] === 'string') out.dateFormat = s['date-format'];
    if (typeof s['date-trigger'] === 'string') out.dateTrigger = s['date-trigger'];
    if (typeof s['link-date-to-daily-note'] === 'boolean') out.linkDateToDailyNote = s['link-date-to-daily-note'];
    if (Array.isArray(s['metadata-keys'])) {
      out.metadataKeys = s['metadata-keys'].map((k: any) => ({ key: k.metadataKey, label: k.label ?? '' }));
    }
    return out;
  }

  parse(text: string): Board {
    return parseBoard(text, codec, this.kanbanDefaults());
  }

  async rebuild() {
    const { vault, metadataCache } = this.app;
    const { settings } = this.plugin;

    const files = vault.getMarkdownFiles().filter((f) => this.isBoard(f) && this.selected(f));
    const boards = await Promise.all(files.map(async (f) => ({ path: f.path, board: this.parse(await vault.cachedRead(f)) })));

    const notePaths = new Set<string>();
    this.events = buildEvents(boards, {
      resolve: (link, boardPath) => {
        const file = metadataCache.getFirstLinkpathDest(link, boardPath);
        if (!file) return null;
        notePaths.add(file.path);
        return { path: file.path, frontmatter: metadataCache.getFileCache(file)?.frontmatter };
      },
      showDone: settings.showDone,
      showCardOnly: settings.showCardOnly,
    });
    this.days = byDay(this.events);
    this.boardPaths = new Set(files.map((f) => f.path));
    this.notePaths = notePaths;

    // Типы — в порядке metadata-keys досок, только те, что реально встретились.
    const used = new Set(this.events.map((e) => e.key));
    const order: { key: string; label: string }[] = [];
    for (const { board } of boards) {
      for (const k of board.settings.metadataKeys) {
        if (used.has(k.key) && !order.some((o) => o.key === k.key)) order.push(k);
      }
    }
    if (used.has(CARD_KEY)) order.push({ key: CARD_KEY, label: '' });
    this.types = order.map(({ key, label }, i) => this.makeType(key, label, i));
    this.typeByKey = new Map(this.types.map((t) => [t.key, t]));

    this.trigger('updated');
  }

  private makeType(key: string, boardLabel: string, i: number): EventType {
    const cssVar = key === CARD_KEY ? '--interactive-accent' : `--color-${PALETTE[i % PALETTE.length]}`;
    const style = this.plugin.settings.types[key] ?? {};
    const fallback = key === CARD_KEY ? 'Дата карточки' : key;
    return {
      key,
      boardLabel,
      label: style.label || boardLabel || fallback,
      color: style.color || `var(${cssVar})`,
      defaultHex: cssColorToHex(cssVar),
    };
  }

  /** Подписи/цвета зависят от настроек — пересчитать без перечитывания досок. */
  refreshTypes() {
    this.types = this.types.map((t, i) => this.makeType(t.key, t.boardLabel, i));
    this.typeByKey = new Map(this.types.map((t) => [t.key, t]));
  }
}
