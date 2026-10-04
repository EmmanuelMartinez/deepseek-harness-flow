/** Customizations settings section: this deployment's Skills, MCP servers, and instruction files. */

import { useCallback, useEffect, useId, useState } from 'react'
import type { CustomizationBalance, CustomizationsSnapshot, ManagedMcpServer } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconRefreshOutlineRegular,
  SegmentedTabs,
  fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { McpServersList, type McpWriteOutcome } from './McpServersList.tsx'
import { RulesList } from './RulesList.tsx'
import { SkillsList } from './SkillsList.tsx'
import css from './CustomizationsSection.module.css'

/** The internal views of the Customizations page. */
type CustomizationsView = 'skills' | 'mcp' | 'rules'

/** Registration-side Host face used by the section. */
export interface CustomizationsSectionInjected {
  /** Read the current Host customization inventory. */
  list: () => Promise<CustomizationsSnapshot>
  /** Enable or disable one MCP Loader row the profile declares. */
  setEnabled: (entryId: string, enabled: boolean) => Promise<McpWriteOutcome>
  /** Store and mount one panel-managed MCP server. */
  addServer: (server: ManagedMcpServer) => Promise<McpWriteOutcome>
  /** Remove one panel-managed MCP server. */
  removeServer: (id: string) => Promise<McpWriteOutcome>
  /** Enable or disable one panel-managed MCP server. */
  setManagedEnabled: (id: string, enabled: boolean) => Promise<McpWriteOutcome>
  /** Read the DeepSeek platform balance for this deployment's API key. */
  readBalance: () => Promise<CustomizationBalance>
}

/** Full component props assembled by the Settings slot renderer. */
export type CustomizationsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customizations'>
  & InjectFace<CustomizationsSectionInjected>

/** The section's own read state; the active view is presentation only. */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: CustomizationsSnapshot }

/** Placeholder cards the loading skeleton lays out. */
const SKELETON_CARDS = [0, 1, 2] as const

/** What one balance answer says, as one localized line. */
function balanceText(balance: CustomizationBalance, t: CustomizationsSectionProps['t']): string {
  if (balance.state === 'no-key') return t('balanceNoKey')
  if (balance.state === 'failed' || balance.total === undefined) return t('balanceFailed')
  const amount = t('balanceAmount', { amount: balance.total, currency: balance.currency ?? '' })
  if (balance.toppedUp === undefined && balance.granted === undefined) return amount
  return `${amount} · ${t('balanceBreakdown', {
    toppedUp: balance.toppedUp ?? '—',
    granted: balance.granted ?? '—',
  })}`
}

/** Share of the budget one measured part occupies, as a CSS width. */
function share(part: number, total: number, usedPercent: number): string {
  if (total <= 0) return '0%'
  return `${String((part / total) * usedPercent)}%`
}

/**
 * Render the Customizations page: one inventory read, three views over it, and
 * the estimated budget the customizations occupy.
 * @param props - the renderer-bound runtime, locale, and injected Host face.
 * @returns the section content.
 */
export function CustomizationsSection({
  t, list, setEnabled, addServer, removeServer, setManagedEnabled, readBalance,
}: CustomizationsSectionProps) {
  const tabsId = useId()
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [active, setActive] = useState<CustomizationsView>('skills')

  // One read at a time: Refresh refuses input while a read is in flight, so no
  // second answer can race the first.
  const read = useCallback(() => {
    setView({ status: 'loading' })
    void list().then(
      (snapshot) => { setView({ status: 'ready', snapshot }) },
      () => { setView({ status: 'error' }) },
    )
  }, [list])

  useEffect(() => { read() }, [read])

  const [balance, setBalance] = useState<CustomizationBalance>()
  const loadBalance = useCallback(() => {
    void readBalance().then(setBalance, () => { setBalance({ state: 'failed' }) })
  }, [readBalance])
  useEffect(() => { loadBalance() }, [loadBalance])

  const snapshot = view.status === 'ready' ? view.snapshot : undefined
  const tabs: readonly [SegmentedTab<CustomizationsView>, ...SegmentedTab<CustomizationsView>[]] = [
    {
      value: 'skills',
      label: t('tabWithCount', { label: t('tabSkills'), count: snapshot?.skills.length ?? 0 }),
      id: `${tabsId}-tab-skills`,
      panelId: `${tabsId}-panel-skills`,
    },
    {
      value: 'mcp',
      label: t('tabWithCount', { label: t('tabMcp'), count: snapshot?.mcpServers.length ?? 0 }),
      id: `${tabsId}-tab-mcp`,
      panelId: `${tabsId}-panel-mcp`,
    },
    {
      value: 'rules',
      label: t('tabWithCount', { label: t('tabRules'), count: snapshot?.rules.length ?? 0 }),
      id: `${tabsId}-tab-rules`,
      panelId: `${tabsId}-panel-rules`,
    },
  ]

  const usage = snapshot?.usage
  const measured = usage === undefined ? 0 : usage.instructionBytes + usage.catalogBytes
  const usedPercent = usage === undefined || usage.budgetTokens <= 0
    ? 0
    : Math.min(100, (usage.estimatedTokens / usage.budgetTokens) * 100)

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('subtitle')}</p>
      {usage !== undefined && (
        <div className={css.usage}>
          <div className={css.usageHead}>
            <span className={css.usageTitle}>{t('usageTitle')}</span>
            <span className={css.summary}>
              {t('usageAvailable', { percent: Math.round((100 - usedPercent) * 10) / 10 })}
            </span>
          </div>
          <div
            className={css.usageBar}
            role="img"
            aria-label={t('usageUsed', {
              used: usage.estimatedTokens.toLocaleString(),
              budget: usage.budgetTokens.toLocaleString(),
            })}
          >
            <span
              className={css.usageRules}
              style={{ width: share(usage.instructionBytes, measured, usedPercent) }}
            />
            <span
              className={css.usageSkills}
              style={{ width: share(usage.catalogBytes, measured, usedPercent) }}
            />
          </div>
          <div className={css.usageLegend}>
            {balance !== undefined && (
              <span className={css.statusWithDot}>
                <span>{`${t('balanceTitle')}: ${balanceText(balance, t)}`}</span>
                <Button variant="ghost" size="sm" onClick={loadBalance}>{t('balanceRefresh')}</Button>
              </span>
            )}
            <span>{`${t('usageRulesLabel')} ${fileSizeText(usage.instructionBytes)}`}</span>
            <span>{`${t('usageSkillsLabel')} ${fileSizeText(usage.catalogBytes)}`}</span>
            <span className={css.usageNote}>{t('usageNote')}</span>
          </div>
        </div>
      )}
      <div className={css.controls}>
        <SegmentedTabs items={tabs} value={active} onChange={setActive} label={t('tabsLabel')} />
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutlineRegular size={14} />}
          disabled={view.status === 'loading'}
          onClick={read}
        >
          {t('refresh')}
        </Button>
      </div>
      {view.status === 'loading' && (
        <div className={css.skeleton} role="status" aria-label={t('loading')}>
          {SKELETON_CARDS.map(card => <div key={card} className={css.skeletonCard} />)}
        </div>
      )}
      {view.status === 'error' && (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <Button variant="outline" size="sm" onClick={read}>{t('retry')}</Button>
        </div>
      )}
      {snapshot !== undefined && (
        <>
          <div
            id={`${tabsId}-panel-skills`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-skills`}
            hidden={active !== 'skills'}
          >
            <SkillsList t={t} snapshot={snapshot} />
          </div>
          <div
            id={`${tabsId}-panel-mcp`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-mcp`}
            hidden={active !== 'mcp'}
          >
            <McpServersList
              t={t}
              snapshot={snapshot}
              setEnabled={setEnabled}
              addServer={async (server) => {
                const outcome = await addServer(server)
                if (outcome.ok) read()
                return outcome
              }}
              removeServer={async (id) => {
                const outcome = await removeServer(id)
                if (outcome.ok) read()
                return outcome
              }}
              setManagedEnabled={async (id, enabled) => {
                const outcome = await setManagedEnabled(id, enabled)
                if (outcome.ok) read()
                return outcome
              }}
            />
          </div>
          <div
            id={`${tabsId}-panel-rules`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-rules`}
            hidden={active !== 'rules'}
          >
            <RulesList t={t} snapshot={snapshot} />
          </div>
        </>
      )}
    </div>
  )
}
