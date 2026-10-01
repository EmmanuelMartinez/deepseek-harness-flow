/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * five child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry), and wires the panel-action service face.
 * ctx.layout selects the main panel and controls column geometry; Session
 * selection belongs to the Session Controller. A second effect seats the theme
 * presenter, which projects ctx.theme snapshots onto document.body.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from './service.ts'
import type { PanelInfo } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { en, zh } from './shortcut-locales.ts'
import { ThemePresenter } from './theme-presenter.ts'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from './service.ts'
export type { ILayout, MainPanelId, PanelInfo } from './service.ts'

/** Selector hook over root-scoped panel selection. */
export type UsePanelInfo = SnapshotSelectorHook<PanelInfo>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Layout keyboard command labels. */
    'shortcuts.layout': keyof typeof zh
  }

  interface GlobalStandardProps {
    /** Subscribe to the selected main panel independently of parent renders. */
    usePanelInfo: UsePanelInfo
  }

  interface SlotMap {
    // The 'root' entry itself is the runtime's built-in slot (declared
    // there); these five are the frame's children, declared by the same
    // register() call that contributes AppFrame. Session owners never pass
    // sessionId: the framework injects it as a standard prop.
    /**
     * The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
     * declares the workspace and settings seats inside it — registering here
     * replaces the navigation column outright rather than adding to it, and
     * the seats it declares disappear with it. To add something to the
     * sidebar, register into one of those inner seats instead.
     *
     * The occupant receives the frame's live column state (collapsed, width)
     * and is expected to render the compact control rail while collapsed.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * Central panel selected by sidebar entry id. The reserved `conversation`
     * key hosts the Conversation; other keys receive no Session binding.
     */
    'main': { kind: 'keyed'; scope: 'root' }
    /**
     * The right column: a track the centre makes room for, or nothing. OCCUPIED
     * by the right Sidebar, which uses the resolved column width in normal
     * mode and covers the viewport in fullscreen, retaining the wide-screen
     * column reservation underneath.
     *
     * Whether the panel is shown, and whether it takes a track, is the
     * occupant's own recorded business — it reports the composition of its
     * expanded and presentation state through `ctx.layout`, and the frame sizes
     * the track and places the resize handle from that. The expand control is
     * not this column's: it is a button in the conversation header. The root
     * occupant decides when to render its Session-bound content.
     */
    'rightbar': { kind: 'single'; scope: 'root'; owner: RightbarOwnerProps }
    /**
     * The right rail: a fixed $RAIL_WIDTH column of tool icons at the frame's
     * right edge, outside the right column and independent of its collapse.
     *
     * Each entry is one tool, and each tool owns its own press: the frame reads
     * the selected panel and the entry's own key, then toggles. The frame passes
     * `size` and `active`, the same share the left panel rail gives its glyphs,
     * so a tool reuses one icon component for both rails.
     */
    'rightrail': { kind: 'list'; scope: 'root'; owner: RailOwnerProps }
    /**
     * Frame-wide floating layer, above every column and outside their scroll
     * containers. Deliberately generic and unowned by any feature: a badge, a
     * toast stack or a status pill all belong here, and entries order among
     * themselves. The layer itself is click-through — entries opt back into
     * pointer events — so an occupant never blocks the app underneath.
     *
     * This is the additive seat for a frame-wide surface of your own: a fresh
     * `id` is added beside the shipped entries instead of replacing them.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /**
     * Window-chrome seat at the frame's top-left, over every main panel.
     * Mounted only while the sidebar column is fully hidden (macOS desktop
     * collapse; other platforms keep the rail), so the occupant can assume the
     * frame edge is the window edge and the macOS traffic lights sit before it.
     * OCCUPIED by ui-sidebar's reopen/New Session controls.
     *
     * While the seat is mounted the frame publishes
     * `--dsh-frame-leading-clearance` (the inline inset the seat's band
     * occupies, measured from the frame's left edge); a main panel whose
     * content reaches the top-left corner pads by it so nothing lands under
     * the lights or the controls.
     */
    'shell.leading': { kind: 'single'; scope: 'root' }
  }
}

// OwnerShare contracts — the render-side share the slot owner supplies at
// renderSlot. Registrants IMPORT these and compose their full component props
// from the framework-derived shares. Conversation business state and actions arrive through
// framework-standard hooks and each registrant's inject face, not owner props.

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  collapsed: boolean
  /** Rendered column width in px (SIDEBAR_COLLAPSED when collapsed). */
  width: number
}

/** Right column owner share: resolved normal geometry and opening eligibility. */
export interface RightbarOwnerProps {
  /** Resolved normal panel width in px, not the saved preference; zero if it cannot fit. */
  width: number
  /** Current frame width in px. */
  viewportWidth: number
  /**
   * Whether a normal right panel can retain 300px beside a 400px center.
   * Before a narrow opening, includes the space from collapsing the left sidebar.
   */
  canShow: boolean
}

/** Right rail owner share: the icon edge and selection state the fixed column affords. */
export interface RailOwnerProps {
  /** Edge of one icon in px, inside the rail's own padding. */
  size: number
  /** Whether this entry's panel is the selected one; a press on it closes again. */
  active: boolean
}

/** One rail entry as metadata: the tool's panel key, its place, and its label. */
export interface RailEntryMetadata {
  readonly id: MainPanelId
  readonly order: number
  readonly label: string
}

/** What the frame hands its own component: the rail's entries and the press routing they need. */
export interface AppFrameInjected {
  readonly hooks: {
    /** Rail entries in ascending order, republished as tools register and unregister. */
    readonly railEntries: HostObservable<readonly RailEntryMetadata[]>
  }
  /**
   * Handle one press on a rail entry. A right-column surface takes its own
   * press; every other entry is a main panel key, and a press on the selected
   * one returns to the Conversation.
   * @param id - the entry's key: a main panel key or a registered surface kind.
   * @param active - whether that panel is the selected one.
   */
  readonly pressEntry: (id: string, active: boolean) => void
}

/** How the frame reaches a right-column surface without depending on that column. */
interface SurfaceToggler {
  /**
   * Open that surface, or close the column when it is already in front.
   * @param kind - registered page kind.
   * @returns whether the column took the press.
   */
  readonly toggleSurface?: (kind: string) => boolean
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme', 'locale', 'shortcuts']

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the five child-slot declarations, the layout store seat,
 * and the shared root instance supplying commands and the panel-info source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('shortcuts.layout', { zh, en }), 'layout: command labels')
  const t = ctx.locale.bind('shortcuts.layout')

  ctx.effect(() => {
    const handle = createLayoutStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const retainMainPanels = (): void => {
      instance.actions.retainMainPanels(ctx.slots.entries('main').flatMap(entry =>
        entry.options.key === undefined ? [] : [entry.options.key]))
    }
    const panelInfo: HostObservable<PanelInfo> = {
      getSnapshot: () => instance.getSnapshot().panelInfo,
      subscribe: listener => instance.subscribe(listener),
    }
    const layout = new LayoutController(instance.actions, id =>
      ctx.slots.entries('main').some(entry => entry.options.key === id), panelInfo)
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } })
    const disposeService = ctx.reflect.provide('layout', layout)
    // The rail's entries are read as metadata so the frame can own each button:
    // one tool per entry, ordered, with the label its own package supplies.
    const railEntries = createSnapshotStore<readonly RailEntryMetadata[]>([])
    const syncRail = (): void => {
      const next = ctx.slots.entriesOfSlot('rightrail').map(({ options }) => {
        // The list registration requires an id; StoredEntry erases the slot kind.
        const id = options.id as MainPanelId
        return {
          id,
          order: options.order ?? 0,
          label: resolveSlotLabel(options.label) ?? id,
        }
      }).sort((left, right) => left.order - right.order)
      const previous = railEntries.getSnapshot()
      if (previous.length === next.length && previous.every((entry, index) => {
        const candidate = next[index] as RailEntryMetadata
        return entry.id === candidate.id && entry.order === candidate.order && entry.label === candidate.label
      })) return
      railEntries.set(next)
    }
    const disposeRailEntries = ctx.slots.subscribe('rightrail', syncRail)
    const disposeRailLabels = ctx.locale.subscribe(syncRail)
    syncRail()
    const frameInject = (): AppFrameInjected => ({
      hooks: { railEntries },
      // The right column installs its own surfaces, so the frame asks it first;
      // it is optional, and read structurally because the frame is below that
      // column in the module graph and cannot import it.
      pressEntry: (id, active) => {
        const surfaces = ctx.get('sidebarRight') as SurfaceToggler | undefined
        if (surfaces?.toggleSurface?.(id) === true) return
        layout.selectPanel(active ? null : id as MainPanelId)
      },
    })
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'rightbar': { kind: 'single', scope: 'root' },
        'rightrail': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'shell.leading': { kind: 'single', scope: 'root' },
      },
      store,
      inject: frameInject,
    }, AppFrame)
    const disposeShortcut = ctx.shortcuts.register({
      id: 'sidebar.left.toggle' as ShortcutCommandId, label: () => t('toggle'), aliases: ['sidebar', 'toggle left sidebar'],
      defaults: {
        'desktop:macos': { code: 'KeyB', modifiers: ['primary'] },
        'desktop:windows': { code: 'KeyB', modifiers: ['primary'] },
        'desktop:linux': { code: 'KeyB', modifiers: ['primary'] },
        'web:macos': { code: 'KeyB', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] },
      },
      regions: ['page', 'editable'], modals: [],
      resolve: () => ({ status: 'handled', run: () => { layout.toggleSidebar() } }),
    })
    const disposePanels = ctx.slots.subscribe('main', retainMainPanels)
    retainMainPanels()
    return () => {
      disposeShortcut()
      layout.dispose()
      disposePanels()
      disposeRailLabels()
      disposeRailEntries()
      disposeRegistration()
      disposePanelInfo()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
