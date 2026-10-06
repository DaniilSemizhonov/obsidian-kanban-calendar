import { Plugin, WorkspaceLeaf } from 'obsidian';
import { openDailyNote } from './actions';
import { TaskIndex } from './index';
import { CalendarSettings, CalendarSettingTab, DEFAULT_CALENDAR_SETTINGS } from './settings';
import { MINI_VIEW, MiniView } from './views/MiniView';
import { MONTH_VIEW, MonthView } from './views/MonthView';
import { todayIso } from './views/shared';

export default class KanbanCalendarPlugin extends Plugin {
  settings!: CalendarSettings;
  index!: TaskIndex;

  async onload() {
    await this.loadSettings();
    this.index = new TaskIndex(this.app, this);

    this.registerView(MONTH_VIEW, (leaf) => new MonthView(leaf, this));
    this.registerView(MINI_VIEW, (leaf) => new MiniView(leaf, this));
    // Предпросмотр заметки при наведении на задачу с зажатым Ctrl/Cmd.
    this.registerHoverLinkSource(MONTH_VIEW, { display: 'Канбан-календарь', defaultMod: true });
    this.registerHoverLinkSource(MINI_VIEW, { display: 'Мини-календарь', defaultMod: true });

    this.addRibbonIcon('calendar-days', 'Канбан-календарь', () => this.openMonth());
    this.addCommand({ id: 'open-month', name: 'Открыть канбан-календарь', callback: () => this.openMonth() });
    this.addCommand({ id: 'open-mini', name: 'Открыть мини-календарь', callback: () => this.openMini() });
    this.addCommand({ id: 'open-today', name: 'Открыть сегодняшнюю заметку', callback: () => openDailyNote(this, todayIso()) });
    this.addSettingTab(new CalendarSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      this.index.watch();
      await this.index.rebuild();
      // При первом запуске кладём мини-календарь в правую панель, как это делает Calendar.
      if (!this.settings.miniPlaced) {
        await this.openMini(false);
        this.settings.miniPlaced = true;
        await this.saveSettings();
      }
    });
  }

  private async reveal(type: string, create: () => Promise<WorkspaceLeaf | null>, focus = true) {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = await create();
      if (!leaf) return;
      await leaf.setViewState({ type, active: focus });
    }
    if (focus) await workspace.revealLeaf(leaf);
  }

  openMonth() {
    return this.reveal(MONTH_VIEW, async () => this.app.workspace.getLeaf('tab'));
  }

  openMini(focus = true) {
    return this.reveal(MINI_VIEW, async () => this.app.workspace.getRightLeaf(false), focus);
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_CALENDAR_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
