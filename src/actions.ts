import { App, Keymap, Modal, Notice, Setting, TFile } from 'obsidian';
import { moment } from './moment';
import {
  appHasDailyNotesPluginLoaded,
  createDailyNote,
  getAllDailyNotes,
  getDailyNote,
} from 'obsidian-daily-notes-interface';
import { setCardDate } from './boards';
import { CalEvent, CARD_KEY } from './events';
import { codec } from './index';
import type KanbanCalendarPlugin from './main';
import { formatDayRu } from './views/shared';

/** Перенос события на другой день: дата на доске и/или свойство заметки. */
export async function moveEvent(plugin: KanbanCalendarPlugin, ev: CalEvent, newIso: string) {
  if (ev.date === newIso) return;
  const { vault, fileManager } = plugin.app;
  const label = plugin.index.type(ev.key)?.label ?? '';

  try {
    if (ev.includesCardDate) {
      const board = vault.getAbstractFileByPath(ev.boardPath);
      if (!(board instanceof TFile)) throw new Error('доска не найдена');
      await vault.process(board, (text) => {
        const { settings } = plugin.index.parse(text);
        return setCardDate(text, ev.card, newIso, settings, codec);
      });
    }
    if (ev.key !== CARD_KEY && ev.notePath) {
      const note = vault.getAbstractFileByPath(ev.notePath);
      if (!(note instanceof TFile)) throw new Error('заметка не найдена');
      await fileManager.processFrontMatter(note, (fm) => {
        // Сохраняем время, если оно было: «2026-10-12T19:00» → «2026-10-13T19:00».
        const old = typeof fm[ev.key] === 'string' ? (fm[ev.key] as string) : '';
        fm[ev.key] = /^\d{4}-\d{2}-\d{2}/.test(old) ? old.replace(/^\d{4}-\d{2}-\d{2}/, newIso) : newIso;
      });
    }
    new Notice(`${ev.title}: ${label ? `${label} → ` : ''}${formatDayRu(newIso)}`);
  } catch (e) {
    console.error('[kanban-calendar]', e);
    new Notice(`Не удалось перенести «${ev.title}»: ${(e as Error).message}`, 8000);
  }
}

/** Открывает заметку события (или доску, если у карточки нет ссылки). Ctrl/Cmd — в новой вкладке. */
export async function openEvent(app: App, ev: CalEvent, evt: MouseEvent | KeyboardEvent) {
  const file = app.vault.getAbstractFileByPath(ev.notePath ?? ev.boardPath);
  if (file instanceof TFile) await app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
}

/**
 * Поиск заметок дня. getAllDailyNotes обходит всю папку ежедневника, поэтому
 * вьюхи берут снимок один раз на перерисовку, а не на каждую клетку.
 */
export function dailyNotesLookup(): (iso: string) => TFile | null {
  let all: Record<string, TFile>;
  try {
    all = getAllDailyNotes();
  } catch {
    // Папки ежедневника ещё нет или плагин выключен.
    return () => null;
  }
  return (iso) => getDailyNote(moment(iso, 'YYYY-MM-DD'), all) ?? null;
}

export const dailyNoteFor = (iso: string) => dailyNotesLookup()(iso);

/** Открывает заметку дня; если её нет — создаёт (с подтверждением, если оно включено). */
export async function openDailyNote(plugin: KanbanCalendarPlugin, iso: string, evt?: MouseEvent) {
  const { app } = plugin;
  const newLeaf = evt ? Keymap.isModEvent(evt) : false;
  let file = dailyNoteFor(iso);

  if (!file) {
    if (!appHasDailyNotesPluginLoaded()) {
      new Notice('Включите встроенный плагин «Ежедневные заметки», чтобы создавать заметки дня');
      return;
    }
    if (plugin.settings.confirmCreateDaily && !(await confirmCreate(app, iso))) return;
    file = (await createDailyNote(moment(iso, 'YYYY-MM-DD'))) ?? null;
    if (!file) return;
  }
  await app.workspace.getLeaf(newLeaf).openFile(file);
}

function confirmCreate(app: App, iso: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    modal.titleEl.setText('Новая заметка дня');
    modal.contentEl.createEl('p', { text: `Заметки за ${formatDayRu(iso, true)} нет. Создать?` });
    new Setting(modal.contentEl)
      .addButton((b) =>
        b
          .setButtonText('Создать')
          .setCta()
          .onClick(() => {
            answered = true;
            resolve(true);
            modal.close();
          })
      )
      .addButton((b) => b.setButtonText('Отмена').onClick(() => modal.close()));
    modal.onClose = () => {
      if (!answered) resolve(false);
    };
    modal.open();
  });
}
