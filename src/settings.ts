import { App, PluginSettingTab, Setting } from 'obsidian';
import type KanbanCalendarPlugin from './main';

export interface TypeStyle {
  label?: string;
  color?: string;
}

export interface CalendarSettings {
  /** Пути досок или папок; пусто — все доски хранилища. */
  boards: string[];
  showDone: boolean;
  showCardOnly: boolean;
  confirmCreateDaily: boolean;
  /** Переопределения подписей и цветов типов событий (ключ свойства → стиль). */
  types: Record<string, TypeStyle>;
  miniPlaced: boolean;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  boards: [],
  showDone: true,
  showCardOnly: true,
  confirmCreateDaily: true,
  types: {},
  miniPlaced: false,
};

export class CalendarSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KanbanCalendarPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const { settings } = this.plugin;
    containerEl.empty();

    const save = async (rebuild = true) => {
      await this.plugin.saveSettings();
      if (rebuild) {
        this.plugin.index.schedule();
      } else {
        this.plugin.index.refreshTypes();
        this.plugin.index.trigger('updated');
      }
    };

    new Setting(containerEl)
      .setName('Доски')
      .setDesc('Пути к доскам или папкам, по одному на строку. Пусто — все Kanban-доски хранилища.')
      .addTextArea((t) =>
        t
          .setPlaceholder('Проекты/Доска.md')
          .setValue(settings.boards.join('\n'))
          .onChange(async (v) => {
            settings.boards = v.split('\n').map((s) => s.trim()).filter(Boolean);
            await save();
          })
      );

    new Setting(containerEl)
      .setName('Показывать выполненные')
      .setDesc('Карточки с галочкой и из колонки, отмеченной как завершённая. Показываются приглушёнными.')
      .addToggle((t) =>
        t.setValue(settings.showDone).onChange(async (v) => {
          settings.showDone = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Дата карточки отдельно')
      .setDesc('Показывать дату @{…} с доски, если она не совпала ни с одной датой из свойств заметки.')
      .addToggle((t) =>
        t.setValue(settings.showCardOnly).onChange(async (v) => {
          settings.showCardOnly = v;
          await save();
        })
      );

    new Setting(containerEl)
      .setName('Спрашивать перед созданием заметки дня')
      .addToggle((t) =>
        t.setValue(settings.confirmCreateDaily).onChange(async (v) => {
          settings.confirmCreateDaily = v;
          await save(false);
        })
      );

    const types = this.plugin.index.types;
    if (!types.length) return;
    new Setting(containerEl).setName('Типы событий').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Подписи и цвета берутся из metadata-keys доски. Здесь их можно переопределить.',
    });
    for (const type of types) {
      const style = (settings.types[type.key] ??= {});
      new Setting(containerEl)
        .setName(type.key)
        .addText((t) =>
          t
            .setPlaceholder(type.boardLabel || type.key)
            .setValue(style.label ?? '')
            .onChange(async (v) => {
              style.label = v.trim() || undefined;
              await save(false);
            })
        )
        .addColorPicker((c) =>
          c.setValue(style.color ?? type.defaultHex).onChange(async (v) => {
            style.color = v;
            await save(false);
          })
        )
        .addExtraButton((b) =>
          b
            .setIcon('reset')
            .setTooltip('Сбросить')
            .onClick(async () => {
              delete settings.types[type.key];
              await save(false);
              this.display();
            })
        );
    }
  }
}
